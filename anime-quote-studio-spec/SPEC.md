# Anime Quote Studio — 動漫語錄 AI 擷取與自動剪輯系統｜完整開發規格 v1.1

> 本文件是「唯一的需求來源（Single Source of Truth）」。
> 請放在專案根目錄 `docs/SPEC.md`，AI 開發工具每次開工前都必須先讀本文件與 `AI_RULES.md`。
> 遇到本文件未定義的情況：先提出選項與建議，等待確認，不可自行擴大範圍。

---

## 0. 產品定位（一句話）

上傳**使用者有權使用**的日文動漫影片 → AI 產生日文逐字稿與繁體中文翻譯 → 區分說話者並人工對應角色 → AI 找出有時間碼、可回溯的金句並評分 → 使用者挑選、調整、排序 → FFmpeg 輸出帶字幕的 MP4 / SRT / JSON / CSV。

這是**影音分析與剪輯工具**，不是影片下載器。

---

## 1. 已鎖定的技術決策（AI 不得自行更換）

| 項目 | 決定 | 理由 |
|---|---|---|
| 專案結構 | Monorepo：`web/`（前端）、`backend/`（API + Worker 共用程式碼） | API 與 Worker 共用模型與服務層 |
| 前端 | Next.js（App Router）+ TypeScript + Tailwind CSS + shadcn/ui | 依原需求 |
| 後端 | Python 3.11+、FastAPI、Pydantic v2、SQLAlchemy 2、Alembic | 依原需求，Alembic 管理 migration |
| 背景工作 | **Celery + Redis** | 後端是 Python，**不使用 BullMQ**（BullMQ 是 Node.js 專用） |
| 資料庫 | **PostgreSQL 16（本機 Docker）** | Phase 1–3 不依賴 Supabase；Phase 4 再評估 Supabase Auth / 雲端 Postgres |
| 語音辨識 | `faster-whisper`（預設 `large-v3`，CPU 環境可改 `medium`），`language="ja"`、`vad_filter=True`、`word_timestamps=True` | 可本機執行、有字級時間碼 |
| 人聲分離（選用） | Demucs（只取 vocals 軌）| 背景音樂大時提升辨識率，可在專案設定開關 |
| 說話者分離 | pyannote.audio 官方 speaker diarization 管線 | 需 Hugging Face Token 並在 HF 網站接受模型使用條款 |
| LLM（翻譯、評分） | 透過 `LLMProvider` 介面呼叫，預設 OpenAI API，可抽換其他供應商 | 不綁死單一供應商 |
| 簡繁檢查 | OpenCC（`s2twp`）作為翻譯後處理與檢查 | 防止簡體中文混入 |
| 影片處理 | FFmpeg / FFprobe（以 subprocess 參數陣列呼叫） | — |
| 字幕燒錄 | ASS 字幕 + libass，Docker 映像內安裝 **Noto Sans CJK TC 與 JP** | 避免中日文字變方框（豆腐字） |
| 時間單位 | **全系統一律使用整數毫秒（ms）** 儲存與傳遞 | 避免浮點誤差累積造成字幕偏移 |
| 檔案儲存 | 本機 `./data/`（Docker volume），以 `StorageBackend` 介面封裝，Phase 4 加 S3 相容儲存 | — |
| 部署 | Docker Compose：`web`、`api`、`worker`、`postgres`、`redis` | — |
| 測試 | 後端 pytest；前端 Vitest；E2E Playwright | — |

---

## 2. 完整使用者流程

```
建立專案 → 上傳影片（勾選權利聲明）→ 背景分析（進度可見）
→ 檢視逐字稿／修正翻譯 → 說話者對應角色 → 金句清單（篩選、評分、收藏、排除）
→ 加入剪輯清單 → 排序／調整切點／字幕設定 → 輸出 MP4 + SRT → 下載
```

### STEP 1 建立專案
- 欄位：專案名稱（必填）、作品名稱（選填，可從作品庫選）、影片主要語言（預設日文）、翻譯目標（固定繁體中文 zh-TW）、預設輸出比例。
- 來源：
  - **Phase 1–3：只支援本機上傳**（MP4 / MOV / MKV / WebM）。
  - Phase 4：加入 YouTube 連結（見第 9 節，有嚴格限制）。

