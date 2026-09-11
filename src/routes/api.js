
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const OpenAI = require('openai');
const { toFile } = require('openai');
const Stripe = require('stripe');

const {
  createUser,
  findUserByEmail,
  findUserById,
  patchUser,
  findUserByVerificationTokenHash,
  findUserByPasswordResetTokenHash,
  saveProject,
  getProjectsForUser,
  deleteProjectForUser,
  countProjectKeyReferences,
  countUsageThisMonth,
  recordUsage,
  updateUserStripeStatus,
  findUserByStripeCustomerId,
  recordStripeEvent
} = require('../lib/db');
const { estimateRange, buildPlan, buildPrompt } = require('../lib/yard');
const {
  saveBuffer,
  readObject,
  deleteObject,
  keyFromStoredValue
} = require('../lib/storage');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/email');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error('Please upload a JPG, PNG, or WEBP image.'));
    }
    cb(null, true);
  }
});

async function detectImageType(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(12);
    await handle.read(buffer, 0, 12, 0);

    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mime: 'image/jpeg', extension: 'jpg' };
    }
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) {
      return { mime: 'image/png', extension: 'png' };
    }
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
      return { mime: 'image/webp', extension: 'webp' };
    }
    return null;
  } finally {
    await handle.close();
  }
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Please sign in first.', code: 'AUTH_REQUIRED' });
  }
  next();
}

async function requireVerifiedIfConfigured(req, res, next) {
  const shouldRequire =
    process.env.REQUIRE_EMAIL_VERIFICATION === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false');

  if (!shouldRequire) return next();

  const user = await findUserById(req.session.userId);
  if (!user?.emailVerified) {
    return res.status(403).json({
      error: 'Verify your email before generating designs.',
      code: 'EMAIL_VERIFICATION_REQUIRED'
    });
  }
  next();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    plan: user.plan || 'free',
    emailVerified: Boolean(user.emailVerified),
    createdAt: user.createdAt
  };
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}
function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function futureIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function clientErrorDetails(err) {
  if (process.env.NODE_ENV === 'production') return undefined;
  return String(err?.message || err || '');
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => err ? reject(err) : resolve());
  });
}

function mediaSigningSecret() {
  return process.env.MEDIA_SIGNING_SECRET || process.env.SESSION_SECRET || 'yardvision-dev-media-secret';
}

function mediaSignature(userId, key, expires) {
  return crypto
    .createHmac('sha256', mediaSigningSecret())
    .update(`${Number(userId)}\n${key}\n${expires}`)
    .digest('hex');
}

function privateMediaUrl(userId, key, ttlSeconds = 12 * 60 * 60) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = Buffer.from(String(key), 'utf8').toString('base64url');
  const sig = mediaSignature(userId, key, expires);
  return `/api/media/${token}?expires=${expires}&sig=${sig}`;
}

