/**
 * Sends ONE test e-mail using the SMTP_* settings, and prints the exact reason if it fails.
 *   SMTP_HOST=mail.globalsjxltd.com SMTP_PORT=465 SMTP_USER=no-reply@globalsjxltd.com SMTP_PASS='...' \
 *   SMTP_FROM='Global SJX OS <no-reply@globalsjxltd.com>' npm run mail:test -- you@globalsjxltd.com
 * It does not touch the database.
 */
import nodemailer from 'nodemailer';

async function main() {
  const to = process.argv[2];
  const host = process.env.SMTP_HOST || ''; const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER || ''; const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || user;
  if (!to || !/^\S+@\S+\.\S+$/.test(to)) { console.error('Usage: npm run mail:test -- recipient@example.com (and set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM)'); process.exit(1); }
  if (!host) { console.error('SMTP_HOST is not set.'); process.exit(1); }
  console.log(`Connecting to ${host}:${port} (${port === 465 ? 'SSL' : 'STARTTLS'}) as ${user || '(no login)'} ...`);
  const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined, tls: { minVersion: 'TLSv1.2' }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
  try {
    await t.verify(); console.log('OK: connected and logged in.');
    const info = await t.sendMail({ from, to, subject: 'Global SJX OS: e-mail test', text: 'If you can read this, outgoing e-mail from Global SJX OS works.', html: '<p>If you can read this, outgoing e-mail from <b>Global SJX OS</b> works.</p>' });
    console.log('SENT. Server said:', info.response); console.log('Now check the inbox (and the spam folder) of', to);
  } catch (e: any) {
    console.error('FAILED:', e.code || '', e.responseCode || '', e.message);
    const m = String(e.message || '');
    if (/ENOTFOUND|EAI_AGAIN/.test(m + e.code)) console.error('Hint: SMTP_HOST name is wrong.');
    else if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(m + e.code)) console.error('Hint: wrong port, or the network blocks outgoing mail ports (try 465 vs 587).');
    else if (/535|auth/i.test(m)) console.error('Hint: wrong mailbox password or username (use the full address).');
    else if (/certificate|altnames|self.signed/i.test(m)) console.error('Hint: the host name does not match the server certificate. Use the server host name shown in cPanel > Email Accounts > Connect Devices.');
    else if (/553|550|relay|sender/i.test(m)) console.error('Hint: SMTP_FROM must be the same mailbox you log in with (or one the server allows).');
    process.exit(2);
  }
}
main();