### STEP 2 上傳與媒體檢查
1. 上傳前必須勾選：「我確認擁有處理此影片的必要權利」。寫入 `rights_records`（使用者、時間、聲明版本、IP）。
2. 檔案驗證**以 FFprobe 結果為準，不信任副檔名**：必須有視訊軌與音訊軌、時長 > 0、編碼可解碼。
3. 計算 SHA-256，同一使用者重複上傳相同檔案時，提示可沿用既有分析結果（避免重複計費）。
4. 大小上限由環境變數 `MAX_UPLOAD_MB` 控制（預設 4096）。
5. **產生預覽用 Proxy 檔**：H.264 / AAC / 720p / MP4（faststart）。
   瀏覽器無法播放 MKV、HEVC、部分 MOV，所以前端一律播放 Proxy 檔，剪輯輸出一律用原始檔。
6. 影片串流 API 必須支援 HTTP Range（否則前端無法拖曳時間軸、跳到指定時間）。

### STEP 3 分析管線（背景工作，每個階段可獨立重跑）

| 順序 | Stage | 內容 | 輸出 |
|---|---|---|---|
| 1 | `probe` | FFprobe 讀取時長、解析度、幀率（含 VFR 偵測）、音軌 | videos 欄位 |
| 2 | `proxy` | 產生 720p 預覽檔 | proxy 檔 |
| 3 | `extract_audio` | 抽出 16kHz mono WAV | audio 檔 |
| 4 | `separate_vocals`（選用） | Demucs 人聲分離 | vocals.wav |
| 5 | `asr` | faster-whisper 日文辨識，含字級時間碼 | transcript_segments |
| 6 | `diarize`（Phase 2） | pyannote 說話者分離，依時間重疊比例把 speaker 指派給每段台詞 | speakers、segments.speaker_id |
| 7 | `translate` | LLM 日翻繁中，帶前後文與名詞表 | segments.translated_text |
| 8 | `extract_quotes` | LLM 金句擷取與評分 | quotes、quote_segments |

規則：
- 每個 stage 執行前檢查是否已完成（冪等）；失敗只重跑失敗的 stage，**已完成的結果不可刪除**。
- 長影片：音訊切成 10 分鐘區塊（區塊間重疊 2 秒，合併時去重），每個區塊完成就寫入資料庫，支援斷點續跑。
- 進度百分比必須來自真實資料（例如已處理秒數 / 總秒數），**不可用假的計時動畫**。無法計算時顯示「處理中」而非假百分比。
- 支援取消：Worker 在每個區塊之間檢查取消旗標。
- 同一影片同一 stage 同時只能有一個工作（以資料庫唯一約束或 Redis lock 防止重複提交）。

### STEP 4 逐字稿與翻譯
- `asr_text`：ASR 原始輸出，**永遠不可修改**（稽核用）。
- `original_text`：可人工修正的日文原文（預設等於 asr_text）。
- `translated_text`：可人工修正的繁中翻譯。
- `edited_by_user` 旗標：人工改過的欄位，重新跑翻譯時**不可覆蓋**。
- 翻譯時：每批 30–50 句，附上前後各 5 句作為上下文（上下文本身不翻譯輸出）、附上作品名詞表（角色名、招式名的固定譯名）。
- 翻譯後用 OpenCC 檢查，若偵測到簡體字，自動轉換並記錄警告。
- ASR 信心低（`avg_logprob` 過低或 `no_speech_prob` 過高）的段落標示「⚠ 低信心，建議人工確認」。
- 過濾 Whisper 常見幻覺：靜音或純音樂段落產生的「ご視聴ありがとうございました」「チャンネル登録」等文字，需依 no_speech_prob 與 VAD 結果剔除或標記。

### STEP 5 角色辨識（三層，依 Phase 逐步完成）
1. **聲音層（Phase 2）**：pyannote 產生 `SPEAKER_00`、`SPEAKER_01`…，只代表「不同聲音」，不代表角色身分。
2. **人工對應（Phase 2，必做）**：角色管理頁點選 speaker → 播放該 speaker 的 3 段代表台詞 → 選擇角色或「未知角色」→ 確認後 `verified=true`。
3. **畫面層（Phase 5，選做）**：抽關鍵影格做角色外觀比對，只能作為「建議」，信心低於門檻一律顯示未知。
   - **不可以因為角色出現在畫面上就判定是他在說話**（旁白、畫外音、背對鏡頭很常見）。
