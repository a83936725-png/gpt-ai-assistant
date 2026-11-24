import axios from 'axios';
import config from '../config/index.js';
import { handleFulfilled, handleRejected, handleRequest } from './utils/index.js';

// Instagram API with Instagram Login: every call goes to graph.instagram.com with the
// Instagram user access token of the professional account (not a Facebook Page token).
const client = axios.create({
  baseURL: `https://graph.instagram.com/${config.INSTAGRAM_API_VERSION}`,
  timeout: config.INSTAGRAM_TIMEOUT,
  headers: {
    'Accept-Encoding': 'gzip, deflate, compress',
  },
});

// The token can be refreshed at run time (see instagram/token.js), so it is looked up per request.
let resolveToken = async () => config.INSTAGRAM_ACCESS_TOKEN;
const setTokenResolver = (resolver) => {
  resolveToken = resolver;
};

client.interceptors.request.use(async (c) => {
  if (!c.params?.access_token) c.headers.Authorization = `Bearer ${await resolveToken()}`;
  return handleRequest(c);
});

client.interceptors.response.use(handleFulfilled, (err) => {
  const error = err.response?.data?.error;
  if (error) {
    err.instagram = error;
    err.message = `${error.message} (code ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ''})`;
  }
  return handleRejected(err);
});

// Code 190 means the access token expired or was revoked: only a new token fixes it.
const isTokenError = (err) => err?.instagram?.code === 190;

const fetchMe = () => client.get('/me', {
  params: { fields: 'user_id,username' },
});

const fetchMedia = ({
  mediaId,
}) => client.get(`/${mediaId}`, {
  params: { fields: 'shortcode,permalink' },
});

// Only works after the person has messaged the account or tapped one of its buttons.
const fetchUserProfile = ({
  userId,
}) => client.get(`/${userId}`, {
  params: { fields: 'username,is_user_follow_business' },
});

// A public reply under the comment.
const replyToComment = ({
  commentId,
  text,
}) => client.post(`/${commentId}/replies`, {
  message: text,
});

// A DM to the person who left the comment. Instagram allows one per comment, within 7 days.
const sendPrivateReply = ({
  commentId,
  message,
}) => client.post('/me/messages', {
  recipient: { comment_id: commentId },
  message,
});

// A DM inside the 24-hour window that opens when the person messages or taps a button.
const sendMessage = ({
  userId,
  message,
}) => client.post('/me/messages', {
  recipient: { id: userId },
  message,
});

const refreshAccessToken = ({
  token,
}) => client.get('https://graph.instagram.com/refresh_access_token', {
  params: { grant_type: 'ig_refresh_token', access_token: token },
});

export {
  setTokenResolver,
  isTokenError,
  fetchMe,
  fetchMedia,
  fetchUserProfile,
  replyToComment,
  sendPrivateReply,
  sendMessage,
  refreshAccessToken,
};
