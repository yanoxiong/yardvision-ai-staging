
function appBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, '');
  if (process.env.APP_HOST) return `https://${process.env.APP_HOST}`.replace(/\/+$/, '');
  return `http://localhost:${process.env.PORT || 3018}`;
}

async function sendEmail({ to, subject, html, devUrl }) {
  const mode = (process.env.EMAIL_MODE || 'console').toLowerCase();

  if (mode === 'console') {
    console.log('\n--- YardVision Email (console mode) ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    if (devUrl) console.log('Open this link:', devUrl);
    console.log('--------------------------------------\n');

    return {
      ok: true,
      mode: 'console',
      previewUrl: process.env.NODE_ENV === 'production' ? null : devUrl
    };
  }

  if (mode === 'resend') {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      throw new Error('EMAIL_MODE=resend requires RESEND_API_KEY and EMAIL_FROM.');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        html
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend email failed (${response.status}): ${body}`);
    }

    return { ok: true, mode: 'resend', previewUrl: null };
  }

  throw new Error(`Unsupported EMAIL_MODE: ${mode}`);
}

async function sendVerificationEmail(user, token) {
  const url = `${appBaseUrl()}/?verify=${encodeURIComponent(token)}`;
  return sendEmail({
    to: user.email,
    subject: 'Verify your YardVision AI email',
    devUrl: url,
    html: `
      <h2>Verify your YardVision AI email</h2>
      <p>Hi ${escapeHtml(user.name)},</p>
      <p>Confirm your email to finish setting up your YardVision account.</p>
      <p><a href="${url}">Verify my email</a></p>
      <p>This link expires in 24 hours.</p>
    `
  });
}

async function sendPasswordResetEmail(user, token) {
  const url = `${appBaseUrl()}/?reset=${encodeURIComponent(token)}`;
  return sendEmail({
    to: user.email,
    subject: 'Reset your YardVision AI password',
    devUrl: url,
    html: `
      <h2>Reset your YardVision AI password</h2>
      <p>Hi ${escapeHtml(user.name)},</p>
      <p>Use the link below to set a new password.</p>
      <p><a href="${url}">Reset my password</a></p>
      <p>This link expires in 1 hour.</p>
    `
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