function validMediaSignature(userId, key, expires, sig) {
  if (!key || !Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = mediaSignature(userId, key, expires);
  const provided = String(sig || '');
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function projectForClient(userId, project) {
  const beforeKey = project.beforeKey || keyFromStoredValue(project.before);
  const afterKey = project.afterKey || keyFromStoredValue(project.after);
  return {
    ...project,
    before: beforeKey ? privateMediaUrl(userId, beforeKey) : '',
    after: afterKey ? privateMediaUrl(userId, afterKey) : '',
    beforeKey: undefined,
    afterKey: undefined
  };
}

function usageLimitFor(user) {
  const free = Number(process.env.FREE_MONTHLY_GENERATIONS || 3);
  const pro = Number(process.env.PRO_MONTHLY_GENERATIONS || 40);
  return user?.plan === 'pro' ? pro : free;
}

async function usageStatus(user) {
  const used = await countUsageThisMonth(user.id);
  const limit = usageLimitFor(user);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    plan: user.plan || 'free'
  };
}

async function issueVerification(user) {
  const token = randomToken();
  await patchUser(user.id, {
    emailVerifyTokenHash: tokenHash(token),
    emailVerifyExpiresAt: futureIso(24 * 60 * 60 * 1000)
  });
  return sendVerificationEmail(user, token);
}

async function issuePasswordReset(user) {
  const token = randomToken();
  await patchUser(user.id, {
    passwordResetTokenHash: tokenHash(token),
    passwordResetExpiresAt: futureIso(60 * 60 * 1000)
  });
  return sendPasswordResetEmail(user, token);
}

async function generateOne(client, uploadFile, prompt, idx, userId) {
  const imageFile = await toFile(
    fs.createReadStream(uploadFile.path),
    uploadFile.originalname || `yard-photo-${idx + 1}.png`,
    { type: uploadFile.mimetype }
  );

  const response = await client.images.edit({
    model: process.env.IMAGE_MODEL || 'gpt-image-2',
    image: imageFile,
    prompt,
    size: 'auto',
    quality: process.env.IMAGE_QUALITY || 'medium',
    output_format: 'jpeg',
    output_compression: 88
  });

  const base64 = response?.data?.[0]?.b64_json;
  if (!base64) throw new Error('The image service returned no image data.');

  const saved = await saveBuffer({
    buffer: Buffer.from(base64, 'base64'),
    prefix: `users/${Number(userId)}/after`,
    extension: 'jpg',
    contentType: 'image/jpeg'
  });

  return { key: saved.key };
}


router.get('/readiness', async (_req, res) => {
  const present = name => !!String(process.env[name] || '').trim();

  const checks = {
    openai: present('OPENAI_API_KEY') && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here',
    postgres: present('DATABASE_URL'),
    sessionSecret:
      present('SESSION_SECRET') &&
      process.env.SESSION_SECRET !== 'change_this_for_production',
    email:
      String(process.env.EMAIL_MODE || '').toLowerCase() === 'resend' &&
      present('RESEND_API_KEY') &&
      present('EMAIL_FROM'),
    storage: [
      'STORAGE_BUCKET',
      'STORAGE_ENDPOINT',
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_SECRET_ACCESS_KEY'
    ].every(present),
    stripe: [
      'STRIPE_SECRET_KEY',
      'STRIPE_PRICE_ID',
      'STRIPE_WEBHOOK_SECRET'
    ].every(present),
    verificationRequired: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
    productionMode: process.env.NODE_ENV === 'production'
  };

  const coreReady =
    checks.openai &&
    checks.postgres &&
    checks.sessionSecret &&
    checks.email &&
    checks.storage;

  res.status(coreReady ? 200 : 503).json({
    ok: coreReady,
    build: 'v8-staging',
    checks,
    note: checks.stripe
      ? 'Core staging services and Stripe are configured.'
      : 'Core staging services are checked separately from Stripe; Stripe may be connected later.'
  });
});

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.get('/auth/me', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.session.userId) return res.json({ ok: true, user: null, usage: null });
  const user = await findUserById(req.session.userId);
  res.json({ ok: true, user: publicUser(user), usage: user ? await usageStatus(user) : null });
});

router.post('/auth/signup', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!name || !email || password.length < 8) {
      return res.status(400).json({
        error: 'Name, email, and a password of at least 8 characters are required.'
      });
    }

    if (await findUserByEmail(email)) {
      return res.status(400).json({ error: 'That email is already in use.' });
    }

    const user = await createUser({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10)
    });

    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.user = publicUser(user);

    let emailResult = null;
    try {
      emailResult = await issueVerification(user);
    } catch (emailError) {
      console.error('Verification email error:', emailError);
    }

    res.json({
      ok: true,
      user: req.session.user,
      usage: await usageStatus(user),
      verificationPreviewUrl: emailResult?.previewUrl || null
    });
  } catch (err) {
    res.status(500).json({
      error: 'Could not create account.',
      details: clientErrorDetails(err)
    });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await findUserByEmail(email);

    if (!user || !(await bcrypt.compare(password, user.passwordHash || ''))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.user = publicUser(user);

    res.json({
      ok: true,
      user: req.session.user,
      usage: await usageStatus(user)
    });
  } catch (err) {
    res.status(500).json({
      error: 'Could not sign in.',
      details: clientErrorDetails(err)
    });
  }
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Session logout error:', err);
      return res.status(500).json({ error: 'Could not sign out.' });
    }
    res.clearCookie('yardvision_v8.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });
    res.json({ ok: true });
  });
});

router.post('/auth/resend-verification', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });

  const result = await issueVerification(user);
  res.json({ ok: true, previewUrl: result?.previewUrl || null });
});

