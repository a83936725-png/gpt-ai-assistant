# 分階段指令（依序複製貼給 AI，一次只貼一個）

> 每貼一個 Prompt，等 AI 回報完成 → 你自己實際操作驗收 → 沒問題再貼下一個。
> 驗收不通過：把錯誤訊息／畫面截圖貼回去，請它修，不要直接跳下一步。

---

## Prompt 0｜規劃（不寫程式）

```
請先閱讀 docs/SPEC.md、CLAUDE.md（AI 開發鐵則）、docs/TEST_CASE_YOUTUBE.md。

這一步不要寫任何程式，只要回覆：
1. 你對整個系統的理解（10 行內）
2. 目錄結構
3. 資料庫 Schema（依 SPEC 第 4 節，列出你打算的欄位型別與索引）
4. Phase 1 的 API 清單
5. Phase 1 拆成 1A／1B／1C 三個子步驟的工作清單
6. 你在目前執行環境能做到與做不到的事（Docker？GPU？網路能否連到 OpenAI、Hugging Face、YouTube？）
7. 規格中你認為有矛盾、不清楚或做不到的地方，以及你的建議

等我確認後再開始寫程式。
```

---

## Prompt 1A｜骨架

```
開始 Phase 1A。範圍只有：
- Monorepo 結構（web/、backend/）、docker-compose.yml（web、api、worker、postgres、redis）、.env.example
- Alembic migration 建立 SPEC 第 4 節所有資料表（含索引與約束）
- FastAPI：/api/health（檢查 ffmpeg、ffprobe、db、redis、GPU、各 API Key 是否已設定，不可回傳金鑰值）
- 專案 CRUD API ＋ 首頁（建立專案、最近專案）
- /settings/health 頁面顯示系統狀態
- 後端 Docker 映像安裝 ffmpeg 與 Noto Sans CJK TC / JP 字型
- 測試：health 與專案 CRUD 的 API 測試

完成標準：docker compose up 一行啟動，首頁可建立專案，health 頁顯示真實狀態。
依 CLAUDE.md 的固定格式回報。
```

## Prompt 1B｜上傳與語音辨識

```
開始 Phase 1B。範圍只有：
- 影片上傳（必須勾選權利聲明並寫入 rights_records）、FFprobe 驗證、SHA-256、重複檔案偵測
- Proxy 檔產生、/api/videos/{id}/stream 支援 HTTP Range
- Celery 分析管線：probe → proxy → extract_audio → asr（faster-whisper，字級時間碼）
- 每個 stage 冪等、可續跑、可取消、防重複提交；進度為真實數值
- 長音訊切塊（10 分鐘、重疊 2 秒）並去重
- 低信心標記、Whisper 幻覺字句過濾
- 分析工作台：播放器、各 stage 進度、逐字稿列表（點一句跳到該時間）
- 測試：上傳驗證（非影片檔、無音軌）、切塊合併去重、stage 續跑

用 FFmpeg 產生的合成測試影片做自動化測試，不要把有版權的影片放進 repo。
完成標準：上傳 3–5 分鐘日文影片，能看到有正確時間碼的日文逐字稿。
```

## Prompt 1C｜翻譯、金句、匯出

```
開始 Phase 1C。範圍只有：
- LLMProvider 介面（預設 OpenAI），呼叫記錄寫入 usage_logs，相同輸入與 prompt 版本要快取
- translate stage：分批、帶上下文、OpenCC 簡繁檢查、不覆蓋人工修改
- extract_quotes stage：依 SPEC 第 2 節 STEP 6，LLM 只回傳 segment_ids，後端驗證並組回文字，總分由後端計算，跨批去重
- prompts/ 內的 prompt 檔案要有版本號
- 金句管理頁（搜尋、篩選、排序、收藏、排除、修改翻譯、切點微調、預覽跳轉）與跨影片 /quotes 頁
- 匯出 JSON／CSV（UTF-8 BOM）／SRT
- 測試：LLM 回傳不存在或不連續的 segment_id 必須被拒絕；日文與中文子字串搜尋；SRT 格式

完成標準：SPEC 第 10 節 Phase 1 驗收清單全部打勾，並更新 docs/PROGRESS.md、git commit。
```

---

## Prompt 2｜說話者與角色

```
開始 Phase 2（SPEC 第 2 節 STEP 5、第 10 節 Phase 2）。範圍：
- pyannote 說話者分離 stage（HF_TOKEN 未設定時跳過並顯示原因，其他功能照常）
- 依時間重疊指派 speaker、重疊語音標記
- 作品、角色、名詞表 CRUD；名詞表套用到翻譯
- 角色管理頁：每個 speaker 可試聽 3 段代表台詞，指定角色或「未知角色」，確認後 verified
- 金句依角色篩選、卡片顯示角色與信心
- 測試：speaker 指派演算法（含重疊情況）的單元測試

完成後依固定格式回報，更新 PROGRESS.md、git commit。
```