- 重疊語音（兩個 speaker 時間重疊超過 30%）標記 `overlap=true`，UI 顯示需人工確認。
- 角色未知時 `character_id = null`，介面顯示「未知角色」，**不可猜測**。

### STEP 6 AI 金句擷取（核心防造假設計）

**關鍵設計：LLM 只回傳「逐字稿段落 ID」，不回傳台詞文字。台詞文字一律由後端從資料庫組回。**
這樣 AI 從結構上就無法編造台詞。

LLM 輸入：帶 ID 的逐字稿段落（ID、時間、speaker、日文、中文）。
LLM 輸出（JSON，必須通過 Pydantic Schema 驗證）：

```json
{
  "quotes": [
    {
      "segment_ids": [123, 124],
      "tags": ["熱血", "成長"],
      "scores": {
        "emotion": 22,
        "depth": 20,
        "standalone": 17,
        "visual_tension": 12,
        "short_video_appeal": 13
      },
      "reasons": {
        "emotion": "簡短理由",
        "depth": "簡短理由",
        "standalone": "簡短理由",
        "visual_tension": "簡短理由（若只看文字無法判斷，需註明）",
        "short_video_appeal": "簡短理由"
      },
      "suggested_title": "選填：適合短影音的標題，與原始台詞分開存放"
    }
  ]
}
```

後端驗證規則（任一不通過 → 該筆丟棄並記錄，整批失敗則重試最多 2 次，仍失敗標記 stage 失敗）：
- `segment_ids` 必須都存在於本次輸入、屬於同一影片、**時間上連續**（不可跳段拼接）。
- 同一金句的段落必須是**同一個 speaker**，或明確標記為「對話型金句」。
- 合併後長度 3–60 秒（可設定）。
- 分數範圍：emotion 0–25、depth 0–25、standalone 0–20、visual_tension 0–15、short_video_appeal 0–15；總分由**後端計算**，不採用 LLM 自報的總分。
- tags 必須屬於固定清單：熱血、勵志、霸氣、愛情、友情、親情、悲傷、人生哲理、成長、孤獨、搞笑、反轉、經典名場面。

長影片：逐字稿切成每批約 150 段、批次間重疊 20 段；全部完成後做跨批去重（時間重疊 > 50% 視為重複，保留高分者），再依總分排名。

每筆金句儲存 `model`、`prompt_version`，方便日後比較與重跑。

> 注意：`visual_tension`（畫面張力）在 Phase 1 只能根據文字推測，UI 必須標示「依文字推估」。Phase 5 有影格分析後才改為視覺判斷。

### STEP 7 金句管理頁
- 搜尋：日文原文、中文翻譯關鍵字（日文沒有空格，MVP 使用 `ILIKE '%關鍵字%'`；需寫測試確認日文、中文子字串搜尋正確）。
- 篩選：作品、角色、標籤、最低分數、長度、是否收藏、是否排除、是否已人工確認。
- 排序：分數、影片時間。
- 每張卡片顯示：作品、角色（含信心與是否確認）、日文原文、繁中翻譯、開始／結束時間、標籤、總分與五項分數＋理由、建議標題（與原文分開顯示）。
- 操作：預覽（播放器跳到 start_ms 並在 end_ms 自動暫停）、加入剪輯清單、收藏、排除、修改翻譯、修改角色、調整切點（±100ms 微調按鈕＋直接輸入）。
- 調整切點只改金句的 `start_ms / end_ms`，**不改原始逐字稿**。

### STEP 8 剪輯工作區（Phase 3）
- 左：已選片段清單；中：預覽播放器；下：簡易時間軸；右：字幕與輸出設定。
- 片段操作：拖曳排序、單段播放、全部連續預覽、刪除、複製（同一金句可重複使用）、前後緩衝（預設前 300ms、後 500ms，可調整）、手動切點。
- 比例：9:16（1080×1920）、16:9（1920×1080）、1:1（1080×1080）。
- **直式構圖三種模式**（預設「模糊背景」，最不會切掉人物）：
  1. 模糊背景：原畫面等比縮放置中，上下填滿同畫面的模糊放大版。
  2. 裁切：以 X 位置（0–100%）裁切，每個片段可單獨設定，預覽即時顯示裁切框。
  3. 黑邊：等比縮放加黑邊。
