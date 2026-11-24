# IG 留言自動送連結（取代 ManyChat）

粉絲在你的 Reels／貼文留言關鍵字，系統就自動：

1. 在留言底下公開回覆一句（例如「已經私訊給你囉 📩」）
2. 私訊對方一則訊息和一個按鈕「給我連結」
3. 對方按下按鈕：
   - 還沒追蹤 → 收到「請先追蹤，再按一次」（同一個按鈕）
   - 已經追蹤 → 收到連結 🎁

用的是 Meta 官方的 Instagram API，功能已經內建在這個 LINE 機器人的 Vercel 專案裡，**不用另外開 Cloudflare、不用付 ManyChat 月費**。
（原本的教學是用 Cloudflare 架，這裡改成直接放在你已經有的 Vercel 上，少掉整個「雲端設定」那一段。）

> 密碼 ①②③ 不要貼到對話、群組或截圖裡。只貼在 Vercel 的環境變數。

---

## 要準備的密碼（對照流程圖的編號）

| 編號 | 是什麼 | 去哪裡拿 | 貼到 Vercel 的哪個變數 |
| --- | --- | --- | --- |
| ① IG 權杖 | 讓程式能代替你的 IG 回覆 | Meta 後台「產生存取權杖」 | `INSTAGRAM_ACCESS_TOKEN` |
| ② App 密鑰 | 確認通知真的是 Meta 送來的 | Meta 後台「Instagram 應用程式密鑰」 | `INSTAGRAM_APP_SECRET` |
| ③ 門鈴暗號 | 自己隨便想一串英數字（20 個字以上） | 自己想 | `INSTAGRAM_VERIFY_TOKEN` |
| ⑤ 程式網址 | Meta 要把通知送去哪裡 | `https://你的網域/instagram/webhook` | 不用貼，填在 Meta |
| ~~④⑥⑦~~ | Cloudflare 才需要 | 不用 | — |

再加一個 `CRON_SECRET`（也是自己想的一串英數字），讓每天的自動檢查能執行。

---

## 1. IG 帳號設定（手機 IG App，約 10 分鐘）

- **1-1 切換成專業帳號**：設定 → 帳號類型和工具 → 切換為專業帳號（創作者或商家都可以）。
- **1-2 開「允許使用訊息功能」**：設定 → 訊息和限時動態回覆 → 訊息控制 → 已連結的工具 → 打開「允許存取訊息」。陌生訊息選「所有人」。
- **1-3 準備一個測試小帳**：先**不要**追蹤主帳號，等一下用來測「沒追蹤」的情況。
- **1-4 關掉同一篇的 ManyChat**：同一篇貼文兩邊都開，會搶著回覆。
- 帳號要是**公開**的，Meta 才會送留言通知。

## 2. Meta 設定：拿鑰匙（developers.facebook.com，約 30 分鐘）

