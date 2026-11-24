# IG 留言自動送連結（取代 ManyChat，支援多個 IG 帳號）

粉絲在你的 Reels／貼文留言關鍵字，系統就自動：

1. 在留言底下公開回覆一句（例如「已經私訊給你囉 📩」）
2. 私訊對方一則訊息和一個按鈕「給我連結」
3. 對方按下按鈕：
   - 還沒追蹤 → 收到「請先追蹤，再按一次」（同一個按鈕）
   - 已經追蹤 → 收到連結 🎁

- 用的是 Meta 官方的 Instagram API。功能已經內建在這個 LINE 機器人的 Vercel 專案裡，**不用另外開 Cloudflare，也不用付 ManyChat 月費**。
- **可以同時管很多個 IG 帳號**：每個帳號有自己的規則，可以單獨暫停。
- **有網頁後台**（`/instagram/admin`）：連結帳號、改關鍵字和連結都在網頁上完成，按儲存就生效，不用改程式、不用重新部署。知道後台密碼的人都能操作。

> 密碼 ①②③ 和後台密碼不要貼到對話、群組或截圖裡，只貼在 Vercel 的環境變數。

---

## 一次看懂要準備什麼

| 編號 | 是什麼 | 去哪裡拿 | 貼到 Vercel 的哪個變數 |
| --- | --- | --- | --- |
| App 編號 | Instagram 應用程式編號 | Meta 後台「使用 Instagram 登入的 API 設定」 | `INSTAGRAM_APP_ID` |
| ② App 密鑰 | Instagram 應用程式密鑰 | 同上 | `INSTAGRAM_APP_SECRET` |
| ③ 門鈴暗號 | 自己想一串英數字（20 個字以上） | 自己想 | `INSTAGRAM_VERIFY_TOKEN` |
| 後台密碼 | 登入 `/instagram/admin` 用 | 自己想 | `INSTAGRAM_ADMIN_PASSWORD` |
| 排程暗號 | 讓每天的自動檢查能執行 | 自己想 | `CRON_SECRET` |
| ① IG 權杖 | **不用準備**：在後台「用 Instagram 登入」就會自動拿到 | — | （選用）`INSTAGRAM_ACCESS_TOKEN`、`_2`、`_3`… |

另外需要「私人儲存空間」來存帳號和規則：如果 IKIGAI 後台已經能用（有 `IKIGAI_BLOB_READ_WRITE_TOKEN`），**會自動共用，不用做任何事**。想分開存，就另外建一個 Private Blob store，把 token 填到 `INSTAGRAM_BLOB_READ_WRITE_TOKEN`。

---

## 1. 每個 IG 帳號的設定（手機 IG App，每個帳號約 5 分鐘）

**每一個要自動回覆的帳號都要做一次：**

- **1-1 切換成專業帳號**：設定 → 帳號類型和工具 → 切換為專業帳號（創作者或商家都可以）。
- **1-2 開「允許使用訊息功能」**：設定 → 訊息和限時動態回覆 → 訊息控制 → 已連結的工具 → 打開「允許存取訊息」。
- **1-3 帳號要是公開的**：私人帳號不會有留言通知。
- **1-4 關掉同一篇的 ManyChat**：兩邊都開會搶著回覆。

再準備一個**測試小帳**，先**不要**追蹤任何主帳號，用來測「沒追蹤」的情況。

## 2. Meta 設定（developers.facebook.com，約 30 分鐘，只做一次）