router.post('/auth/verify-email', async (req, res) => {
  const token = String(req.body.token || '');
  if (!token) return res.status(400).json({ error: 'Verification token is required.' });

  const user = await findUserByVerificationTokenHash(tokenHash(token));
  if (!user) return res.status(400).json({ error: 'That verification link is invalid.' });

  if (!user.emailVerifyExpiresAt || new Date(user.emailVerifyExpiresAt).getTime() < Date.now()) {
    return res.status(400).json({ error: 'That verification link has expired.' });
  }

  const updated = await patchUser(user.id, {
    emailVerified: true,
    emailVerifyTokenHash: null,
    emailVerifyExpiresAt: null
  });

  if (req.session.userId === user.id) {
    req.session.user = publicUser(updated);
  }

  res.json({ ok: true, user: publicUser(updated) });
});

router.post('/auth/request-password-reset', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await findUserByEmail(email);

  let previewUrl = null;
  if (user) {
    try {
      const result = await issuePasswordReset(user);
      previewUrl = result?.previewUrl || null;
    } catch (emailError) {
      console.error('Password reset email error:', emailError);
    }
  }

  res.json({
    ok: true,
    message: 'If that email exists, a password reset link has been sent.',
    previewUrl
  });
});

router.post('/auth/reset-password', async (req, res) => {
  const token = String(req.body.token || '');
  const newPassword = String(req.body.newPassword || '');

  if (!token || newPassword.length < 8) {
    return res.status(400).json({
      error: 'A valid reset token and a password of at least 8 characters are required.'
    });
  }

  const user = await findUserByPasswordResetTokenHash(tokenHash(token));
  if (!user) return res.status(400).json({ error: 'That reset link is invalid.' });

  if (!user.passwordResetExpiresAt || new Date(user.passwordResetExpiresAt).getTime() < Date.now()) {
    return res.status(400).json({ error: 'That reset link has expired.' });
  }

  await patchUser(user.id, {
    passwordHash: await bcrypt.hash(newPassword, 10),
    passwordResetTokenHash: null,
    passwordResetExpiresAt: null
  });

  res.json({ ok: true });
});

router.get('/media/:token', requireAuth, async (req, res) => {
  try {
    const key = Buffer.from(String(req.params.token || ''), 'base64url').toString('utf8');
    const expires = Number(req.query.expires);
    const sig = String(req.query.sig || '');

    if (!validMediaSignature(req.session.userId, key, expires, sig)) {
      return res.status(403).json({ error: 'This image link is invalid or has expired.' });
    }

    const object = await readObject(key);
    res.set('Content-Type', object.contentType || 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(object.buffer);
  } catch (err) {
    console.error('Private media read error:', err);
    res.status(404).json({ error: 'Image not found.' });
  }
});

router.get('/usage', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  res.json({ ok: true, usage: await usageStatus(user) });
});

