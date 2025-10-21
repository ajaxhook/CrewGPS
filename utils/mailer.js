const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

transporter.verify().then(() => {
  console.log('📧 SMTP pronto para enviar emails');
}).catch((err) => {
  console.warn('📧 SMTP não verificado:', err?.message || err);
});

async function sendMail({ to, subject, html, text, from }) {
  const mailFrom = from || process.env.EMAIL_FROM || process.env.SMTP_USER;
  if (!mailFrom) throw new Error('Remetente não definido (EMAIL_FROM/SMTP_USER)');

  return transporter.sendMail({
    from: mailFrom,
    to,
    subject,
    text,
    html
  });
}

module.exports = { transporter, sendMail };