- **2-1 註冊開發者**：用 FB 帳號登入 [developers.facebook.com](https://developers.facebook.com/)，驗證手機。
- **2-2 建立 App**：我的應用程式 → 建立應用程式 → 使用案例選「**管理 Instagram 的訊息和內容**」。**一個 App 就能管所有 IG 帳號**，不用每個帳號各建一個。
- **2-3 複製 App 編號和密鑰 ②**：使用案例 → Instagram → 「**使用 Instagram 登入的 API 設定**」，找到「Instagram 應用程式編號」和「Instagram 應用程式密鑰」，兩個都複製。
  ⚠️ 不是「應用程式設定 → 基本資料」裡那組 Facebook 的編號和密鑰。
- **2-4 把每個 IG 帳號加成測試人員**（多帳號的關鍵）：
  1. App 主控台 → 應用程式角色 → 角色 → 新增人員 → 選「**Instagram 測試人員**」→ 輸入 IG 帳號名稱。每個帳號都加一次。
  2. 用**電腦瀏覽器**登入 instagram.com（手機 App 看不到邀請）→ 設定 → 網站權限 → 應用程式和網站 → **測試人員邀請** → 接受。每個帳號都要接受。
- **2-5 設定登入回來的網址**：「使用 Instagram 登入的 API 設定」→「設定 Instagram 商家登入」→ OAuth 重新導向 URI 填：
  `https://你的網域/instagram/oauth/callback`

## 3. Vercel 設定（約 10 分鐘）

- **3-1 上線新版本**：把這次的更新合併到 `main`，Vercel 會自動部署。
- **3-2 貼密碼**：Vercel → 專案 → Settings → Environment Variables，新增：

  | 變數 | 值 |
  | --- | --- |
  | `INSTAGRAM_APP_ID` | 2-3 的 App 編號 |
  | `INSTAGRAM_APP_SECRET` | ② |
  | `INSTAGRAM_VERIFY_TOKEN` | ③ |
  | `INSTAGRAM_ADMIN_PASSWORD` | 後台密碼（沒設的話沿用 `IKIGAI_ADMIN_PASSWORD`） |
  | `CRON_SECRET` | 自己想的一串英數字 |
  | `INSTAGRAM_BRAND_NAME`（選用） | 品牌名稱，會顯示在隱私政策頁 |
  | `INSTAGRAM_CONTACT_EMAIL`（選用） | 聯絡信箱，會顯示在隱私政策頁 |

- **3-3 重新部署**：Deployments → 最新一筆 → Redeploy（環境變數改完都要重新部署才會生效）。

## 4. 在後台連結帳號、設定規則（約 10 分鐘）

打開 `https://你的網域/instagram/admin`，輸入後台密碼。

- **4-1 連結帳號**：按「**＋ 用 Instagram 登入新增帳號**」→ 用第一個 IG 帳號登入、全部允許 → 自動回到後台，會看到 `@帳號 正常`。
  **要連第二、第三個帳號，再按一次，這次換成另一個 IG 帳號登入。**（登入頁會要求重新輸入帳密，不會直接沿用上一個帳號。）
  連結時系統會**自動幫這個帳號訂閱通知**，不用到 Meta 一個一個開。
- **4-2 設定規則**：在「規則」區按「＋ 新增規則」，填：
  - **用在哪個帳號**：選某個帳號，或「所有帳號」
  - **關鍵字**：一行一個
  - **只在這幾篇觸發**：貼 Reels 網址；空白 = 所有貼文
  - **公開回覆**：一行一句，會隨機挑一句（避免每則一樣被 IG 當洗版）
  - **私訊、按鈕、要不要先追蹤、連結網址**
  - 按最下面的「**儲存規則和開關**」，馬上生效。
- 後台最下面「**Meta 後台要填的網址**」有複製按鈕，第 5 步會用到。

> 也可以不用登入：在 Meta 後台「產生存取權杖」，複製權杖後貼到後台的「或貼上權杖新增」。也可以放進 Vercel 的 `INSTAGRAM_ACCESS_TOKEN`、`INSTAGRAM_ACCESS_TOKEN_2`、`INSTAGRAM_ACCESS_TOKEN_3`…（一個帳號一個變數）。

## 5. Meta 設定：裝門鈴、上線（約 15 分鐘，只做一次）

- **5-1 設定 Webhook**：「使用 Instagram 登入的 API 設定」→ 設定 Webhooks：
  - 回呼網址：`https://你的網域/instagram/webhook`
  - 驗證權杖：③
  - 按「驗證並儲存」。失敗的話，通常是 ③ 和 Vercel 裡的不一樣，或改完還沒重新部署。
- **5-2 訂閱三個通知**：`comments`、`messages`、`messaging_postbacks` 都打開。
  （每個帳號的訂閱，在 4-1 連結時已經自動處理了。後台若出現「缺通知」標籤，按該帳號的「重新訂閱通知」即可。）
- **5-3 填基本資料**：應用程式設定 → 基本資料：
  - 隱私政策網址：`https://你的網域/instagram/privacy`
  - 使用者資料刪除：選「資料刪除說明網址」，填 `https://你的網域/instagram/data-deletion`
  - 類別、應用程式圖示也填一下。
- **5-4 App 切成「上線」**：頁面上方的「應用程式模式」從開發中切到上線。**沒切的話，只有你自己留言會觸發，一般粉絲不會。**

## 6. 測試與開放（用小帳實測，約 30 分鐘）

1. 後台「開關與測試」→ 測試名單填小帳名稱 → 儲存。
2. **小帳到每個主帳號的 Reels 留言關鍵字** → 收到私訊和按鈕，留言底下有公開回覆。
   私訊沒看到的話，到小帳的「訊息請求」找找。
3. **沒追蹤，先按按鈕** → 收到「請先追蹤」。
4. **追蹤後再按一次** → 收到連結 🎁。
5. **對所有粉絲開放**：清空測試名單 → 儲存。

🎉 完成。

---

## 日常操作（都在後台）

| 想做的事 | 怎麼做 |
| --- | --- |
| 新增一個 IG 帳號 | 先做第 1 步和 2-4（加成測試人員並接受邀請），再到後台按「用 Instagram 登入新增帳號」 |
| 暫停某一個帳號 | 在那個帳號按「暫停這個帳號」；其他帳號照常運作 |
| 全部停掉 | 「開關與測試」取消勾選總開關 → 儲存 |
| 換活動、換連結 | 改規則 → 儲存，馬上生效 |
| 某帳號出現「權杖失效」 | 重新按「用 Instagram 登入新增帳號」，用那個帳號登入一次就好 |
| 某帳號出現「缺通知」 | 按「重新訂閱通知」 |
| 不再用某個帳號 | 按「移除」（在 Vercel 設定的帳號，要到 Vercel 刪掉那個變數） |
| 讓同事一起管理 | 把後台網址和密碼給同事。要換密碼就改 Vercel 的 `INSTAGRAM_ADMIN_PASSWORD` 再重新部署 |

> 後台修改後，有時其他伺服器要最多 5 分鐘才會讀到新規則，這是正常的。

## 選用：出問題傳 LINE 給你、每晚報告

這個專案本來就是 LINE 機器人，通知直接走它：

1. 在 LINE 傳「我的ID」給機器人，拿到 `U` 開頭的 ID。
2. Vercel 加上 `INSTAGRAM_NOTIFY_LINE_IDS` = 那個 ID（多人用逗號隔開，例如老闆和小編）。
3. 想每天晚上 9 點左右都收到報告，再加 `INSTAGRAM_DAILY_REPORT` = `true`。沒加的話，只有出問題時才會通知，例如某個帳號的權杖過期、通知沒訂閱、規則寫錯。

報告長這樣：

```
IG 自動回覆每日報告（2 個帳號）
✅ @brand_a：正常，權杖還有 53 天
❌ @brand_b：權杖失效了，這個帳號停止自動回覆。請到後台重新用 Instagram 登入…
```

## 權杖自動延長

IG 權杖 60 天會過期。系統每天晚上 9 點左右檢查一次，每 7 天自動延長**每一個帳號**的權杖，並把新權杖存在私人儲存空間。正常情況下你**什麼都不用做**。

---

## 多帳號的限制（Meta 的規定）

- **自己的帳號**：加成「Instagram 測試人員」就能用，**不用送審**（Standard Access）。帳號數量沒有硬性上限，但每個都要加測試人員、接受邀請。
- **別人的帳號**（例如幫客戶代管）：需要向 Meta 申請「進階存取」（App Review），通常也要完成商家驗證。申請前，App 只能服務有角色的帳號。
- 每個帳號的 API 用量是**分開計算**的，一個帳號很熱門不會拖累其他帳號。

## Instagram 本身的限制（不是程式的問題）

- 每一則留言只能私訊**一次**，而且要在留言後 **7 天內**。
- 對方按了按鈕之後，**24 小時內**才能繼續私訊他。
- 讀不到對方有沒有追蹤時（例如 IG 暫時不給資料），系統會直接給連結，不會卡住粉絲。
- 這是 Meta 官方 API，不是模擬手機操作的外掛，被封號的風險比外掛低很多。但還是要避免洗版：公開回覆多寫幾句讓它輪流用，連結也不要放可疑網址。

## 出問題時

先打開 `https://你的網域/instagram/admin`，上方「要處理的事」和每個帳號的標籤通常會直接告訴你原因。

| 狀況 | 先檢查 |
| --- | --- |
| 「用 Instagram 登入」後出現錯誤 | 2-5 的重新導向網址有沒有完全一樣（https、結尾沒有 /）？這個 IG 帳號有沒有加成測試人員並接受邀請？ |
| 某帳號留言完全沒反應 | 後台這個帳號是不是「正常」、沒有暫停、沒有「缺通知」？App 切「上線」了嗎？帳號是公開的嗎？測試名單有沒有清空？規則是不是指定了別的帳號？ |
| 只有自己留言會動，別人不會 | App 還在「開發中」，請切成上線 |
| 有公開回覆，但收不到私訊 | 看「訊息請求」；確認 1-2「允許存取訊息」有開 |
| 驗證 Webhook 失敗 | ③ 和 Vercel 的 `INSTAGRAM_VERIFY_TOKEN` 一模一樣嗎？改完有重新部署嗎？ |
| 後台存不了 | 上方會說「還沒設定私人儲存空間」：設定 `INSTAGRAM_BLOB_READ_WRITE_TOKEN`（或 IKIGAI 的）後重新部署 |

還是不行就跟 Claude 說「幫我看 IG 自動回覆最近有沒有出錯」，並附上 Vercel → Logs 裡 `[instagram]` 開頭的訊息（不要附密碼）。

## 費用

- Meta 的 Instagram API：免費，帳號多也不用加錢。
- Vercel：用你現在的方案。免費的 Hobby 方案限非商業用途，商業帳號流量大時請考慮 Pro。

## 技術細節（給工程師）

| 路徑 | 用途 |
| --- | --- |
| `GET /instagram/webhook` | Meta 驗證（`hub.verify_token` = `INSTAGRAM_VERIFY_TOKEN`） |
| `POST /instagram/webhook` | 接收 `comments`、`messaging_postbacks`；`X-Hub-Signature-256`（Instagram app secret）驗簽；依 `entry.id` 找帳號、用該帳號的權杖回覆 |
| `GET /instagram/admin` | 後台（`x-admin-password` = `INSTAGRAM_ADMIN_PASSWORD`），API 在 `/instagram/admin/api/*` |
| `GET /instagram/oauth/callback` | Business Login 回呼：code → 短期權杖 → `ig_exchange_token` 長期權杖 → `POST /me/subscribed_apps` |
| `GET /instagram/privacy`、`/instagram/data-deletion` | App 上線需要的兩個網址 |
| `GET /instagram/status?key=` | 唯讀檢查頁（key = `INSTAGRAM_VERIFY_TOKEN`） |
| `GET /instagram/cron` | Vercel Cron（`vercel.json`，每天 13:00 UTC）：檢查每個帳號的權杖與訂閱，每 7 天 `ig_refresh_token`，LINE 通知 |

- 帳號來源：Vercel 的 `INSTAGRAM_ACCESS_TOKEN[_N]`，加上後台連結的帳號（私人 Blob `instagram/accounts.json`）。規則存在 `instagram/rules.json`，後台沒存過時用 `instagram/rules.js`。
- API：Instagram API with Instagram Login（`graph.instagram.com`，版本 `INSTAGRAM_API_VERSION`，預設 `v25.0`）。
- 私訊：`POST /me/messages`，`recipient.comment_id`（private reply）＋ button template（postback）；追蹤檢查：`GET /{IGSID}?fields=is_user_follow_business`。
- 程式：`instagram/`（`autoreply.js` 流程、`accounts.js` 帳號與權杖、`rules-store.js` 規則、`notify.js` LINE、`index.js` 路由）、`services/instagram.js`、`web/instagram-admin.html`。測試：`tests/instagram.test.js`。