---

## Prompt 3A｜剪輯後端（先做最容易出錯的部分）

```
開始 Phase 3A，只做後端：
- render/timeline.py：計算成品時間軸與字幕偏移（片段起點、前後緩衝、淡入淡出、長台詞依字級時間碼拆分）
- render/ass.py：產生 ASS 字幕（日文／繁中／雙語、樣式設定、中日文斷行）
- render/ffmpeg_cmd.py：片段標準化重新編碼（不可 -c copy）、三種直式構圖（模糊背景／裁切／黑邊）、concat、燒錄字幕、背景音樂、loudnorm
- render_jobs Celery 任務、真實進度、失敗保存 stderr 摘要
- 後端強制檢查 rights_status
- 測試：timeline.py 完整單元測試；用不同解析度、幀率的合成影片做一次真實渲染，用 FFprobe 驗證輸出

燒錄字幕與 SRT 必須使用同一份 timeline 計算結果。
```

## Prompt 3B｜剪輯器介面

```
開始 Phase 3B：
- 剪輯器頁面（左素材、中預覽、下時間軸、右字幕與輸出設定）
- 片段拖曳排序、單段／連續預覽、緩衝、切點、複製、刪除
- 裁切模式下預覽即時顯示裁切框
- 輸出管理頁：狀態、進度、下載 MP4／SRT、重新輸出、失敗重試
- E2E（Playwright）：建立專案 → 上傳 → 分析 → 選 3 句 → 輸出 → 下載檔案可被 FFprobe 讀取

完成標準：SPEC 第 10 節 Phase 3 驗收清單全部打勾。
```

---

## Prompt 4｜YouTube 與雲端

```
開始 Phase 4（SPEC 第 9 節與第 10 節 Phase 4）。重點：
- YouTube 網址解析純函式，測試案例完全照 docs/TEST_CASE_YOUTUBE.md 第 3 節
- YouTube Data API 取得公開資訊、IFrame Player 嵌入與 seekTo 跳轉
- 自己影片的字幕：OAuth ＋ captions API；其他影片：上傳字幕檔 → 純文字模式
- 純文字模式停用剪輯，後端拒絕渲染
- 使用者登入、資源歸屬檢查（A 不能存取 B 的資料，要有自動化測試）
- S3 相容儲存（StorageBackend 介面）、上傳續傳、用量統計頁

絕對不可以下載 YouTube 影片或音訊。如果目前環境連不到 YouTube 或 googleapis，請明確回報，不要用假資料。
```

---

## Prompt 5｜用指定 YouTube 影片實測＋製作操作說明（全部測試完成後）

```
所有自動化測試都已建立並通過後，請依 docs/TEST_CASE_YOUTUBE.md 執行實測：

1. 先問我：這部影片是不是我自己頻道的？（決定走路徑 A 還是只走路徑 B）
2. 逐步執行實測流程，結果寫入 docs/TEST_REPORT.md（通過／失敗／未執行＋原因）
3. 失敗的步驟先修正，再重跑該步驟
4. 用 Playwright 腳本實際操作並截圖，產出 docs/USER_GUIDE.md（繁體中文操作說明）
5. 新增 /help 頁面，內容同 USER_GUIDE，附「用範例影片試試看」按鈕（只預填網址，不自動分析）

截圖必須來自實際執行的系統。無法執行的步驟標示「截圖待補」並說明原因，不可偽造。
```

---

## Prompt 6｜進階（選做）

```
開始 Phase 5，請先列出你建議的優先順序與每項的預估難度，等我選擇後再實作：
畫面角色辨識建議、自動直式構圖、跨影片金句搜尋、播放清單／批量分析、字幕模板、成本報表。
```

---

## 常用輔助 Prompt

### 抓假實作（每個 Phase 結束時用）
```
請檢查整個專案是否有假實作：
1. 搜尋正式程式碼（排除 tests/）中的 mock、fake、dummy、placeholder、TODO、FIXME、Math.random、setTimeout、寫死的範例台詞
2. 列出每個前端按鈕對應的 API，以及該 API 是否真的有實作
3. 列出所有被 skip 的測試與原因
誠實列出結果，不要修改任何程式碼。
```

### 開新對話時接續進度
```
這是接續的開發工作。請先閱讀 CLAUDE.md、docs/SPEC.md、docs/PROGRESS.md，
執行 git log --oneline -20 與目前的測試，告訴我：目前完成到哪裡、測試狀態、下一步是什麼。先不要改程式。
```

### 回報錯誤
```
我實際操作時出現問題：
- 操作步驟：
- 預期結果：
- 實際結果：
- 錯誤訊息／截圖：
請先找出根本原因並說明，再修正，修正後加上能重現此問題的測試。
```
