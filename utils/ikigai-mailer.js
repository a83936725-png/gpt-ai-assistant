import axios from 'axios';
import nodemailer from 'nodemailer';
import config from '../config/index.js';
import { getMailSettings } from './ikigai-records.js';

// Sends mail through Resend (RESEND_API_KEY), an SMTP server from environment variables
// (IKIGAI_SMTP_USER / IKIGAI_SMTP_PASS), or a Gmail account saved on the admin page.
const DEFAULT_NAME = 'IKIGAI 生涯羅盤';
const SETTINGS_TTL_MS = 60 * 1000;
let testTransport = null;
let smtp = null;
let smtpKey = '';
let cached = { at: 0, value: null };

const envSource = () => {
  if (config.RESEND_API_KEY && config.IKIGAI_MAIL_FROM) return 'resend';
  if (config.IKIGAI_SMTP_USER && config.IKIGAI_SMTP_PASS) return 'env';
  return null;
};

const savedSettings = async () => {
  if (Date.now() - cached.at < SETTINGS_TTL_MS) return cached.value;
  let value = null;
  try {
    value = await getMailSettings();
  } catch (err) {
    console.error(`[ikigai] mail settings: ${err.message}`);
  }
  cached = { at: Date.now(), value };
  return value;
};

/** Forget cached settings, after the admin saves new ones. */
export const resetMailCache = () => {
  cached = { at: 0, value: null };
};

/** Which sending account is in use: 'resend', 'env', 'admin' or null. */
export const mailSource = async () => {
  if (testTransport) return 'test';
  const env = envSource();
  if (env) return env;
  const saved = await savedSettings();
  return saved && saved.user && saved.pass ? 'admin' : null;
};

export const mailConfigured = async () => Boolean(await mailSource());

/** Replaces real sending in tests; pass null to restore. */
export const setTestTransport = (fn) => {
  testTransport = fn;
};

const gmailTransport = ({ user, pass }) => nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass }, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
});

/**
 * Checks that a Gmail address and app password can log in, without sending anything.
 * @returns {Promise<void>} Rejects when the login fails.
 */
export const verifyGmail = async (account) => {
  if (testTransport) return;
  await gmailTransport(account).verify();
};

/**
 * @param {{ to: string, subject: string, html: string, text: string }} mail
 */
export const sendMail = async (mail) => {
  const source = await mailSource();
  if (testTransport) {
    return testTransport({
      ...mail, from: config.IKIGAI_MAIL_FROM || config.IKIGAI_SMTP_USER, replyTo: config.IKIGAI_MAIL_REPLY_TO || undefined,
    });
  }
  const replyTo = config.IKIGAI_MAIL_REPLY_TO || undefined;
  if (source === 'resend') {
    await axios.post('https://api.resend.com/emails', {
      from: config.IKIGAI_MAIL_FROM, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, reply_to: replyTo,
    }, { headers: { Authorization: `Bearer ${config.RESEND_API_KEY}` }, timeout: 15000 });
    return { provider: 'resend' };
  }
  if (source === 'env') {
    if (smtpKey !== 'env') {
      smtp = nodemailer.createTransport({
        host: config.IKIGAI_SMTP_HOST,
        port: config.IKIGAI_SMTP_PORT,
        secure: config.IKIGAI_SMTP_PORT === 465,
        auth: { user: config.IKIGAI_SMTP_USER, pass: config.IKIGAI_SMTP_PASS },
      });
      smtpKey = 'env';
    }
    await smtp.sendMail({ ...mail, from: config.IKIGAI_MAIL_FROM || config.IKIGAI_SMTP_USER, replyTo });
    return { provider: 'smtp' };
  }
  if (source === 'admin') {
    const saved = await savedSettings();
    const key = `${saved.user}:${saved.pass}`;
    if (smtpKey !== key) {
      smtp = gmailTransport(saved);
      smtpKey = key;
    }
    // Gmail only sends as the signed-in account, so the address is always that account.
    const name = (saved.name || DEFAULT_NAME).replace(/["\\]/g, '');
    await smtp.sendMail({ ...mail, from: `"${name}" <${saved.user}>`, replyTo });
    return { provider: 'gmail' };
  }
  throw new Error('mail is not configured');
};