router.post(
  '/design',
  requireAuth,
  requireVerifiedIfConfigured,
  upload.single('yardImage'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Please upload a yard image.' });

      const detectedImage = await detectImageType(req.file.path);
      if (!detectedImage) {
        return res.status(400).json({ error: 'The uploaded file is not a valid JPG, PNG, or WEBP image.' });
      }
      req.file.mimetype = detectedImage.mime;
      req.file.originalname = `yard-photo.${detectedImage.extension}`;
      if (!process.env.OPENAI_API_KEY) {
        return res.status(400).json({ error: 'OPENAI_API_KEY is missing in .env.' });
      }

      const user = await findUserById(req.session.userId);
      const usage = await usageStatus(user);
      if (usage.remaining <= 0) {
        return res.status(403).json({
          error: `You have used all ${usage.limit} ${usage.plan} plan designs for this month.`,
          code: 'USAGE_LIMIT_REACHED',
          usage
        });
      }

      const style = req.body.style || 'Modern';
      const budget = req.body.budget || 'Just give me ideas';
      const notes = req.body.notes || '';
      let features = [];
      try { features = JSON.parse(req.body.features || '[]'); } catch {}

      const beforeSaved = await saveBuffer({
        buffer: await fsp.readFile(req.file.path),
        prefix: `users/${Number(user.id)}/before`,
        extension:
          req.file.mimetype === 'image/png' ? 'png' :
          req.file.mimetype === 'image/webp' ? 'webp' : 'jpg',
        contentType: req.file.mimetype
      });

      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const results = [];

      results.push(
        await generateOne(
          client,
          req.file,
          buildPrompt(style, features, budget, notes, 0),
          0,
          user.id
        )
      );

      await recordUsage(user.id, 1);

      let warning = null;
      try {
        results.push(
          await generateOne(
            client,
            req.file,
            buildPrompt(style, features, budget, notes, 1),
            1,
            user.id
          )
        );
      } catch (variationError) {
        warning = 'Variation 1 was created successfully. Variation 2 could not be created this time.';
        console.warn('Variation 2 skipped:', variationError?.message || variationError);
      }

      const freshUsage = await usageStatus(user);

      res.json({
        ok: true,
        beforeImageUrl: privateMediaUrl(user.id, beforeSaved.key),
        beforeImageKey: beforeSaved.key,
        results: results.map(item => ({
          key: item.key,
          url: privateMediaUrl(user.id, item.key)
        })),
        style,
        budget,
        features,
        notes,
        estimateRange: estimateRange(budget),
        landscapePlan: buildPlan(style, features),
        warning,
        usage: freshUsage
      });
    } catch (err) {
      console.error('YardVision generation error:', err);
      const msg = String(err?.message || err || '');
      const low = msg.toLowerCase();
      const status = Number(err?.status) || 500;

      if (status === 401 || low.includes('api key')) {
        return res.status(401).json({
          error: 'The OpenAI API key was rejected. Check OPENAI_API_KEY in .env.'
        });
      }
      if (
        status === 429 ||
        low.includes('quota') ||
        low.includes('billing') ||
        low.includes('credit') ||
        low.includes('rate limit')
      ) {
        return res.status(429).json({
          error: 'The AI service rate limit or spending limit was reached. Check API billing or try again later.'
        });
      }
      if (status === 400) {
        return res.status(400).json({
          error: 'The image request was rejected.',
          details: clientErrorDetails(err)
        });
      }

      res.status(500).json({
        error: 'YardVision could not generate the design.',
        details: clientErrorDetails(err)
      });
    } finally {
      if (req.file?.path) fsp.unlink(req.file.path).catch(() => {});
    }
  }
);

router.get('/projects', requireAuth, async (req, res) => {
  const projects = await getProjectsForUser(req.session.userId);
  res.json({
    ok: true,
    projects: projects.map(project => projectForClient(req.session.userId, project))
  });
});

router.post('/projects', requireAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const beforeKey = String(payload.beforeKey || '');
    const afterKey = String(payload.afterKey || '');
    const userPrefix = `users/${Number(req.session.userId)}/`;

    if (!beforeKey.startsWith(userPrefix) || !afterKey.startsWith(userPrefix)) {
      return res.status(400).json({ error: 'Missing or invalid private before/after images.' });
    }

    const project = await saveProject(req.session.userId, {
      name: payload.name || `${payload.style || 'Landscape'} Design`,
      style: payload.style || '',
      budget: payload.budget || '',
      features: payload.features || [],
      notes: payload.notes || '',
      before: 'private',
      after: 'private',
      beforeKey,
      afterKey,
      estimate: payload.estimate || '',
      variation: payload.variation || 1
    });

    res.json({ ok: true, project: projectForClient(req.session.userId, project) });
  } catch (err) {
    res.status(500).json({
      error: 'Could not save project.',
      details: clientErrorDetails(err)
    });
  }
});

