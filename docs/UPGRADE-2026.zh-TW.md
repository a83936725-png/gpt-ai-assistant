# 2026 升級說明：換掉已關閉的 OpenAI 模型

OpenAI 在 2026 年關閉了這個專案原本預設的模型，舊版會出現「聊天沒回應、畫圖失敗」。這次更新把預設值換成目前可用的模型，並修正了套件漏洞。

以下日期都來自 [OpenAI 官方 Deprecations 頁面](https://developers.openai.com/api/docs/deprecations)（2026-11-14 查詢）。

| 功能 | 舊預設 | 狀態 | 新預設 |
| --- | --- | --- | --- |
| 聊天 | `gpt-3.5-turbo` | 2026-10-23 已關閉 | `gpt-6-luna` |
| 畫圖 | `dall-e-2` | 2026-05-12 已關閉（`gpt-image-1` 也在 2026-10-23 關閉） | `gpt-image-2.6-flare` |
| 看圖 | `gpt-4o` | 2027-01-14 關閉 | `gpt-6-luna` |
| 語音轉文字 | `whisper-1` | 2027-02-26 關閉 | `gpt-transcribe` |

## 你要做的事

### 1. 檢查 Vercel 的環境變數

到 Vercel 專案的 **Settings → Environment Variables**，如果有設定下面這些，而且值還是舊模型，**刪掉或改成新模型**，否則會蓋過新的預設值：

- `OPENAI_COMPLETION_MODEL`（例如 `gpt-3.5-turbo`）
- `OPENAI_IMAGE_GENERATION_MODEL`（例如 `dall-e-2`、`dall-e-3`、`gpt-image-1`）
- `OPENAI_VISION_MODEL`（例如 `gpt-4o`）
- `OPENAI_COMPLETION_MAX_TOKENS`（舊預設 64 太短，新預設 500）

舊的 `OPENAI_IMAGE_GENERATION_SIZE=256x256`、`512x512` 和 `OPENAI_IMAGE_GENERATION_QUALITY=standard`、`hd` 會自動換成新模型能用的值，不用改。

### 2. 讓畫圖功能能傳圖片給 LINE

新的畫圖模型只回傳圖片資料、不給網址，但 LINE 一定要 HTTPS 網址。所以要找地方放圖片，二選一：

- **部署在 Vercel（建議）**：在 Vercel 專案的 **Storage** 建立一個 **Blob** store 並連到這個專案，Vercel 會自動加上 `BLOB_READ_WRITE_TOKEN`。圖片會存在 Blob，請留意 Blob 的用量與費用。
- **用 Docker 或自己的主機**：不用額外設定，圖片會暫存在記憶體 1 小時，由 Bot 自己的 `/images/...` 網址提供。如果網址不對，設定 `IMAGE_PUBLIC_URL=https://你的網域`。

沒有 Blob 時在 Vercel 上也會試著用記憶體，但 Vercel 可能用不同的執行個體回應 LINE 的下載，圖片偶爾會失敗，所以 Vercel 請用 Blob。

畫圖比較慢（可能 10–60 秒），所以 `vercel.json` 的 `maxDuration` 從 10 秒調到 60 秒，畫圖請求另有 `OPENAI_IMAGE_GENERATION_TIMEOUT`（預設 55 秒）。

### 3. 新增的設定

| 變數 | 預設 | 用途 |
| --- | --- | --- |
| `OPENAI_COMPLETION_REASONING_EFFORT` | OpenAI 上為 `none` | 思考深度。`none` 最快最便宜；改成 `low`／`medium` 會比較聰明但比較慢，而且不能再設定 temperature。 |
| `OPENAI_IMAGE_GENERATION_COMPLEXITY` | `low` | 畫圖前的規劃程度：`low`、`medium`、`high`。越高越慢。 |
| `OPENAI_IMAGE_GENERATION_TIMEOUT` | `55000` | 畫圖等待毫秒數。 |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-transcribe` | 語音轉文字模型。 |
| `OPENAI_COMPLETION_BASE_URL`／`OPENAI_COMPLETION_API_KEY` | 跟 `OPENAI_BASE_URL`／`OPENAI_API_KEY` 一樣 | 只讓「聊天」改用別家服務，見下方開源模型。 |
| `BLOB_READ_WRITE_TOKEN` | 無 | Vercel Blob 權杖，連結 Blob store 後自動產生。 |
| `IMAGE_PUBLIC_URL` | 無 | 不用 Blob 時，圖片網址要用的網域。 |

`OPENAI_COMPLETION_PRESENCE_PENALTY` 的預設從 0.6 改成 0（不送出），因為新的推理模型不一定接受這個參數。需要的話可以自己設定。

## 改用開源模型（只換聊天）

聊天可以改用任何「OpenAI 相容」的服務，畫圖、語音仍然走 OpenAI。只要設定：

```
OPENAI_COMPLETION_BASE_URL=服務的網址（不要加 /v1）
OPENAI_COMPLETION_API_KEY=那個服務的金鑰
OPENAI_COMPLETION_MODEL=模型名稱
```

程式會自己在網址後面加 `/v1/chat/completions`，所以網址**不要**以 `/v1` 結尾。

### 範例：OpenRouter（雲端，最簡單）

```
OPENAI_COMPLETION_BASE_URL=https://openrouter.ai/api
OPENAI_COMPLETION_API_KEY=你的 OpenRouter 金鑰
OPENAI_COMPLETION_MODEL=qwen/qwen3-32b
```

模型名稱請到 openrouter.ai/models 複製實際的 ID，上面的只是格式範例。

### 範例：Ollama（自己的主機）

```
OPENAI_COMPLETION_BASE_URL=https://你的主機網域
OPENAI_COMPLETION_API_KEY=任意字串或你反向代理的密碼
OPENAI_COMPLETION_MODEL=qwen3:8b
```

注意事項：

- Vercel 連不到你電腦上的 `localhost`，Ollama 要放在網路上連得到的主機。
- Ollama 本身**沒有密碼保護**，不要直接把 11434 埠開到網路上；請在前面加一層會檢查 `Authorization` 的反向代理。

### 選哪個模型

- **Qwen 3 系列**：中文能力強，Apache 2.0 授權，可商用。
- **Gemma 4**：Apache 2.0 授權，小模型適合自己的主機（較舊的 Gemma 版本用 Google 自己的授權）。
- **Llama 4**：授權限制月活躍使用者 7 億以下免費，大多數人不受影響。

開源模型通常不支援看圖。如果使用者會傳圖片，把 `OPENAI_VISION_MODEL` 設成該服務上支援圖片的模型，否則傳圖會失敗。

## LINE 相關

- 新增 Flex Message 卡片訊息：`app/messages/flex.js` 的 `createCardBubble()` 可以做出標題列、內文、星級和按鈕，在 handler 裡用 `context.pushFlex('通知文字', createCardBubble({...}))` 送出。可以先貼到 [Flex Message Simulator](https://developers.line.biz/flex-simulator/) 預覽。
- 如果之後加 LIFF 網頁，請用 LIFF SDK v2.31.1 以上。網路上的整理指出 LINE 預計 2026-11-24 左右限制 v2.20.0–v2.31.0，請到 [LINE Developers News](https://developers.line.biz/en/news/) 確認。
- 這個 Bot 只用 Reply API 回覆。台灣 LINE 官方帳號費率在 2026-11-01 調整過，請到 LINE 官方公告確認。

## 4.10.0 新功能

| 指令（英文別名） | 給誰用 | 做什麼 |
| --- | --- | --- |
| `畫介面 需求`（`/ui`） | 產品／設計 | 把一句需求變成可以貼到 Claude、v0 的介面提示詞，元件名稱只從 157 個名詞表挑（來源：Threads @nexora_macauai 的 6 份懶人包） |
| `寫貼文 主題`（`/post`） | 行銷／內容 | 依主題寫一則 Threads／IG 貼文含 hashtag；只傳「寫貼文」就用前一段對話當主題 |
| `模型檢查`（`/models`） | 技術開發 | 查聊天、看圖、畫圖、語音四個模型在 OpenAI 公告的關閉日期，90 天內會標「注意」 |
| `我的ID`（`/id`） | 管理員 | 回覆使用者 ID，在群組裡也回覆群組 ID，用來設定白名單 |

`畫介面` 和舊的 `請畫` 不會打架：雖然「畫」是畫圖的別名，`畫介面` 會先被認出來。

### 白名單（只讓特定人或群組使用）

```
APP_ALLOWED_USER_IDS=U1234...,U5678...
APP_ALLOWED_GROUP_IDS=C1234...
```

- 兩個都空白（預設）＝所有人都能用，和以前一樣。
- 群組訊息看群組名單；一對一私訊看使用者名單。
- 不在名單的人私訊 Bot 會收到「還沒開放」的提示；不在名單的群組，Bot 完全不出聲。兩種情況都可以傳 `我的ID` 拿到 ID 交給管理員。

### 內容審查

設定 `OPENAI_MODERATION_ENABLED=true` 後，每則文字、語音轉成的文字和圖片會先送 OpenAI 的 `omni-moderation-latest` 檢查（免費），被標記的訊息不回覆、也不寫進對話紀錄。審查服務出錯時 Bot 照常回覆，只在 log 留紀錄。每則訊息會多一次 API 呼叫，回覆會稍慢一點。

### 其他設定

- `APP_REPORT_URL`：`回報` 指令要給的網址，預設是這個 repo 的 Issues 頁。如果 repo 沒開 Issues，改成客服信箱頁或表單網址。
- `APP_MODEL_WARNING_DAYS`：`模型檢查` 提前幾天標「注意」，預設 90。
- `版本` 指令改成比對這個 repo 的 `main` 分支，版本號依數字大小比較。
- 每個 PR 會自動跑 eslint 和測試（`.github/workflows/test.yml`）。

## 其他

- Docker 映像改用 Node 22（Node 18 已在 2025-04 停止維護），`package.json` 也標示需要 Node 20 以上。
- 正式環境套件漏洞已修到 0 個；`@vercel/blob` 帶進來的 `zod` 用 `overrides` 固定在已修補的 4.6.6 以上。
- 上游專案 memochou1993/gpt-ai-assistant 最後更新在 2024-07，之後的模型異動要自己留意。
