/* 易家做媽媽 — 隱私權政策與使用條款 (個資法第 8 條的告知事項), and the tick-to-agree box used everywhere data leaves
 * the phone: 註冊會員, 島上的媽媽, 同週好孕圈, 祝福牆 (opening one, and a friend's blessing).
 * The text describes what this app actually does; the brand fills in its company name, contact and server region in
 * config.js (BRAND.privacy) before launch, and has it checked by a lawyer.
 *   screen 'privacy'   App.privacy.VERSION   App.privacy.open()   App.privacy.box({label, required})   App.privacy.link(text) */
(function () {
  const App = window.App;
  const { h, ui } = App;
  // the date the policy last changed; must match POLICY_VERSION in mom-api/policy.js
  const VERSION = '2026-11-20';
  const LAW = 'https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=I0050021';
  const B = () => window.BRAND || {};
  const P = () => B().privacy || {};
  const who = () => P().company || B().brandName || '本 App 營運者';
  const contact = () => P().contact || '';

  const sec = (title, ...kids) => h('section', { class: 'pv-sec' }, h('h3', null, title), ...kids);
  const ul = (...items) => h('ul', null, items.filter(Boolean).map((t) => h('li', null, t)));
  const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener', class: 'pv-ext' }, text);

  function body({ compact = false } = {}) {
    const app = B().appName || '易家做媽媽';
    const askUs = contact() ? `請聯絡 ${contact()}` : '請透過「我的 → 品牌頁」的聯絡方式與我們聯繫';
    return h('div', { class: `pv${compact ? ' compact' : ''}` },
      h('p', { class: 'pv-lead' }, `${who()}（以下稱「我們」）提供「${app}」。我們很重視你和寶寶的隱私：懷孕、寶寶、健康紀錄和照片都只存在你的手機，不會上傳。只有你註冊會員或使用社群功能時，才會依下面的說明蒐集最少的資料。`),
      h('p', { class: 'pv-ver' }, `版本：${VERSION}・依個人資料保護法第 8 條告知`),

      sec('一、蒐集的目的',
        ul('會員帳號的建立、登入與管理（消費者、客戶管理與服務）',
          '計算邀請人數、發放雙向邀請禮與好孕點數',
          '你選擇使用時的社群功能：島上的媽媽、同週好孕圈、祝福牆',
          '團購揪團：開團、跟團，成團後提供折扣碼（在品牌官網結帳，App 不收款、不收地址）',
          '服務安全：防止盜用帳號、灌票或灌人數',
          '寄送優惠與活動訊息：只有你另外勾選同意時（可隨時取消）')),

      sec('二、蒐集的資料、存在哪裡、保存多久',
        h('div', { class: 'pv-table', role: 'table', 'aria-label': '蒐集的資料' },
          [['註冊／登入', 'Email 或手機號碼、密碼（只存加密雜湊，我們也看不到密碼）、暱稱、邀請碼、邀請你的人（你加入時用的邀請碼）與見面禮的領取時間、註冊與最近登入時間、你同意本政策的版本與時間、是否接收行銷訊息', '保存到你刪除帳號為止'],
            ['用 LINE 登入', 'LINE 的使用者代碼（不是你的 LINE ID）、LINE 顯示名稱（當作暱稱）', '保存到你刪除帳號為止'],
            ['線上人數', '打開 App 時，每分鐘送出一個隨機產生的連線代號（不含任何個人資料），用來算出「現在幾位在線上」', '2 分鐘沒更新就不算，約 1 小時後刪除'],
            ['服務安全', '網路位址經「加密金鑰雜湊」後的次數紀錄（無法還原成原本的網路位址），用來擋住猜密碼與灌水', '10 分鐘到 90 天後自動刪除'],
            ['島上的媽媽（你選擇加入時）', '畫的 Q 版角色樣式（不是照片）、你在哪一座島、你取的名稱、收到的揮手與愛心', '2 分鐘沒上線就不顯示；互動保留 7 天'],
            ['同週好孕圈（你選擇加入時）', '預產期是哪一週（不是日期）或寶寶出生的年月、你的匿名回答與心情', '每週的統計保留 3 週'],
            ['團購揪團（你開團或跟團時）', '你在哪個團購的哪一團、開團時填的團名；朋友打開團的連結只看得到團名、人數和剩下的時間', '活動結束後 60 天自動刪除；刪除帳號時立即退出'],
            ['祝福牆（你開牆時）', '寶寶的小名、媽媽名稱；親友留下的名字與祝福', '400 天後自動刪除，你也可以隨時刪除'],
            ['你的紀錄', '懷孕、寶寶、健康、照片、日記', '只在你的手機，不會上傳']]
            .map(([a, b, c]) => h('div', { class: 'pv-row', role: 'row' },
              h('div', { class: 'pv-k', role: 'rowheader' }, a), h('div', { class: 'pv-v', role: 'cell' }, b), h('div', { class: 'pv-t', role: 'cell' }, c)))),
        h('p', { class: 'small' }, '島上的媽媽和同週好孕圈用的是手機上的匿名代號，和你的會員帳號沒有連結；其他媽媽只看得到上面列出的內容，看不到你的帳號、電話或位置。')),

      sec('三、利用的期間、地區、對象與方式',
        ul('期間：如上表；你刪除帳號後，會員資料會立即從資料庫刪除。',
          `地區：${P().region || '我們使用的雲端主機所在地區（上線前會在這裡寫明）'}。`,
          `對象：我們，以及受我們委託、提供主機與資料庫的服務商（${P().processors || '雲端主機與資料庫服務商'}）；使用 LINE 登入時的 LINE。我們不會出售你的資料，除法律要求外也不會提供給其他人。`,
          '方式：以電腦和網路自動化方式處理。')),

      sec('四、你的權利（個資法第 3 條）',
        h('p', null, '你可以隨時：查詢或請求閱覽、請求製給複製本、請求補充或更正、請求停止蒐集處理或利用、請求刪除你的個人資料。'),
        ul('在 App 裡：「我的 → 帳號」可以下載我的會員資料、修改暱稱、關閉行銷訊息、刪除帳號；社群功能在各自的設定裡可以隨時關閉。',
          `其他需求：${askUs}，我們會盡快處理。`)),

      sec('五、不提供資料的影響',
        h('p', null, '不註冊、不登入也能使用 App 的全部紀錄功能。不提供資料，只是無法使用會員登入、邀請計數、邀請禮與社群功能。')),

      sec('六、敏感資料（個資法第 6 條）',
        h('p', null, '懷孕與寶寶的健康紀錄屬於需要特別保護的資料，所以全部只存在你的手機，不會傳到伺服器。社群功能最多只送出「階段」層級的資訊（例如在哪一座島、預產期是哪一週），而且只有在你勾選同意後才會送出。')),

      sec('七、行銷訊息（個資法第 20 條）',
        h('p', null, '只有你勾選「願意收到優惠與活動訊息」時，我們才會用你的聯絡方式寄送。你可以隨時在「我的 → 帳號」免費關閉，關閉後我們會立即停止寄送。')),

      sec('八、安全措施',
        ul('密碼以 scrypt 加鹽雜湊保存；登入憑證有簽章與期限，可以一次登出所有裝置。',
          '網路傳輸使用 HTTPS 加密；有登入嘗試次數限制。',
          '若發生資料外洩，我們會依個資法第 12 條通知你。')),

      sec('九、使用條款',
        ul(`${app}提供一般衛教資訊與紀錄工具，不能取代醫師的診斷與建議；身體不舒服請直接就醫。`,
          '請使用自己的 Email 或手機註冊，妥善保管密碼。',
          '社群互動請互相尊重：不放電話、連結、廣告，不騷擾或冒充他人；違反時我們可能隱藏內容或停止你的使用。被封鎖或檢舉的內容會依規則處理。',
          '祝福牆上只放你願意公開的內容；知道連結的人都看得到牆上已顯示的祝福。')),

      sec('十、政策更新',
        h('p', null, '政策如有重要變更，會更新版本日期，並在你下次打開 App 時請你重新閱讀與同意。')),

      h('p', { class: 'small muted' }, '法規依據：', ext(LAW, '個人資料保護法（全國法規資料庫）')));
  }

  // the full policy in a sheet, without leaving a half-filled form
  function open() {
    ui.sheet({ title: '隱私權政策與使用條款', body: body({ compact: true }), wide: true });
  }
  // a link that opens it (inside a <label> it must not tick the box)
  const link = (text = '隱私權政策與使用條款') => h('button', {
    type: 'button', class: 'link-btn pv-link', onclick: (e) => { e.preventDefault(); e.stopPropagation(); open(); },
  }, `《${text}》`);
  // the tick-to-agree box: an unticked checkbox with the policy link; .checked tells whether she agreed
  function box({ label = null, required = true, checked = false } = {}) {
    const input = h('input', { type: 'checkbox', class: 'pv-cb', checked, 'aria-required': required ? 'true' : null });
    const el = h('label', { class: `pv-box${required ? ' req' : ''}` }, input,
      h('span', null, label || ['我已閱讀並同意', link()], required ? h('span', { class: 'pv-req' }, '（必填）') : h('span', { class: 'pv-opt' }, '（選填）')));
    return {
      el, input, get checked() { return input.checked; },
      // not ticked: say so next to the box and move focus there
      need(msg = '請先勾選同意') {
        if (input.checked) return true;
        el.classList.add('missing');
        let hint = el.nextElementSibling;
        if (!hint || !hint.classList.contains('pv-miss')) { hint = h('p', { class: 'pv-miss', role: 'alert' }); el.after(hint); }
        hint.textContent = msg;
        input.focus();
        input.addEventListener('change', () => { el.classList.remove('missing'); if (hint && hint.isConnected) hint.remove(); }, { once: true });
        return false;
      },
    };
  }

  App.screen('privacy', {
    title: '隱私權政策與使用條款',
    tab: 'me',
    render(el) { el.append(body()); },
  });

  App.privacy = {
    VERSION, open, link, box, body,
  };
}());
