// Imported first by instagram.test.js: config is read once at import, so the environment has to be
// in place before any app module loads. Every axios instance created afterwards answers from
// globalThis.instagramMock instead of the network, so Instagram and LINE calls can be checked.
import axios, { AxiosError } from 'axios';

// Two Instagram accounts from Vercel; a third one is connected from the admin page in the tests.
process.env.INSTAGRAM_ACCESS_TOKEN = 'token-a';
process.env.INSTAGRAM_ACCESS_TOKEN_2 = 'token-b';
process.env.INSTAGRAM_APP_ID = 'test-app-id';
process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';
process.env.INSTAGRAM_ADMIN_PASSWORD = 'test-admin';
process.env.INSTAGRAM_VERIFY_TOKEN = 'test-doorbell';
process.env.INSTAGRAM_NOTIFY_LINE_IDS = 'U-owner';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
process.env.CRON_SECRET = 'test-cron';
delete process.env.INSTAGRAM_BLOB_READ_WRITE_TOKEN;
delete process.env.IKIGAI_BLOB_READ_WRITE_TOKEN;

const mock = {
  requests: [],
  respond: () => ({}),
};
globalThis.instagramMock = mock;

const adapter = async (c) => {
  const url = /^https?:/.test(c.url) ? c.url : `${c.baseURL}${c.url}`;
  const request = {
    method: c.method.toUpperCase(),
    url,
    path: url.replace(/^https:\/\/graph\.instagram\.com\/v[\d.]+/, ''),
    params: c.params || {},
    data: (() => {
      if (typeof c.data !== 'string') return c.data;
      try { return JSON.parse(c.data); } catch (err) { return Object.fromEntries(new URLSearchParams(c.data)); }
    })(),
    authorization: c.headers?.Authorization,
    token: String(c.headers?.Authorization || '').replace(/^Bearer /, '') || c.params?.access_token,
  };
  mock.requests.push(request);
  const { status = 200, data = {} } = (await mock.respond(request)) || {};
  const response = {
    data, status, statusText: String(status), headers: {}, config: c, request: {},
  };
  if (status >= 400) throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', c, {}, response);
  return response;
};

const create = axios.create.bind(axios);
axios.create = (options = {}) => create({ ...options, adapter });
