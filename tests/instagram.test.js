import './instagram.env.js';
import {
  afterAll, beforeAll, beforeEach, expect, test,
} from '@jest/globals';
import { createHmac } from 'crypto';

const mock = globalThis.instagramMock;
const OWN_ID = '17841400000000001';
const FAN_ID = '9000000000000001';

let server;
let base;
let autoreply;
let resetNotify;
let resetTokenCache;
let follows;
let failProfile;
let tokenBroken;

beforeAll(async () => {
  const { default: app } = await import('../api/index.js');
  autoreply = await import('../instagram/autoreply.js');
  ({ resetNotify } = await import('../instagram/notify.js'));
  ({ resetTokenCache } = await import('../instagram/token.js'));
  server = app.listen(0);
  await new Promise((resolve) => { server.once('listening', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => { server.close(resolve); }));

const RULES = [
  {
    id: 'reel1',
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
    id: 'all',
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
  mock.requests = [];
  follows = true;
  failProfile = false;
  tokenBroken = false;
  autoreply.resetAutoreply();
  autoreply.setRules({ settings: { enabled: true, testUsernames: [] }, rules: RULES });
  resetNotify();
  resetTokenCache();
  mock.respond = (req) => {
    const tokenError = { status: 400, data: { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } } };
    if (req.url.startsWith('https://api.line.me')) return { data: {} };
    if (tokenBroken) return tokenError;
    if (req.path === '/me') return { data: { user_id: OWN_ID, id: 'app-scoped-1', username: 'mybrand' } };
    if (req.path === '/me/messages') return { data: { recipient_id: FAN_ID, message_id: 'm1' } };
    if (req.path.endsWith('/replies')) return { data: { id: 'reply-1' } };
    if (req.url.includes('refresh_access_token')) return { data: { access_token: 'test-token', token_type: 'bearer', expires_in: 5184000 } };
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
  id = 'c1', text = '我要連結', mediaId = 'media-other', from = { id: FAN_ID, username: 'fan' },
} = {}) => ({
  object: 'instagram',
  entry: [{
    id: OWN_ID,
    time: 1,
    changes: [{
      field: 'comments',
      value: {
        id, text, from, media: { id: mediaId, media_product_type: 'REELS' },
      },
    }],
  }],
});

const tapEvent = (payload, mid = 'tap-1') => ({
  object: 'instagram',
  entry: [{
    id: OWN_ID,
    time: 1,
    messaging: [{
      sender: { id: FAN_ID }, recipient: { id: OWN_ID }, timestamp: 1, postback: { mid, title: '給我', payload },
    }],
  }],
});

const post = (body, { sign = true, secret = 'test-app-secret' } = {}) => {
  const raw = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  if (sign) headers['X-Hub-Signature-256'] = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return fetch(`${base}/instagram/webhook`, { method: 'POST', headers, body: raw });
};

const sent = () => mock.requests.filter((r) => r.method === 'POST' && !r.url.startsWith('https://api.line.me'));
const linePushes = () => mock.requests.filter((r) => r.url.startsWith('https://api.line.me'));

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
  expect(dm.authorization).toBe('Bearer test-token');
  expect(dm.data.recipient).toEqual({ comment_id: 'c-reel' });
  expect(dm.data.message.attachment.payload).toEqual({
    template_type: 'button',
    text: '按下面拿課程連結',
    buttons: [{ type: 'postback', title: '給我連結', payload: 'IGAR:reel1' }],
  });
  expect(reply.path).toBe('/c-reel/replies');
  expect(reply.data).toEqual({ message: '私訊你囉' });
});

test('keywords ignore case, spaces and full-width letters', async () => {
  await post(commentEvent({ id: 'c-wide', text: 'ｌｉｎｋ please' }));
  expect(sent()).toHaveLength(1);
  expect(sent()[0].data.message.attachment.payload.buttons[0].payload).toBe('IGAR:all');
});

test('the sample rule from rules.js never fires until its link is replaced', async () => {
  const { rules, settings } = await import('../instagram/rules.js');
  autoreply.setRules({ settings, rules });
  await post(commentEvent({ id: 'c-sample', text: '請給我連結' }));
  expect(sent()).toEqual([]);
  expect(autoreply.checkRules({ rules }).join('\n')).toContain('範例網址');
});

test('a rule limited to one Reel does not fire on other posts', async () => {
  await post(commentEvent({ id: 'c-other', text: '課程', mediaId: 'media-other' }));
  expect(sent()).toEqual([]);
});

test('comments without a keyword, from the account itself, or resent by Meta are ignored', async () => {
  await post(commentEvent({ id: 'c-none', text: '好可愛' }));
  await post(commentEvent({ id: 'c-own', text: '連結在私訊', from: { id: OWN_ID, username: 'mybrand' } }));
  await post(commentEvent({ id: 'c-own2', text: '連結在私訊', from: { id: '555', username: 'MyBrand' } }));
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
  await post(tapEvent('IGAR:reel1'));
  const [message] = sent();
  expect(message.data.recipient).toEqual({ id: FAN_ID });
  expect(message.data.message.attachment.payload.text).toBe('先追蹤再按一次');
  expect(message.data.message.attachment.payload.buttons[0].payload).toBe('IGAR:reel1');
});

test('tapping again after following sends the link', async () => {
  await post(tapEvent('IGAR:reel1', 'tap-2'));
  const [message] = sent();
  expect(message.data.message.attachment.payload).toEqual({
    template_type: 'button',
    text: '課程連結在這',
    buttons: [{ type: 'web_url', url: 'https://shop.test/course', title: '打開' }],
  });
});

test('a rule without the follow requirement skips the check, and an unknown follow status still gets the link', async () => {
  await post(tapEvent('IGAR:all', 'tap-3'));
  expect(mock.requests.some((r) => r.path === `/${FAN_ID}`)).toBe(false);
  expect(sent()[0].data.message.attachment.payload.buttons[0].url).toBe('https://shop.test/all');
  mock.requests = [];
  failProfile = true;
  await post(tapEvent('IGAR:reel1', 'tap-4'));
  expect(sent()[0].data.message.attachment.payload.buttons[0].url).toBe('https://shop.test/course');
});

test('a button from a removed rule says the event has ended', async () => {
  await post(tapEvent('IGAR:gone', 'tap-5'));
  expect(sent()[0].data.message).toEqual({ text: '這個活動已經結束囉，謝謝你的支持 🙏' });
  mock.requests = [];
  await post(tapEvent('SOMETHING_ELSE', 'tap-6'));
  expect(sent()).toEqual([]);
});

test('an expired token is reported on LINE once, and Meta still gets 200', async () => {
  tokenBroken = true;
  expect((await post(commentEvent({ id: 'c-broken-1' }))).status).toBe(200);
  expect((await post(commentEvent({ id: 'c-broken-2' }))).status).toBe(200);
  const pushes = linePushes();
  expect(pushes).toHaveLength(1);
  expect(pushes[0].data.to).toBe('U-owner');
  expect(pushes[0].data.messages[0].text).toContain('權杖');
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

test('serves the privacy policy and data deletion pages Meta asks for', async () => {
  const privacy = await fetch(`${base}/instagram/privacy`);
  expect(privacy.status).toBe(200);
  expect(await privacy.text()).toContain('隱私權政策');
  const deletion = await fetch(`${base}/instagram/data-deletion`);
  expect(deletion.status).toBe(200);
  expect(await deletion.text()).toContain('資料刪除');
});

test('the status page needs the verify token and shows the webhook URL', async () => {
  expect((await fetch(`${base}/instagram/status`)).status).toBe(403);
  const res = await fetch(`${base}/instagram/status?key=test-doorbell`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('/instagram/webhook');
  expect(html).toContain('@mybrand');
  expect(html).not.toContain('test-token');
  expect(html).not.toContain('test-app-secret');
});

test('the daily cron needs the cron secret, refreshes the token and stays quiet when all is well', async () => {
  expect((await fetch(`${base}/instagram/cron`)).status).toBe(401);
  const res = await fetch(`${base}/instagram/cron`, { headers: { Authorization: 'Bearer test-cron' } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.urgent).toBe(false);
  expect(body.notified).toBe(false);
  expect(body.report).toContain('@mybrand');
  expect(mock.requests.some((r) => r.url.includes('refresh_access_token') && r.params.access_token === 'test-token')).toBe(true);
});

test('the daily cron tells the owner on LINE when the token is broken', async () => {
  tokenBroken = true;
  const res = await fetch(`${base}/instagram/cron`, { headers: { Authorization: 'Bearer test-cron' } });
  const body = await res.json();
  expect(body.urgent).toBe(true);
  expect(body.notified).toBe(true);
  expect(linePushes()[0].data.messages[0].text).toContain('權杖');
});