- 轉場：無／淡入淡出（MVP 只做這兩種）。
- 背景音樂：上傳音檔、音量、人聲音量；選用「人聲出現時自動壓低音樂」（ducking）。

### STEP 9 字幕
- 模式：只有日文／只有繁中／日文＋繁中（雙行）／無字幕。
- 樣式：字型、大小、顏色、描邊、陰影、位置（距底部 %）、行距、每行最大字數。
- 斷行：日文與中文沒有空格，依標點與每行字數斷行；過長台詞依**字級時間碼**拆成多個字幕事件，**不可依字數平均分配時間**。
- 字幕時間必須在剪輯後重新計算：`輸出時間 = 原始時間 − 片段起點 + 片段在成品中的偏移 + 轉場影響`。這是最容易出錯的地方，必須有單元測試。
- 燒錄字幕與另外輸出 SRT 必須使用**同一份時間軸計算結果**。

### STEP 10 輸出
- 輸出物：MP4（H.264 + AAC）、SRT（UTF-8）、JSON（金句完整資料）、CSV（UTF-8 with BOM，Excel 才不會亂碼）、剪輯時間碼清單（EDL 或 JSON）。
- 渲染流程（避免合併失敗）：
  1. 每個片段**重新編碼**為標準化中間檔：相同解析度、`yuv420p`、30fps CFR、AAC 48kHz 立體聲、相同 timebase。**不可用 `-c copy` 切片**（只能切在關鍵影格，會黑畫面或時間錯位）。
  2. 套用構圖（模糊背景／裁切／黑邊）。
  3. 用 concat 合併（中間檔參數完全一致才可用 concat demuxer）。
  4. 燒錄 ASS 字幕（指定 `fontsdir`）。
  5. 混入背景音樂、`loudnorm` 音量標準化。
- 重新輸出不重跑 ASR / 翻譯 / 金句分析，只讀資料庫重新渲染。
- 渲染狀態：排隊中 → 處理中（目前步驟、真實進度）→ 完成（下載按鈕）／失敗（可讀錯誤＋重試）。
- **未通過權利檢查（rights_status 不是 `attested`）的影片，後端直接拒絕渲染**，不能只靠前端隱藏按鈕。

---

## 3. 頁面清單

| 頁面 | 路由 | Phase |
|---|---|---|
| 首頁／最近專案／建立專案 | `/` | 1 |
| 分析工作台（播放器、進度、逐字稿、金句） | `/projects/[id]` | 1 |
| 金句資料庫（跨影片） | `/quotes` | 1 |
| 角色管理 | `/projects/[id]/characters`、`/anime/[id]` | 2 |
| 剪輯器 | `/projects/[id]/editor` | 3 |
| 輸出管理 | `/projects/[id]/renders` | 3 |
| 系統狀態（FFmpeg、GPU、API Key 是否設定、磁碟空間） | `/settings/health` | 1 |
| 操作說明（真實截圖＋範例影片導覽） | `/help` | 實測完成後 |

UI：深色主題、全繁體中文、桌面與手機可瀏覽；時間軸進階操作以桌面為主，手機顯示簡化版。
所有按鈕都必須有實際功能；未完成的功能**隱藏或顯示「尚未開放（Phase X）」**，不可放假按鈕。

---

## 4. 資料庫 Schema（PostgreSQL，全部用 Alembic migration 建立）

> 時間欄位皆為整數毫秒 `*_ms`。所有表格有 `id`（UUID 或 bigint）、`created_at`、`updated_at`。

