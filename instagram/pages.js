import config from '../config/index.js';

const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const layout = (title, body) => `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #faf9f7; --fg: #1f1f1f; --muted: #666; --card: #fff; --line: #e6e3de; --ok: #1a7f37; --bad: #c62828; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #ececec; --muted: #a0a0a0; --card: #202020; --line: #333; --ok: #4ac26b; --bad: #ff6b6b; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Noto Sans TC", "PingFang TC", sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  h2 { font-size: 1.1rem; margin: 28px 0 8px; }
  p, li { color: var(--fg); }
  .muted { color: var(--muted); font-size: .9rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 4px 16px; margin: 16px 0; }
  .row { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .mark { flex: none; width: 1.5em; font-weight: 700; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }
  code { font-size: .9em; word-break: break-all; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;

const brand = () => escape(config.INSTAGRAM_BRAND_NAME || '本帳號');
const contact = () => (config.INSTAGRAM_CONTACT_EMAIL
  ? `寄信到 <a href="mailto:${escape(config.INSTAGRAM_CONTACT_EMAIL)}">${escape(config.INSTAGRAM_CONTACT_EMAIL)}</a>，或直接在 Instagram 私訊我們`
  : '直接在 Instagram 私訊我們');

const privacyPage = () => layout('隱私權政策', `
<h1>隱私權政策</h1>
<p class="muted">Privacy Policy · ${brand()} 的 Instagram 自動回覆</p>
<p>${brand()} 使用 Instagram 官方 API，在你於我們的貼文或 Reels 留言特定關鍵字時，自動回覆你的留言並以私訊傳送你要的連結。</p>
<h2>我們會用到的資料</h2>
<ul>
  <li>你的留言內容與留言編號：用來判斷是否符合關鍵字，並回覆那則留言。</li>
  <li>你的 Instagram 帳號名稱與帳號編號：用來私訊你。</li>
  <li>你是否追蹤我們的帳號：部分活動需要先追蹤才能拿到連結。</li>
</ul>
<h2>我們不會做的事</h2>
<ul>
  <li>不會把這些資料存進資料庫；處理完就丟棄（為了避免重複回覆，最多暫存一小時在記憶體中）。</li>
  <li>不會出售、出租或分享你的資料給任何第三方。</li>
  <li>不會用來投放廣告或做其他用途。</li>
</ul>
<h2>聯絡我們</h2>
<p>對隱私權有任何問題，或想要我們刪除與你有關的資料，請${contact()}。</p>
<p class="muted">This service uses the Instagram API to reply to comments and send the requested link by direct message. Comment text, Instagram username and ID, and whether you follow the account are used only to send that reply. Nothing is stored beyond one hour in memory, and nothing is sold or shared.</p>
`);

const dataDeletionPage = () => layout('資料刪除說明', `
<h1>資料刪除說明</h1>
<p class="muted">Data Deletion Instructions · ${brand()} 的 Instagram 自動回覆</p>
<p>這個自動回覆服務不會長期保存你的個人資料：留言內容、帳號名稱和是否追蹤，只在回覆的當下使用，最多一小時後就會從記憶體清除。</p>
<h2>想要刪除資料？</h2>
<ol>
  <li>請${contact()}，告訴我們你的 Instagram 帳號名稱。</li>
  <li>我們會在 30 天內確認並刪除任何與你有關的紀錄，並回覆你處理結果。</li>
  <li>你也可以隨時到 Instagram「設定 → 網站權限 → 應用程式和網站」移除授權，或直接刪除你的留言與對話。</li>
</ol>
<p class="muted">To request deletion of your data, contact us with your Instagram username. We do not keep personal data beyond one hour, and we will confirm deletion within 30 days.</p>
`);

const markOf = ({ ok, optional }) => {
  if (ok) return { cls: 'ok', sign: '✓' };
  return optional ? { cls: 'muted', sign: '–' } : { cls: 'bad', sign: '✗' };
};

const statusPage = (title, rows, notes = []) => layout(title, `
<h1>${escape(title)}</h1>
<p class="muted">每次打開都會重新檢查。這一頁不會顯示任何密碼。</p>
<div class="card">
${rows.map((row) => ({ ...row, mark: markOf(row) })).map(({ mark, label, detail }) => `<div class="row"><span class="mark ${mark.cls}">${mark.sign}</span><div><div>${escape(label)}</div>${detail ? `<div class="muted">${escape(detail)}</div>` : ''}</div></div>`).join('\n')}
</div>
${notes.length ? `<h2>要處理的事</h2><ul>${notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>` : '<p class="ok">都沒問題，自動回覆正在運作。</p>'}
`);

export {
  privacyPage,
  dataDeletionPage,
  statusPage,
};
