import './instagram.env.js';
import {
  afterAll, beforeAll, beforeEach, expect, test,
} from '@jest/globals';
import { createHmac } from 'crypto';

const mock = globalThis.instagramMock;
const FAN_ID = '9000000000000001';
const ACCOUNTS = {
  'token-a': { user_id: '1784000000000000A', id: 'app-scoped-a', username: 'brand_a' },
  'token-b': { user_id: '1784000000000000B', id: 'app-scoped-b', username: 'brand_b' },
  'token-c': { user_id: '1784000000000000C', id: 'app-scoped-c', username: 'brand_c' },
};
const A = ACCOUNTS['token-a'].user_id;
const B = ACCOUNTS['token-b'].user_id;
const C = ACCOUNTS['token-c'].user_id;

let server;
let base;
let autoreply;
let reset;
let follows;
let failProfile;
let brokenTokens;

beforeAll(async () => {
  const { default: app } = await import('../api/index.js');
  autoreply = await import('../instagram/autoreply.js');
  const { resetNotify } = await import('../instagram/notify.js');
  const { resetAccounts } = await import('../instagram/accounts.js');
  const { resetStore } = await import('../instagram/store.js');
  reset = () => {
    resetNotify();
    resetAccounts();
    resetStore();
    autoreply.resetAutoreply();
  };
  server = app.listen(0);
  await new Promise((resolve) => { server.once('listening', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => { server.close(resolve); }));

const RULES = [
  {
    id: 'reel1',
    account: '',
    keywords: ['課程'],
    posts: ['https://www.instagram.com/reel/ReelAAA111/'],
    commentReplies: ['私訊你囉'],
    dmText: '按下面拿課程連結',
    buttonTitle: '給我連結',
    requireFollow: true,
    notFollowingText: '先追蹤再按一次',
    linkText: '課程連結在這',
    linkTitle: '打開',
    link: 'https://shop.test/course',
  },
  {
    id: 'onlyb',
    account: '@brand_b',
    keywords: ['優惠'],
    posts: [],
    commentReplies: [],
    dmText: 'B 的優惠',
    buttonTitle: '給我',
    requireFollow: false,
    linkText: 'B 的優惠連結',
    link: 'https://shop.test/b',
  },
  {
    id: 'all',
    account: '',
    keywords: ['連結', 'LINK'],
    posts: [],
    commentReplies: [],
    dmText: '按下面拿連結',
    buttonTitle: '給我',
    requireFollow: false,
    linkText: '連結在這',
    link: 'https://shop.test/all',
  },
];

beforeEach(() => {
  reset();
  mock.requests = [];
  follows = true;
  failProfile = false;
  brokenTokens = new Set();
  autoreply.setRules({ settings: { enabled: true, testUsernames: [] }, rules: RULES });
  mock.respond = (req) => {
    if (req.url.startsWith('https://api.line.me')) return { data: {} };
    if (req.url === 'https://api.instagram.com/oauth/access_token') {
      return req.data.code === 'good-code' && req.data.client_id === 'test-app-id' && req.data.client_secret === 'test-app-secret'
        ? { data: { access_token: 'short-c', user_id: C, permissions: 'instagram_business_basic' } }
        : { status: 400, data: { error_type: 'OAuthException', code: 400, error_message: 'Invalid code' } };
    }
    if (req.url.startsWith('https://graph.instagram.com/access_token')) {
      return { data: { access_token: 'token-c', token_type: 'bearer', expires_in: 5184000 } };
    }
    if (req.url.includes('refresh_access_token')) return { data: { access_token: req.params.access_token, token_type: 'bearer', expires_in: 5184000 } };
    const me = ACCOUNTS[req.token];
    if (!me || brokenTokens.has(req.token)) {
      return { status: 400, data: { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } } };
    }
    if (req.path === '/me') return { data: me };
    if (req.path === '/me/subscribed_apps') return req.method === 'GET' ? { data: { data: [{ subscribed_fields: ['comments', 'messages', 'messaging_postbacks'] }] } } : { data: { success: true } };
    if (req.path === '/me/messages') return { data: { recipient_id: FAN_ID, message_id: 'm1' } };
    if (req.path.endsWith('/replies')) return { data: { id: 'reply-1' } };
    if (req.path === '/media-reel') return { data: { shortcode: 'ReelAAA111' } };
    if (req.path === '/media-other') return { data: { shortcode: 'OtherBBB22' } };
    if (req.path === `/${FAN_ID}`) {
      if (failProfile) return { status: 400, data: { error: { message: 'User consent is required', code: 230 } } };
      return { data: { username: 'fan', is_user_follow_business: follows } };
    }
    return { status: 404, data: { error: { message: `unexpected ${req.path}`, code: 100 } } };
  };
});

const commentEvent = ({
  account = A, id = 'c1', text = '我要連結', mediaId = 'media-other', from = { id: FAN_ID, username: 'fan' },
} = {}) => ({
  object: 'instagram',
  entry: [{
    id: account,
    time: 1,
    changes: [{
      field: 'comments',
      value: {
        id, text, from, media: { id: mediaId, media_product_type: 'REELS' },
      },
    }],
  }],
});

const tapEvent = (payload, { account = A, mid = 'tap-1' } = {}) => ({
  object: 'instagram',
  entry: [{
    id: account,
    time: 1,
    messaging: [{
      sender: { id: FAN_ID }, recipient: { id: account }, timestamp: 1, postback: { mid, title: '給我', payload },
    }],
  }],
});

const post = (body, { sign = true, secret = 'test-app-secret' } = {}) => {
  const raw = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  if (sign) headers['X-Hub-Signature-256'] = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return fetch(`${base}/instagram/webhook`, { method: 'POST', headers, body: raw });
};

const admin = (path, { method = 'GET', body, password = 'test-admin' } = {}) => fetch(`${base}/instagram/admin/api/${path}`, {
  method,
  headers: { 'x-admin-password': password, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

const sent = () => mock.requests.filter((r) => r.method === 'POST' && (r.path === '/me/messages' || r.path.endsWith('/replies')));
const linePushes = () => mock.requests.filter((r) => r.url.startsWith('https://api.line.me'));

// --- Webhook ---------------------------------------------------------------------------------

test('answers Meta\'s webhook verification only with the right verify token', async () => {
  const ok = await fetch(`${base}/instagram/webhook?hub.mode=subscribe&hub.verify_token=test-doorbell&hub.challenge=12345`);
  expect(ok.status).toBe(200);
  expect(await ok.text()).toBe('12345');
  const wrong = await fetch(`${base}/instagram/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345`);
  expect(wrong.status).toBe(403);
});

test('rejects deliveries that Meta did not sign', async () => {
  expect((await post(commentEvent(), { sign: false })).status).toBe(403);
  expect((await post(commentEvent(), { secret: 'someone-else' })).status).toBe(403);
  expect(sent()).toEqual([]);
});

test('a keyword comment gets a DM with a button and a public reply', async () => {
  const res = await post(commentEvent({ id: 'c-reel', text: '想看課程！', mediaId: 'media-reel' }));
  expect(res.status).toBe(200);
  const [dm, reply] = sent();
  expect(dm.path).toBe('/me/messages');
  expect(dm.token).toBe('token-a');
  expect(dm.data.recipient).toEqual({ comment_id: 'c-reel' });
  expect(dm.data.message.attachment.payload).toEqual({
    template_type: 'button',
    text: '按下面拿課程連結',
    buttons: [{ type: 'postback', title: '給我連結', payload: 'IGAR:reel1' }],
  });
  expect(reply.path).toBe('/c-reel/replies');
  expect(reply.data).toEqual({ message: '私訊你囉' });
});

test('each account answers with its own token', async () => {
  await post(commentEvent({ account: A, id: 'c-a' }));
  await post(commentEvent({ account: B, id: 'c-b' }));
  expect(sent().map((r) => [r.data.recipient.comment_id, r.token])).toEqual([['c-a', 'token-a'], ['c-b', 'token-b']]);
});

test('a rule for one account does not fire on another', async () => {
  await post(commentEvent({ account: A, id: 'c-a-deal', text: '優惠' }));
  expect(sent()).toEqual([]);
  await post(commentEvent({ account: B, id: 'c-b-deal', text: '有優惠嗎' }));
  expect(sent()[0].data.message.attachment.payload.buttons[0].payload).toBe('IGAR:onlyb');
  mock.requests = [];
  await post(tapEvent('IGAR:onlyb', { account: A, mid: 'tap-cross' }));
  expect(sent()[0].data.message).toEqual({ text: '這個活動已經結束囉，謝謝你的支持 🙏' });
});

test('comments for an account that is not connected are ignored', async () => {
  await post(commentEvent({ account: '17840000NOTOURS', id: 'c-stranger' }));
  expect(sent()).toEqual([]);
});

test('keywords ignore case, spaces and full-width letters', async () => {
  await post(commentEvent({ id: 'c-wide', text: 'ｌｉｎｋ please' }));
  expect(sent()).toHaveLength(1);
  expect(sent()[0].data.message.attachment.payload.buttons[0].payload).toBe('IGAR:all');
});

test('a rule limited to one Reel does not fire on other posts', async () => {
  await post(commentEvent({ id: 'c-other', text: '課程', mediaId: 'media-other' }));
  expect(sent()).toEqual([]);
});

test('the sample rule from rules.js never fires until its link is replaced', async () => {
  const { rules, settings } = await import('../instagram/rules.js');
  autoreply.setRules({ settings, rules });
  await post(commentEvent({ id: 'c-sample', text: '請給我連結' }));
  expect(sent()).toEqual([]);
  expect(autoreply.checkRules({ rules }).join('\n')).toContain('範例網址');
});

test('comments without a keyword, from the account itself, or resent by Meta are ignored', async () => {
  await post(commentEvent({ id: 'c-none', text: '好可愛' }));
  await post(commentEvent({ id: 'c-own', text: '連結在私訊', from: { id: A, username: 'brand_a' } }));
  await post(commentEvent({ id: 'c-own2', text: '連結在私訊', from: { id: '555', username: 'Brand_A' } }));
  expect(sent()).toEqual([]);
  await post(commentEvent({ id: 'c-twice' }));
  await post(commentEvent({ id: 'c-twice' }));
  expect(sent()).toHaveLength(1);
});

test('the test list limits who can trigger it, and the switch turns it off', async () => {
  autoreply.setRules({ settings: { enabled: true, testUsernames: ['@tester'] }, rules: RULES });
  await post(commentEvent({ id: 'c-fan' }));
  expect(sent()).toEqual([]);
  await post(commentEvent({ id: 'c-tester', from: { id: FAN_ID, username: 'Tester' } }));
  expect(sent()).toHaveLength(1);
  autoreply.setRules({ settings: { enabled: false, testUsernames: [] }, rules: RULES });
  mock.requests = [];
  await post(commentEvent({ id: 'c-off' }));
  expect(sent()).toEqual([]);
});

test('tapping the button without following asks them to follow first', async () => {
  follows = false;
  await post(tapEvent('IGAR:reel1', { account: B }));
  const [message] = sent();
  expect(message.token).toBe('token-b');
  expect(message.data.recipient).toEqual({ id: FAN_ID });
  expect(message.data.message.attachment.payload.text).toBe('先追蹤再按一次');
  expect(message.data.message.attachment.payload.buttons[0].payload).toBe('IGAR:reel1');
});

test('tapping again after following sends the link', async () => {
  await post(tapEvent('IGAR:reel1', { mid: 'tap-2' }));
  const [message] = sent();
  expect(message.data.message.attachment.payload).toEqual({
    template_type: 'button',
    text: '課程連結在這',
    buttons: [{ type: 'web_url', url: 'https://shop.test/course', title: '打開' }],
  });
});

test('a rule without the follow requirement skips the check, and an unknown follow status still gets the link', async () => {
  await post(tapEvent('IGAR:all', { mid: 'tap-3' }));
  expect(mock.requests.some((r) => r.path === `/${FAN_ID}`)).toBe(false);
  expect(sent()[0].data.message.attachment.payload.buttons[0].url).toBe('https://shop.test/all');
  mock.requests = [];
  failProfile = true;
  await post(tapEvent('IGAR:reel1', { mid: 'tap-4' }));
  expect(sent()[0].data.message.attachment.payload.buttons[0].url).toBe('https://shop.test/course');
});

test('buttons that are not ours are ignored', async () => {
  await post(tapEvent('SOMETHING_ELSE', { mid: 'tap-6' }));
  expect(sent()).toEqual([]);
});

test('an expired token is reported on LINE once per account, and Meta still gets 200', async () => {
  await post(commentEvent({ account: B, id: 'c-warm' }));
  brokenTokens.add('token-b');
  mock.requests = [];
  expect((await post(commentEvent({ account: B, id: 'c-broken-1' }))).status).toBe(200);
  expect((await post(commentEvent({ account: B, id: 'c-broken-2' }))).status).toBe(200);
  const pushes = linePushes();
  expect(pushes).toHaveLength(1);
  expect(pushes[0].data.to).toBe('U-owner');
  expect(pushes[0].data.messages[0].text).toContain('@brand_b');
  mock.requests = [];
  await post(commentEvent({ account: A, id: 'c-a-still-fine' }));
  expect(sent()[0].token).toBe('token-a');
});

test('checkRules points out what would stop a rule from working', () => {
  const problems = autoreply.checkRules({
    rules: [
      { id: 'a', keywords: ['x'], link: 'https://example.com' },
      {
        id: 'a', keywords: [], link: 'shop.test', buttonTitle: '這是一個超過二十個字的按鈕文字一定會被擋下來',
      },
    ],
  });
  expect(problems.join('\n')).toContain('範例網址');
  expect(problems.join('\n')).toContain('重複');
  expect(problems.join('\n')).toContain('沒有關鍵字');
  expect(problems.join('\n')).toContain('http');
  expect(problems.join('\n')).toContain('20 個字');
  expect(autoreply.checkRules({ rules: RULES })).toEqual([]);
});

test('toShortcode understands Reel and post URLs', () => {
  expect(autoreply.toShortcode('https://www.instagram.com/reel/DgG5reYocTt/?igsh=abc')).toBe('DgG5reYocTt');
  expect(autoreply.toShortcode('https://www.instagram.com/mybrand/reel/DgG5reYocTt/')).toBe('DgG5reYocTt');
  expect(autoreply.toShortcode('https://instagram.com/p/ABC_123-x/')).toBe('ABC_123-x');
  expect(autoreply.toShortcode(' 17900000000000000 ')).toBe('17900000000000000');
});

// --- Pages, status and cron ------------------------------------------------------------------

test('serves the privacy policy and data deletion pages Meta asks for', async () => {
  const privacy = await fetch(`${base}/instagram/privacy`);
  expect(privacy.status).toBe(200);
  expect(await privacy.text()).toContain('隱私權政策');
  const deletion = await fetch(`${base}/instagram/data-deletion`);
  expect(deletion.status).toBe(200);
  expect(await deletion.text()).toContain('資料刪除');
});

test('the status page needs the verify token and lists every account', async () => {
  expect((await fetch(`${base}/instagram/status`)).status).toBe(403);
  const res = await fetch(`${base}/instagram/status?key=test-doorbell`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('/instagram/webhook');
  expect(html).toContain('@brand_a');
  expect(html).toContain('@brand_b');
  expect(html).not.toContain('token-a');
  expect(html).not.toContain('test-app-secret');
});

test('the daily cron needs the cron secret, refreshes every token and stays quiet when all is well', async () => {
  expect((await fetch(`${base}/instagram/cron`)).status).toBe(401);
  const res = await fetch(`${base}/instagram/cron`, { headers: { Authorization: 'Bearer test-cron' } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.urgent).toBe(false);
  expect(body.notified).toBe(false);
  expect(body.report).toContain('@brand_a');
  expect(body.report).toContain('@brand_b');
  const refreshed = mock.requests.filter((r) => r.url.includes('refresh_access_token')).map((r) => r.params.access_token).sort();
  expect(refreshed).toEqual(['token-a', 'token-b']);
});

test('refreshing several accounts at once keeps every refreshed token', async () => {
  const { addAccount, loadAccounts, refreshAccount } = await import('../instagram/accounts.js');
  await addAccount({ token: 'token-c', source: 'login', expiresIn: 100 });
  const accounts = await loadAccounts({ fresh: true });
  await Promise.all(accounts.map((account) => refreshAccount(account, { force: true })));
  const after = await loadAccounts({ fresh: true });
  expect(after.map((a) => [a.username, a.source, a.expiresAt > Date.now() + 50 * 86400000])).toEqual([
    ['brand_a', 'env', true], ['brand_b', 'env', true], ['brand_c', 'login', true],
  ]);
});

test('the daily cron tells the owner on LINE when one account\'s token is broken', async () => {
  brokenTokens.add('token-b');
  const res = await fetch(`${base}/instagram/cron`, { headers: { Authorization: 'Bearer test-cron' } });
  const body = await res.json();
  expect(body.urgent).toBe(true);
  expect(body.notified).toBe(true);
  expect(body.report).toContain('✅ @brand_a');
  expect(linePushes()[0].data.messages[0].text).toContain('權杖失效');
});

// --- Admin page ------------------------------------------------------------------------------

test('the admin page loads, and its API needs the password', async () => {
  const page = await fetch(`${base}/instagram/admin`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('IG 自動回覆後台');
  expect((await admin('state', { password: 'wrong' })).status).toBe(401);
  expect((await admin('state', { password: '' })).status).toBe(401);
});

test('the admin state lists accounts and URLs without ever sending a token', async () => {
  const res = await admin('state');
  expect(res.status).toBe(200);
  const raw = await res.text();
  expect(raw).not.toContain('token-a');
  expect(raw).not.toContain('token-b');
  const state = JSON.parse(raw);
  expect(state.accounts.map((a) => [a.username, a.source, a.ok, a.missing])).toEqual([['brand_a', 'env', true, []], ['brand_b', 'env', true, []]]);
  expect(state.urls.webhook).toMatch(/\/instagram\/webhook$/);
  expect(state.urls.redirect).toMatch(/\/instagram\/oauth\/callback$/);
  expect(state.loginReady).toBe(true);
});

test('rules saved on the admin page take effect at once', async () => {
  autoreply.setRules(null);
  const saved = await admin('rules', {
    method: 'PUT',
    body: {
      settings: { enabled: true, testUsernames: '' },
      rules: [{
        id: 'saved', account: 'brand_b', keywords: '團購\n+1', link: 'https://shop.test/group', buttonTitle: '給我', dmText: '團購連結 👇', requireFollow: false, extra: 'dropped',
      }],
    },
  });
  expect(saved.status).toBe(200);
  expect((await saved.json()).problems).toEqual([]);
  await post(commentEvent({ account: B, id: 'c-group', text: '+1' }));
  expect(sent()[0].data.message.attachment.payload.buttons[0].payload).toBe('IGAR:saved');
  mock.requests = [];
  await post(commentEvent({ account: A, id: 'c-group-a', text: '團購' }));
  expect(sent()).toEqual([]);
  const state = await (await admin('state')).json();
  expect(state.rulesSource).toBe('admin');
  expect(state.rules[0]).not.toHaveProperty('extra');
});

test('an account can be paused and resumed from the admin page', async () => {
  expect((await admin(`accounts/${B}/pause`, { method: 'POST', body: { paused: true } })).status).toBe(200);
  await post(commentEvent({ account: B, id: 'c-paused' }));
  await post(commentEvent({ account: A, id: 'c-not-paused' }));
  expect(sent().map((r) => r.token)).toEqual(['token-a']);
  await admin(`accounts/${B}/pause`, { method: 'POST', body: { paused: false } });
  mock.requests = [];
  await post(commentEvent({ account: B, id: 'c-resumed' }));
  expect(sent().map((r) => r.token)).toEqual(['token-b']);
});

test('a pasted token adds an account, subscribes it to webhooks and it can be removed', async () => {
  const bad = await admin('accounts', { method: 'POST', body: { token: 'not-a-token' } });
  expect(bad.status).toBe(400);
  const res = await admin('accounts', { method: 'POST', body: { token: 'token-c' } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, username: 'brand_c', subscribed: true });
  const subscribe = mock.requests.find((r) => r.method === 'POST' && r.path === '/me/subscribed_apps');
  expect(subscribe.token).toBe('token-c');
  expect(subscribe.params.subscribed_fields).toBe('comments,messages,messaging_postbacks');
  await post(commentEvent({ account: C, id: 'c-c' }));
  expect(sent()[0].token).toBe('token-c');
  expect((await admin(`accounts/${A}`, { method: 'DELETE' })).status).toBe(400);
  expect((await admin(`accounts/${C}`, { method: 'DELETE' })).status).toBe(200);
  const state = await (await admin('state')).json();
  expect(state.accounts.map((a) => a.username)).toEqual(['brand_a', 'brand_b']);
});

test('log in with Instagram connects an account', async () => {
  const { url } = await (await admin('connect', { method: 'POST' })).json();
  const login = new URL(url);
  expect(login.origin + login.pathname).toBe('https://www.instagram.com/oauth/authorize');
  expect(login.searchParams.get('client_id')).toBe('test-app-id');
  expect(login.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments');
  const redirectUri = login.searchParams.get('redirect_uri');
  expect(redirectUri).toMatch(/\/instagram\/oauth\/callback$/);
  const state = login.searchParams.get('state');

  const forged = await fetch(`${base}/instagram/oauth/callback?code=good-code&state=${encodeURIComponent(`${Date.now()}.x.forged`)}`, { redirect: 'manual' });
  expect(decodeURIComponent(forged.headers.get('location'))).toContain('error=');

  const back = await fetch(`${base}/instagram/oauth/callback?code=good-code%23_&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  expect(back.status).toBe(302);
  expect(back.headers.get('location')).toBe('/instagram/admin?connected=brand_c');
  const exchange = mock.requests.find((r) => r.url === 'https://api.instagram.com/oauth/access_token');
  expect(exchange.data).toMatchObject({ grant_type: 'authorization_code', redirect_uri: redirectUri, code: 'good-code' });
  const { accounts } = await (await admin('state')).json();
  expect(accounts.find((a) => a.username === 'brand_c')).toMatchObject({ source: 'login', ok: true });
  expect(accounts.find((a) => a.username === 'brand_c').expiresAt).toBeGreaterThan(Date.now());
});

test('login state expires and cannot be forged', async () => {
  const { makeState, checkState } = await import('../instagram/index.js');
  const state = makeState(1000);
  expect(checkState(state, 2000)).toBe(true);
  expect(checkState(state, 1000 + 16 * 60 * 1000)).toBe(false);
  expect(checkState(`${state}x`, 2000)).toBe(false);
  expect(checkState('', 2000)).toBe(false);
});
