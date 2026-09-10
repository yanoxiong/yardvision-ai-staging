
require('dotenv').config();

function present(name) {
  return !!String(process.env[name] || '').trim();
}
function line(ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

const db = present('DATABASE_URL');
const session = present('SESSION_SECRET') && process.env.SESSION_SECRET !== 'change_this_for_production';
const email =
  (process.env.EMAIL_MODE || '').toLowerCase() === 'resend' &&
  present('RESEND_API_KEY') &&
  present('EMAIL_FROM');
const storage = [
  'STORAGE_BUCKET',
  'STORAGE_ENDPOINT',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY'
].every(present);
const openai = present('OPENAI_API_KEY') && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here';
const stripe = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET'
].every(present);

console.log('\nYardVision AI v8 Staging Readiness\n');
const core = [
  line(openai, 'OpenAI API'),
  line(db, 'PostgreSQL'),
  line(session, 'Session secret'),
  line(email, 'Resend email'),
  line(storage, 'Cloud image storage')
];
line(stripe, 'Stripe subscription stack', 'optional until paid checkout testing');
line(process.env.REQUIRE_EMAIL_VERIFICATION === 'true', 'Email verification enforcement', 'recommended for staging');
line(process.env.NODE_ENV === 'production', 'NODE_ENV=production', 'Render sets this in the included Blueprint');

const ready = core.every(Boolean);
console.log(`\nCore staging readiness: ${ready ? 'READY' : 'NOT READY'}\n`);
process.exitCode = ready ? 0 : 1;
