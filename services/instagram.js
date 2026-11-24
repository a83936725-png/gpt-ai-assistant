import axios from 'axios';
import config from '../config/index.js';
import { handleFulfilled, handleRejected, handleRequest } from './utils/index.js';

// Instagram API with Instagram Login: every call goes to graph.instagram.com with the Instagram
// user access token of the professional account it acts for (not a Facebook Page token). With
// several accounts connected, each call carries the token of the account it is about.
const client = axios.create({
  baseURL: `https://graph.instagram.com/${config.INSTAGRAM_API_VERSION}`,
  timeout: config.INSTAGRAM_TIMEOUT,
  headers: {
    'Accept-Encoding': 'gzip, deflate, compress',
  },
});

client.interceptors.request.use(handleRequest);

client.interceptors.response.use(handleFulfilled, (err) => {
  const error = err.response?.data?.error;
  if (error) {
    err.instagram = typeof error === 'object' ? error : { message: String(error), code: null };
    const message = err.instagram.message || err.response?.data?.error_message || err.message;
    const code = err.instagram.code ?? err.response?.data?.code;
    err.message = `${message}${code ? ` (code ${code}${err.instagram.error_subcode ? `/${err.instagram.error_subcode}` : ''})` : ''}`;
  } else if (err.response?.data?.error_message) {
    err.message = err.response.data.error_message;
  }
  return handleRejected(err);
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// Code 190 means the access token expired or was revoked: only a new token fixes it.
const isTokenError = (err) => err?.instagram?.code === 190;

const fetchMe = ({
  token,
}) => client.get('/me', {
  headers: auth(token),
  params: { fields: 'user_id,username' },
});

const fetchMedia = ({
  token,
  mediaId,
}) => client.get(`/${mediaId}`, {
  headers: auth(token),
  params: { fields: 'shortcode,permalink' },
});

// Only works after the person has messaged the account or tapped one of its buttons.
const fetchUserProfile = ({
  token,
  userId,
}) => client.get(`/${userId}`, {
  headers: auth(token),
  params: { fields: 'username,is_user_follow_business' },
});

// A public reply under the comment.
const replyToComment = ({
  token,
  commentId,
  text,
}) => client.post(`/${commentId}/replies`, {
  message: text,
}, {
  headers: auth(token),
});

// A DM to the person who left the comment. Instagram allows one per comment, within 7 days.
const sendPrivateReply = ({
  token,
  commentId,
  message,
}) => client.post('/me/messages', {
  recipient: { comment_id: commentId },
  message,
}, {
  headers: auth(token),
});

// A DM inside the 24-hour window that opens when the person messages or taps a button.
const sendMessage = ({
  token,
  userId,
  message,
}) => client.post('/me/messages', {
  recipient: { id: userId },
  message,
}, {
  headers: auth(token),
});

// Each account has to be subscribed on its own, or Meta sends no webhooks for it.
export const WEBHOOK_FIELDS = ['comments', 'messages', 'messaging_postbacks'];

const subscribeApp = ({
  token,
  fields = WEBHOOK_FIELDS,
}) => client.post('/me/subscribed_apps', null, {
  headers: auth(token),
  params: { subscribed_fields: fields.join(',') },
});

const fetchSubscribedApps = ({
  token,
}) => client.get('/me/subscribed_apps', {
  headers: auth(token),
});

const refreshAccessToken = ({
  token,
}) => client.get('https://graph.instagram.com/refresh_access_token', {
  params: { grant_type: 'ig_refresh_token', access_token: token },
});

// Business Login for Instagram: the code from the login page → a short-lived token → a 60-day token.
const exchangeCode = ({
  code,
  redirectUri,
}) => client.post('https://api.instagram.com/oauth/access_token', new URLSearchParams({
  client_id: config.INSTAGRAM_APP_ID,
  client_secret: config.INSTAGRAM_APP_SECRET,
  grant_type: 'authorization_code',
  redirect_uri: redirectUri,
  code,
}).toString(), {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});

const exchangeLongLivedToken = ({
  token,
}) => client.get('https://graph.instagram.com/access_token', {
  params: { grant_type: 'ig_exchange_token', client_secret: config.INSTAGRAM_APP_SECRET, access_token: token },
});

export {
  isTokenError,
  fetchMe,
  fetchMedia,
  fetchUserProfile,
  replyToComment,
  sendPrivateReply,
  sendMessage,
  subscribeApp,
  fetchSubscribedApps,
  refreshAccessToken,
  exchangeCode,
  exchangeLongLivedToken,
};
