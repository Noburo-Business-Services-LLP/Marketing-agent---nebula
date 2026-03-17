const nodemailer = require('nodemailer');

function createTransporter() {
  const smtpEmail = process.env.SMTP_EMAIL;
  const smtpPassword = process.env.SMTP_PASSWORD;

  if (!smtpEmail || !smtpPassword) {
    throw new Error('SMTP_EMAIL and SMTP_PASSWORD must be configured');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpEmail,
      pass: smtpPassword,
    },
  });
}

async function sendSupportEmail({ name, email, message }) {
  const transporter = createTransporter();

  const smtpEmail = process.env.SMTP_EMAIL;

  await transporter.sendMail({
    from: `Nebulaa Dashboard <${smtpEmail}>`,
    to: 'support@nebulaa.ai',
    replyTo: email || undefined,
    subject: 'New Support Query from Nebulaa Dashboard',
    text: `Name: ${name || ''}
Email: ${email || ''}
Query:
${message}
`,
  });
}

module.exports = {
  sendSupportEmail,
};

