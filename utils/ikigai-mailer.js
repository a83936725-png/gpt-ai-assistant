import axios from 'axios';
import nodemailer from 'nodemailer';
import config from '../config/index.js';

// Sends mail through Resend (RESEND_API_KEY) or any SMTP server such as Gmail (IKIGAI_SMTP_USER / IKIGAI_SMTP_PASS).
let testTransport = null;
let smtp = null;

export const mailConfigured = () => Boolean(testTransport
  || (config.RESEND_API_KEY && config.IKIGAI_MAIL_FROM)
  || (config.IKIGAI_SMTP_USER && config.IKIGAI_SMTP_PASS));

/** Replaces real sending in tests; pass null to restore. */
export const setTestTransport = (fn) => {
  testTransport = fn;
};

/**
 * @param {{ to: string, subject: string, html: string, text: string }} mail
 */
export const sendMail = async (mail) => {
  const from = config.IKIGAI_MAIL_FROM || config.IKIGAI_SMTP_USER;
  const message = {
    ...mail, from, replyTo: config.IKIGAI_MAIL_REPLY_TO || undefined,
  };
  if (testTransport) return testTransport(message);
  if (config.RESEND_API_KEY && config.IKIGAI_MAIL_FROM) {
    await axios.post('https://api.resend.com/emails', {
      from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, reply_to: message.replyTo,
    }, { headers: { Authorization: `Bearer ${config.RESEND_API_KEY}` }, timeout: 15000 });
    return { provider: 'resend' };
  }
  if (!smtp) {
    smtp = nodemailer.createTransport({
      host: config.IKIGAI_SMTP_HOST,
      port: config.IKIGAI_SMTP_PORT,
      secure: config.IKIGAI_SMTP_PORT === 465,
      auth: { user: config.IKIGAI_SMTP_USER, pass: config.IKIGAI_SMTP_PASS },
    });
  }
  await smtp.sendMail(message);
  return { provider: 'smtp' };
};