```
users              id, email, display_name                       -- Phase 1 建一個本機預設使用者，Phase 4 接登入
projects           id, owner_id→users, name, anime_id→anime_titles(null), default_aspect, status
videos             id, project_id→projects, source_type(upload|youtube), source_url, youtube_video_id,
                   youtube_playlist_id(只記錄不展開), youtube_title, youtube_channel,
                   original_path, proxy_path, audio_path, vocals_path, sha256,
                   duration_ms, width, height, fps, is_vfr, language,
                   processing_status, rights_status(unverified|attested|text_only|blocked)
rights_records     id, video_id, user_id, statement_version, statement_text, ip, accepted_at
anime_titles       id, title, alternate_titles(text[])
characters         id, anime_id→anime_titles, name, aliases(text[]), reference_images(jsonb)
glossary_terms     id, anime_id, source_text(日文), target_text(繁中), type(角色|招式|地名|其他)
speakers           id, video_id, speaker_label, character_id→characters(null), confidence, verified
transcript_segments id, video_id, speaker_id(null), seq, start_ms, end_ms,
                   source(asr|youtube_caption|uploaded_subtitle),
                   asr_text, original_text, translated_text, words(jsonb: 字級時間碼),
                   asr_confidence, no_speech_prob, overlap, low_confidence,
                   original_edited, translation_edited
quotes             id, video_id, character_id(null), start_ms, end_ms, tags(text[]),
                   score_total, score_details(jsonb), suggested_title,
                   favorite, excluded, verified, model, prompt_version
quote_segments     quote_id, segment_id, position                -- 用關聯表而非陣列，保留外鍵完整性
clips              id, project_id, quote_id, start_ms, end_ms, pad_before_ms, pad_after_ms,
                   sort_order, framing(blur|crop|letterbox), crop_x(0-100)
render_jobs        id, project_id, settings(jsonb 快照), status, stage, progress,
                   output_mp4_path, output_srt_path, error_message, started_at, finished_at
processing_jobs    id, video_id, stage, status(pending|running|done|failed|cancelled),
                   attempts, progress, cancel_requested, celery_task_id, error_message
usage_logs         id, user_id, provider, model, purpose, input_tokens, output_tokens, audio_seconds, cost_estimate
```

必要約束與索引：
- `processing_jobs(video_id, stage)` 在 `status in (pending, running)` 時唯一（partial unique index），防止重複提交。
- `transcript_segments(video_id, seq)` 唯一；`(video_id, start_ms)` 索引。
- `quotes(video_id, score_total desc)`、`quotes(character_id)` 索引；`tags` GIN 索引。
- 所有查詢必須以 `owner_id` 過濾，**API 層強制檢查資源歸屬**（不同使用者不可存取彼此專案與檔案）。
- 刪除影片時同時刪除實體檔案（原始、proxy、音訊、輸出）。

---

## 5. API 清單（前綴 `/api`）

```
GET    /health                                  系統檢查（ffmpeg、db、redis、gpu、各 API key 是否已設定，不回傳金鑰值）

POST   /projects                                建立專案
GET    /projects                                專案列表
GET    /projects/{id}  PATCH  DELETE

POST   /projects/{id}/videos                    上傳影片（multipart，必須含 rights_accepted=true）
GET    /videos/{id}                             影片資訊與各 stage 狀態
GET    /videos/{id}/stream                      Proxy 播放（支援 Range）
DELETE /videos/{id}                             刪除影片與所有衍生檔案

POST   /videos/{id}/analyze                     啟動／續跑分析（body：要跑的 stages、是否人聲分離）
GET    /videos/{id}/jobs                        各 stage 工作狀態
POST   /jobs/{id}/cancel
POST   /jobs/{id}/retry

GET    /videos/{id}/segments                    逐字稿（分頁）
PATCH  /segments/{id}                           修正原文／翻譯（設定 edited 旗標）

GET    /quotes?video_id&project_id&anime_id&character_id&tag&min_score&q&favorite&excluded&sort&page
PATCH  /quotes/{id}                             收藏、排除、確認、切點、角色、翻譯

GET    /videos/{id}/speakers                    （Phase 2）
GET    /speakers/{id}/samples                   代表台詞片段
PATCH  /speakers/{id}                           指定角色、確認
CRUD   /anime、/anime/{id}/characters、/anime/{id}/glossary

GET    /projects/{id}/clips    POST  PATCH /clips/{id}  DELETE /clips/{id}   （Phase 3）
PUT    /projects/{id}/clips/order
POST   /projects/{id}/renders                   建立渲染（後端檢查 rights_status）
GET    /renders/{id}
GET    /renders/{id}/download?type=mp4|srt
GET    /videos/{id}/export?format=json|csv|srt  不需渲染即可匯出
```