- **2-1 註冊開發者**：用 FB 帳號登入 [developers.facebook.com](https://developers.facebook.com/)，驗證手機。
- **2-2 建立 App**：我的應用程式 → 建立應用程式 → 使用案例選「**管理 Instagram 的訊息和內容**」。
- **2-3 複製 IG 密鑰 ②**：App 主控台 → 使用案例 → Instagram → 「**使用 Instagram 登入的 API 設定**」→ 找到「Instagram 應用程式密鑰」→ 顯示 → 複製。
  ⚠️ 不是「應用程式設定 → 基本資料」裡那個 Facebook 的應用程式密鑰。
- **2-4 產生 IG 權杖 ①**：同一頁的「產生存取權杖」→ 新增帳號 → 用你的 **IG 主帳號**登入並全部允許 → 複製權杖。
- **2-5 門鈴暗號 ③**：自己想一串，例如 `kuan-ig-2026-dingdong-7f3k`。先記在備忘錄。

## 3. Vercel 設定（取代原本的 Cloudflare，約 10 分鐘）

- **3-1 上線新版本**：把這次的更新合併到 `main`，Vercel 會自動部署。
- **3-2 貼密碼**：Vercel → 專案 → Settings → Environment Variables，新增：

  | 變數 | 值 |
  | --- | --- |
  | `INSTAGRAM_ACCESS_TOKEN` | ① |
  | `INSTAGRAM_APP_SECRET` | ② |
  | `INSTAGRAM_VERIFY_TOKEN` | ③ |
  | `CRON_SECRET` | 自己想的一串英數字 |
  | `INSTAGRAM_BRAND_NAME`（選用） | 品牌名稱，會顯示在隱私政策頁 |
  | `INSTAGRAM_CONTACT_EMAIL`（選用） | 聯絡信箱，會顯示在隱私政策頁 |

- **3-3 填你的 Reels 資料**：改 [`instagram/rules.js`](../instagram/rules.js)。不想自己改，就跟 Claude 說：
  > 幫我把 IG 自動回覆改成：在 https://www.instagram.com/reel/XXXX/ 留言「優惠」的人，私訊送 https://我的連結，要先追蹤才給。
- **3-4 重新部署**：Deployments → 最新一筆 → Redeploy（環境變數改完都要重新部署才會生效）。
- **3-5 檢查**：用瀏覽器打開
  `https://你的網域/instagram/status?key=③`
  每一項都是 ✓ 就可以往下走。這一頁也會列出等一下要填到 Meta 的三個網址。

## 4. Meta 設定：裝門鈴、上線（回到同一個 App，約 15 分鐘）

- **4-1 設定 Webhook**：「使用 Instagram 登入的 API 設定」→ 設定 Webhooks：
  - 回呼網址：`https://你的網域/instagram/webhook`（⑤）
  - 驗證權杖：③
  - 按「驗證並儲存」。失敗的話，通常是 ③ 和 Vercel 裡的不一樣，或還沒重新部署。
- **4-2 訂閱三個通知**：`comments`、`messages`、`messaging_postbacks` 都打開。
  帳號頭像那一列的「Webhook 訂閱」開關也要打開。
- **4-3 填基本資料**：應用程式設定 → 基本資料：
  - 隱私政策網址：`https://你的網域/instagram/privacy`
  - 使用者資料刪除：選「資料刪除說明網址」，填 `https://你的網域/instagram/data-deletion`
  - 類別、應用程式圖示也填一下。
- **4-4 App 切成「上線」**：頁面上方的「應用程式模式」從開發中切到上線。**沒切的話，只有你自己留言會觸發，一般粉絲不會。**

## 5. 測試與開放（用小帳實測，約 30 分鐘）

1. 先把測試小帳放進測試名單（`instagram/rules.js` 的 `testUsernames: ['小帳名稱']`），部署。
2. **小帳留言關鍵字** → 收到私訊和按鈕，留言底下有公開回覆。
   私訊沒看到的話，到小帳的「訊息請求」找找。
3. **沒追蹤，先按按鈕** → 收到「請先追蹤」。
4. **追蹤後再按一次** → 收到連結 🎁。
5. **對所有粉絲開放**：把 `testUsernames` 改回 `[]`，部署。跟 Claude 說「IG 自動回覆開放給所有人」就好。

🎉 完成。

---

## 選用：出問題傳 LINE 給你、每晚報告

這個專案本來就是 LINE 機器人，所以通知直接走它：

1. 在 LINE 傳「我的ID」給機器人，拿到 `U` 開頭的 ID。
2. Vercel 加上 `INSTAGRAM_NOTIFY_LINE_IDS` = 那個 ID（多個用逗號隔開）。
3. 想要每天晚上 9 點左右都收到報告，再加 `INSTAGRAM_DAILY_REPORT` = `true`。沒加的話，只有出問題時才會通知（權杖過期、沒權限、規則寫錯）。

## 選用：權杖自動延長

IG 權杖 60 天會過期。系統每天晚上 9 點左右自動檢查，每 7 天延長一次。

- 已經有 IKIGAI 的私人 Blob（`IKIGAI_BLOB_READ_WRITE_TOKEN`）的話，會自動用它保存新權杖，**什麼都不用做**。
- 想分開放，就另外建一個 Private Blob store，把它的 token 填到 `INSTAGRAM_BLOB_READ_WRITE_TOKEN`。
- 兩個都沒有：每 50 天左右要回到 2-4 重新產生權杖，貼到 Vercel，再重新部署。

---

## 規則怎麼寫（`instagram/rules.js`）

```js
export const settings = {
  enabled: true,        // 總開關
  testUsernames: [],    // 測試名單；空的 = 所有人
};

export const rules = [
  {
    id: 'course',                         // 代號，英數字，不要重複
    keywords: ['課程', '+1'],             // 留言「包含」就觸發
    posts: ['https://www.instagram.com/reel/XXXX/'],  // 只在這幾篇觸發；[] = 全部
    commentReplies: ['私訊你囉 📩', '快去收件匣看看 💌'],  // 隨機挑一句公開回覆；[] = 不公開回
    dmText: '謝謝留言！按下面的按鈕拿連結 👇',
    buttonTitle: '給我連結',              // 最多 20 字
    requireFollow: true,                  // 要先追蹤才給
    notFollowingText: '先追蹤我們，再按一次按鈕喔！',
    linkText: '這是你的連結 🎁',
    linkTitle: '打開連結',                // 最多 20 字
    link: 'https://你的連結',
  },
];
```

- 規則**由上往下**比對，第一個符合的就用它。只限某篇的規則放上面，「全部貼文」的放下面。
- 寫錯（例如 link 還是範例網址、按鈕字太長）的話，狀態頁和每日報告都會提醒你。link 還是 `example.com` 的規則不會觸發，所以先填密碼、後改規則也不會送錯連結給粉絲。

## Instagram 的限制（不是程式的問題）

- 每一則留言只能私訊**一次**，而且要在留言後 **7 天內**。
- 對方按了按鈕之後，**24 小時內**才能繼續私訊他。
- 讀不到對方有沒有追蹤時（例如 IG 暫時不給資料），系統會直接給連結，不會卡住粉絲。
- 這是 Meta 官方 API，不是模擬手機操作的外掛，被封號的風險比外掛低很多。但還是要避免洗版：公開回覆多寫幾句讓它輪流用，連結也不要放可疑網址。

## 出問題時

| 狀況 | 先檢查 |
| --- | --- |
| 留言完全沒反應 | 狀態頁全部 ✓ 嗎？App 切「上線」了嗎？帳號是公開的嗎？4-2 的帳號開關有開嗎？測試名單裡有沒有這個帳號？同一篇 ManyChat 關了嗎？ |
| 只有自己留言會動，別人不會 | App 還在「開發中」。切成上線。若已上線還是不行，到 App 主控台的「應用程式審查」申請 `instagram_business_manage_comments`、`instagram_business_manage_messages` 的進階存取 |
| 有公開回覆，但收不到私訊 | 看「訊息請求」；確認 1-2「允許存取訊息」有開 |
| 驗證 Webhook 失敗 | ③ 和 Vercel 的 `INSTAGRAM_VERIFY_TOKEN` 一模一樣嗎？改完有重新部署嗎？ |
| 突然全部停了 | 多半是權杖過期，回到 2-4 重新產生 ①，貼到 Vercel、重新部署 |

還是不行就跟 Claude 說「幫我看 IG 自動回覆最近有沒有出錯」，並附上 Vercel → Logs 裡 `[instagram]` 開頭的訊息（不要附密碼）。

## 費用

- Meta 的 Instagram API：免費。
- Vercel：用你現在的方案。免費的 Hobby 方案限非商業用途，商業帳號流量大時請考慮 Pro。

## 技術細節（給工程師）

| 路徑 | 用途 |
| --- | --- |
| `GET /instagram/webhook` | Meta 驗證（`hub.verify_token` = `INSTAGRAM_VERIFY_TOKEN`） |
| `POST /instagram/webhook` | 接收 `comments`、`messaging_postbacks`；用 `X-Hub-Signature-256`（Instagram app secret）驗簽 |
| `GET /instagram/privacy`、`/instagram/data-deletion` | App 上線需要的兩個網址 |
| `GET /instagram/status?key=` | 設定檢查頁 |
| `GET /instagram/cron` | Vercel Cron（`vercel.json`，每天 13:00 UTC）：檢查權杖、每 7 天 `ig_refresh_token`、LINE 通知 |

- API：Instagram API with Instagram Login（`graph.instagram.com`，版本 `INSTAGRAM_API_VERSION`，預設 `v25.0`）。
- 私訊：`POST /me/messages`，`recipient.comment_id`（private reply）＋ button template（postback）。
- 追蹤檢查：`GET /{IGSID}?fields=is_user_follow_business`。
- 程式：`instagram/`（`autoreply.js` 流程、`token.js` 權杖、`notify.js` LINE、`rules.js` 設定）、`services/instagram.js`。測試：`tests/instagram.test.js`。
