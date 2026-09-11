
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const session = require('express-session');

const { ensureDatabaseReady, makeStore, getSessionCookieConfig } = require('./src/lib/db');
const { router: apiRouter, stripeWebhookHandler } = require('./src/routes/api');

const app = express();
const PORT = Number(process.env.PORT || 3018);
const publicDir = path.join(__dirname, 'public');


if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change_this_for_production') {
    throw new Error('SESSION_SECRET must be set to a strong secret in production.');
  }
}

const imageSources = ["'self'", 'data:', 'blob:'];
if (process.env.STORAGE_PUBLIC_BASE_URL) {
  try {
    imageSources.push(new URL(process.env.STORAGE_PUBLIC_BASE_URL).origin);
  } catch {
    console.warn('Ignoring invalid STORAGE_PUBLIC_BASE_URL while building CSP.');
  }
}

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production'
    ? {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: imageSources,
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"]
        }
      }
    : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by YardVision CORS policy.'));
  },
  credentials: true
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

const generationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.HOURLY_GENERATION_REQUEST_LIMIT || 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

app.use('/api/auth', authLimiter);
app.use('/api/design', generationLimiter);


app.use(session({
  name: 'yardvision_v8.sid',
  store: makeStore(),
  secret: process.env.SESSION_SECRET || 'yardvision-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: getSessionCookieConfig()
}));

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));
app.use(express.static(publicDir));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.use('/api', apiRouter);

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(publicDir, 'index.html'));
  }
  next();
});

app.use((err, _req, res, _next) => {
  if (err?.message === 'Origin not allowed by YardVision CORS policy.') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  if (err?.message === 'Origin not allowed by YardVision CORS policy.') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  console.error('Server error:', err);
  const payload = { error: 'Unexpected server error.' };
  if (process.env.NODE_ENV !== 'production') {
    payload.details = String(err?.message || err || '');
  }
  res.status(500).json(payload);
});

ensureDatabaseReady()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`YardVision AI running on port ${PORT}`);
      console.log(`Database mode: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'local JSON fallback'}`);
      console.log(`OpenAI configured: ${process.env.OPENAI_API_KEY ? 'YES' : 'NO'}`);
      console.log(`Stripe configured: ${process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID ? 'YES' : 'NO'}`);
    });
  })
  .catch(err => {
    console.error('Database startup error:', err);
    process.exit(1);
  });