錯誤回應統一格式：`{ "error": { "code": "VIDEO_NO_AUDIO", "message": "這部影片沒有音軌，無法進行語音辨識。" } }`
`code` 給程式判斷，`message` 為繁體中文給使用者看。

---

## 6. 目錄結構

```
anime-quote-studio/
├─ docker-compose.yml
├─ .env.example
├─ docs/SPEC.md、docs/PROGRESS.md（每階段完成後更新）
├─ web/                         Next.js
│  ├─ app/  components/  lib/api.ts（型別化 API client）
│  └─ tests/（Vitest）  e2e/（Playwright）
├─ backend/
│  ├─ app/
│  │  ├─ main.py  api/  models/  schemas/  services/
│  │  ├─ pipeline/   probe.py proxy.py audio.py asr.py diarize.py translate.py quotes.py
│  │  ├─ render/     timeline.py（時間軸與字幕偏移計算） ass.py ffmpeg_cmd.py
│  │  ├─ providers/  llm.py（LLMProvider 介面） asr.py storage.py
│  │  ├─ prompts/    translate_v1.md  quotes_v1.md（版本化）
│  │  └─ worker.py   Celery 任務
│  ├─ alembic/
│  └─ tests/  unit/  integration/  fixtures/
└─ data/                       （gitignore）上傳、proxy、輸出
```

---

## 7. 環境變數（`.env.example`，不可提交真實金鑰）