router.delete('/projects/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await deleteProjectForUser(Number(req.params.id), req.session.userId);
    if (!deleted) return res.status(404).json({ error: 'Saved design not found.' });

    // Only remove objects with explicit ownership-aware keys. Legacy public-URL
    // projects remain readable through private links but are not auto-deleted.
    const keys = [...new Set([
      deleted.beforeKey,
      deleted.afterKey
    ].filter(Boolean))];

    for (const key of keys) {
      const references = await countProjectKeyReferences(key);
      if (references === 0) {
        try {
          await deleteObject(key);
        } catch (err) {
          console.error('Stored image cleanup error:', err);
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Project deletion error:', err);
    res.status(500).json({ error: 'Could not delete saved design.' });
  }
});

router.post('/stripe/create-checkout-session', requireAuth, async (req, res) => {
  try {
    if (!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID)) {
      return res.status(400).json({
        error: 'Billing is not available right now.',
        details: process.env.NODE_ENV === 'production' ? undefined : 'Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to .env to enable checkout.'
      });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const user = await findUserById(req.session.userId);
    let customerId = user?.stripeCustomerId || null;

    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (err) {
        const message = String(err?.message || '').toLowerCase();
        const missingCustomer =
          err?.code === 'resource_missing' ||
          message.includes('no such customer');

        if (!missingCustomer) throw err;

        await updateUserStripeStatus(user.id, {
          plan: 'free',
          stripeCustomerId: null,
          stripeSubscriptionId: null
        });
        customerId = null;
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: String(user.id) }
      });
      customerId = customer.id;
      await updateUserStripeStatus(user.id, { stripeCustomerId: customerId });
    } else {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100
      });
      const existing = subscriptions.data.find(subscription =>
        ['active', 'trialing', 'past_due', 'unpaid'].includes(subscription.status)
      );
      if (existing) {
        return res.status(409).json({
          error: 'YardVision Pro is already connected to this account. Use Manage Billing instead of starting another subscription.'
        });
      }
    }

    const appBaseUrl = (
      process.env.APP_BASE_URL ||
      (process.env.APP_HOST ? `https://${process.env.APP_HOST}` : `http://localhost:${process.env.PORT || 3018}`)
    ).replace(/\/+$/, '');

    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${appBaseUrl}?checkout=success`,
      cancel_url: `${appBaseUrl}?checkout=cancel`,
      metadata: { userId: String(user.id) }
    });

    res.json({ ok: true, url: checkout.url });
  } catch (err) {
    res.status(500).json({
      error: 'Could not create Stripe checkout session.',
      details: clientErrorDetails(err)
    });
  }
});


router.post('/stripe/create-portal-session', requireAuth, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({
        error: 'Stripe billing is not configured yet.'
      });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const user = await findUserById(req.session.userId);
    const customerId = user?.stripeCustomerId || null;

    if (!customerId) {
      return res.status(400).json({
        error: 'No Stripe customer is connected to this account yet.'
      });
    }

    try {
      await stripe.customers.retrieve(customerId);
    } catch (err) {
      const message = String(err?.message || '').toLowerCase();
      const missingCustomer =
        err?.code === 'resource_missing' ||
        message.includes('no such customer');

      if (!missingCustomer) throw err;

      await updateUserStripeStatus(user.id, {
        plan: 'free',
        stripeCustomerId: null,
        stripeSubscriptionId: null
      });

      return res.status(409).json({
        error: 'Your previous test billing connection was cleared. Start YardVision Pro again to connect live billing.',
        code: 'STALE_STRIPE_CUSTOMER'
      });
    }

    const appBaseUrl = (
      process.env.APP_BASE_URL ||
      (process.env.APP_HOST ? `https://${process.env.APP_HOST}` : `http://localhost:${process.env.PORT || 3018}`)
    ).replace(/\/+$/, '');

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl}?billing=return`
    });

    res.json({ ok: true, url: portal.url });
  } catch (err) {
    res.status(500).json({
      error: 'Could not open Stripe billing portal.',
      details: clientErrorDetails(err)
    });
  }
});

async function syncStripeCustomerSubscription(stripe, customerId) {
  const user = await findUserByStripeCustomerId(customerId);
  if (!user) return;

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100
  });

  const activeSubscription = subscriptions.data
    .filter(subscription => ['active', 'trialing'].includes(subscription.status))
    .sort((a, b) => Number(b.created || 0) - Number(a.created || 0))[0] || null;

  await updateUserStripeStatus(user.id, {
    plan: activeSubscription ? 'pro' : 'free',
    stripeSubscriptionId: activeSubscription?.id || null
  });
}

async function stripeWebhookHandler(req, res) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(400).send('Stripe webhook not configured.');
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );

    await recordStripeEvent(event.id, event.type);

    if (event.type === 'checkout.session.completed') {
      const checkout = event.data.object;
      const userId = Number(checkout?.metadata?.userId);
      if (userId) {
        await updateUserStripeStatus(userId, {
          plan: 'pro',
          stripeCustomerId: checkout.customer
        });
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = event.data.object;
      await syncStripeCustomerSubscription(stripe, subscription.customer);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err);
    res.status(400).send(`Webhook error: ${err.message}`);
  }
}

module.exports = { router, stripeWebhookHandler };