```
DATABASE_URL=postgresql+psycopg://aqs:aqs@postgres:5432/aqs
REDIS_URL=redis://redis:6379/0
DATA_DIR=/data
MAX_UPLOAD_MB=4096
OPENAI_API_KEY=
LLM_MODEL=
HF_TOKEN=                       # pyannote 用，需先在 Hugging Face 接受模型條款
WHISPER_MODEL=large-v3          # CPU 可改 medium
WHISPER_DEVICE=auto             # cuda / cpu / auto
ENABLE_VOCAL_SEPARATION=false
YOUTUBE_API_KEY=                # Phase 4
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

- 金鑰只在後端讀取，**不可出現在前端程式碼或 `NEXT_PUBLIC_*` 變數**。
- 金鑰未設定時：相關功能回傳明確錯誤「尚未設定 OPENAI_API_KEY」，**不可改用假資料**。
- 日誌不可印出金鑰、完整請求標頭。

---

## 8. 錯誤處理對照表

| 情況 | 錯誤碼 | 處理 |
|---|---|---|
| 檔案不是影片／損壞 | `INVALID_MEDIA` | 上傳時 FFprobe 驗證失敗即拒絕 |
| 沒有音軌 | `VIDEO_NO_AUDIO` | 停止分析，提示 |
| 不支援的編碼 | `UNSUPPORTED_CODEC` | 顯示編碼名稱 |
| 辨識結果幾乎為空 | `ASR_EMPTY` | 提示可能是純音樂，建議開啟人聲分離 |
| LLM 逾時／限流 | `LLM_TIMEOUT`、`LLM_RATE_LIMIT` | 指數退避重試 3 次，保留已完成批次 |
| LLM 額度不足 | `LLM_QUOTA` | 停止並提示，不重試 |
| LLM 輸出驗證失敗 | `LLM_INVALID_OUTPUT` | 重試 2 次，仍失敗標記，不寫入錯誤資料 |
| HF Token 未設定 | `DIARIZATION_NOT_CONFIGURED` | 說話者分離跳過，其他功能照常 |
| FFmpeg 失敗 | `RENDER_FAILED` | 保存 stderr 最後 50 行於日誌，使用者看到可讀訊息 |
| 磁碟空間不足 | `STORAGE_FULL` | 上傳與渲染前檢查剩餘空間 |
| 工作被取消 | `CANCELLED` | 保留已完成結果 |
| 重複提交 | `JOB_ALREADY_RUNNING` | 回傳既有工作 ID |
| 無權利聲明 | `RIGHTS_REQUIRED` | 拒絕渲染 |

安全要求：
- 所有 FFmpeg / FFprobe / Demucs 指令用 `subprocess.run([...])` 參數陣列，**禁止 `shell=True`**，禁止把使用者輸入拼進指令字串。
- 上傳檔名不可直接當路徑使用（防路徑穿越），一律用 UUID 命名。
- Phase 4 處理 URL 時只接受 `youtube.com` / `youtu.be`，只抽出 video ID，**後端不對使用者提供的任意 URL 發出請求**（防 SSRF）。
- 暫存檔在工作結束（成功或失敗）後清理。
- CORS 只允許前端網域。

---

## 9. 版權與 YouTube（重要，請 AI 嚴格遵守）

1. **不使用 yt-dlp、youtube-dl 或任何方式下載 YouTube 影片或音訊**，不繞過 DRM、登入、地區限制。
2. YouTube 官方 API 的限制（請照實作，不要假設可以拿到字幕）：
   - YouTube Data API `videos.list`：可取得標題、頻道、時長等公開資訊。
   - YouTube IFrame Player API：可嵌入播放並 `seekTo()` 跳到時間點。
   - YouTube Data API `captions.download`：**只對使用者自己擁有（或有編輯權）的影片有效**，需要 OAuth。別人的影片無法用官方 API 下載字幕。
3. 網址解析規則（純函式，必須有單元測試，測試案例見 `docs/TEST_CASE_YOUTUBE.md`）：
   - 用 URL 解析器取出 hostname，**完全比對**白名單：`youtube.com`、`www.youtube.com`、`m.youtube.com`、`youtu.be`。不可用「字串包含 youtube.com」判斷（`youtube.com.evil.com`、`youtube.com@evil.com` 都必須拒絕）。
   - 支援 `watch?v=`、`youtu.be/`、`shorts/`、`embed/` 四種格式，video ID 必須符合 `^[A-Za-z0-9_-]{11}$`。
   - `list=`（播放清單）、`index=` 只記錄，不展開整個清單（播放清單批次分析屬 Phase 5）。只有清單、沒有 `v=` 的網址回傳 `PLAYLIST_NOT_SUPPORTED`。
   - `t=` / `start=` 轉成起始時間（毫秒），作為播放器初始位置。
4. 因此 YouTube 模式（Phase 4）的實際流程：
   - 貼連結 → 取得公開資訊 → 嵌入播放器。
   - 若是使用者自己的頻道影片：OAuth 授權後下載字幕。
   - 其他影片：使用者可**上傳自己有權使用的字幕檔**（SRT / VTT / ASS）→ 進入「純文字分析模式」（`rights_status = text_only`）：可做翻譯、金句、時間碼、跳轉播放，**停用剪輯與 MP4 輸出**，並提示「如需剪輯，請上傳您有權使用的影片檔」。
5. 上傳影片時記錄權利聲明；輸出頁面提示「公開發布第三方素材前，請確認您具備必要權利」。
6. 系統與文件**不可宣稱**剪輯短影音必然屬於合理使用。
7. 使用者可刪除自己上傳的素材與所有輸出檔。
8. 若影片是使用者自己頻道的作品：可由 YouTube Studio 官方「下載」功能取得 MP4 後走上傳模式（完整剪輯功能），字幕可經 OAuth 以 `captions.download` 取得。

---

## 10. 分階段開發與驗收

### Phase 1 — 語錄擷取（必須先能跑起來）
範圍：Docker Compose、專案 CRUD、影片上傳＋權利聲明、FFprobe、Proxy、抽音訊、ASR、翻譯、金句擷取與評分、金句清單（搜尋／篩選／收藏／排除／修改翻譯／切點）、播放器跳轉、JSON / CSV / SRT（原片時間）匯出、健康檢查頁。
驗收：
- [ ] `docker compose up` 一行啟動，首頁可開。
- [ ] 上傳一部 3–5 分鐘日文影片，分析完成，逐字稿時間碼與畫面對得上（抽查 5 句誤差 < 0.5 秒）。
- [ ] 每個金句點「預覽」能跳到正確位置；金句文字 100% 來自逐字稿（有自動化測試證明：餵假的 segment_id 會被拒絕）。
- [ ] 修改翻譯後重新整理仍存在；重跑翻譯不覆蓋人工修改。
- [ ] 中途關掉 worker 再開，可從未完成的 stage 續跑。
- [ ] 未設定 OPENAI_API_KEY 時顯示明確錯誤，而不是假結果。

### Phase 2 — 說話者與角色
範圍：pyannote、speaker 指派、重疊標記、作品／角色／名詞表 CRUD、speaker 對應角色（附代表台詞試聽）、依角色篩選、名詞表套用到翻譯。
驗收：兩人對話影片能分出 2 個 speaker；手動對應後金句卡片顯示角色名；未設定 HF_TOKEN 時其他功能正常。

### Phase 3 — 自動剪輯
範圍：剪輯清單、排序、緩衝、切點、三種構圖、字幕樣式、淡入淡出、背景音樂、渲染工作、輸出管理、MP4＋SRT 下載、重新輸出。
驗收：
- [ ] 勾選 3 段以上（來源可為不同解析度／幀率的影片）輸出可播放的 1080×1920 MP4。
- [ ] 燒錄字幕中日文都正常顯示（非方框），與語音同步。
- [ ] 下載的 SRT 時間與成品 MP4 一致。
- [ ] `timeline.py` 有單元測試涵蓋：多片段偏移、緩衝、淡入淡出、長台詞拆分。
- [ ] rights_status 非 attested 時，直接呼叫渲染 API 也會被拒絕。

### Phase 4 — YouTube 與雲端
範圍：依第 9 節實作 YouTube 模式、使用者登入、資源權限、S3 相容儲存、上傳續傳、用量統計頁。
驗收：使用者 A 無法透過 API 取得使用者 B 的專案／影片／輸出（有自動化測試）；YouTube 純文字模式下渲染按鈕停用且 API 拒絕。

### 實測與操作說明（全部測試建立完成、Phase 4 驗收通過後）
用使用者指定的 YouTube 影片跑完整操作流程，並以真實截圖製作 `docs/USER_GUIDE.md` 與站內 `/help` 頁。
完整步驟與通過標準見 `docs/TEST_CASE_YOUTUBE.md`。

### Phase 5 — 進階
畫面角色辨識建議、自動直式構圖（主體偵測）、跨影片金句搜尋、批量分析、字幕模板、成本報表。

---

## 11. 測試素材與測試策略

- **Git 倉庫內不可放有版權的動漫片段。**
- 測試素材來源：
  1. 自製：自己錄日文台詞（或用合法 TTS）＋ FFmpeg `testsrc` 產生畫面合成短片，放在 `backend/tests/fixtures/`。
  2. 手動驗收：使用者在本機放自己有權使用的影片，不進 Git。
- 單元測試可用固定的 ASR / LLM 輸出 fixture（**只能存在於測試程式中，不可出現在正式執行路徑**）。
- 需要真實模型或 API 的整合測試加上 `@pytest.mark.requires_gpu` / `requires_api_key`，沒有條件時自動跳過並在報告中列出。
- 至少一條 Playwright E2E：建立專案 → 上傳 → 等分析完成 → 選 3 句 → 輸出 → 下載檔案存在且 FFprobe 驗證可播放。
- 需涵蓋情境：單人說話、兩人輪流、多人、背景音樂大、戰鬥音效、畫外音、無字幕、已有字幕、直式與橫式來源、30 分鐘以上長片。
- **指定實測影片**：使用者指定的 YouTube 影片（video ID `Ac3LTZ4GgG0`），用於網址解析測試、Phase 4 YouTube 模式驗收與操作說明製作，詳見 `docs/TEST_CASE_YOUTUBE.md`。**不得下載此影片**；只有在使用者確認是自己頻道的影片並自行從 YouTube Studio 下載後，才可用該檔案走上傳模式。

---

## 12. 效能與成本參考（給使用者心裡有數）

- faster-whisper large-v3：有 NVIDIA GPU 時，24 分鐘一集約數分鐘內完成；**純 CPU 可能要數十分鐘甚至更久**，CPU 環境建議改 `medium` 或改用雲端轉錄 API（`ASRProvider` 介面可抽換）。
- Demucs 人聲分離在 CPU 上也很慢，預設關閉。
- pyannote 在 CPU 可執行但較慢。
- LLM 成本主要來自翻譯與金句分析，以 `usage_logs` 記錄每次呼叫；同一影片相同 prompt 版本的結果要快取，不重複呼叫。
