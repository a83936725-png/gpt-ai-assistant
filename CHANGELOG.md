# Changelog

## 4.22.0 (2026-11-24)

### New Features

- Instagram comment-to-DM auto reply, a free replacement for ManyChat: a keyword comment on a Reel or post gets a public reply and a DM with a button; tapping it sends the link, or first asks the person to follow when the rule requires it. Rules live in `instagram/rules.js`, with a test list and an on/off switch
- `/instagram/status` setup checklist, plus the privacy policy and data deletion pages Meta needs before the app can go live
- A daily Vercel Cron checks the Instagram token, extends it every 7 days (kept in private Blob storage) and sends a LINE alert when something breaks; `INSTAGRAM_DAILY_REPORT=true` sends a nightly report too. See the [guide (中文)](docs/INSTAGRAM-AUTOREPLY.zh-TW.md)

## 4.21.0 (2026-11-22)

### New Features

- IKIGAI: the admin page has a "寄信設定" panel: paste a Gmail address and app password, the server logs in to check it, saves it in private storage and starts emailing reports at once, without editing Vercel or redeploying. A test email can be sent from the same panel. The password is never sent back to the browser

## 4.20.0 (2026-11-22)

### New Features

- IKIGAI: exactly three suggested careers, each with a match score, why it fits, the skills it needs (with the ones the visitor already has ticked), what to build and how, and advice for the circles it does not cover yet
- IKIGAI: a more detailed plan: checkpoints and weekly time for each of the three stages, and a 12-week action table in two-week blocks; all of it is in the PDF and the emailed report

### Improvements

- IKIGAI: the AI analysis and AI plan buttons only show while `IKIGAI_AI_ENABLED` is on, so visitors never see an error when the OpenAI quota runs out

## 4.19.0 (2026-11-22)

### New Features

- IKIGAI: ability analysis and rankings on the result page, share page, PDF and emailed report: an IKIGAI fit index (0–100), a ranking of nine abilities, career match percentages, circle strengths, top three strengths, abilities to develop, core assets and skill priorities
- IKIGAI: a three-stage career roadmap (0–3 months, 3–12 months, 1–3 years) with weekly habits and a risk reminder; its steps can be added to the action list
- IKIGAI: a new "ability ranking" share card (7 cards in total)
- IKIGAI: the admin list and CSV show each client's fit index and top strengths

### Improvements

- IKIGAI: circle names and counts are drawn inside their circles in every diagram and card, sized to fit each circle

## 4.18.0 (2026-11-22)

### New Features

- IKIGAI: the details form now asks for name and email (phone/LINE optional), and the full report is emailed to the visitor: type, circles, overlaps, careers, skills, 90-day preparation for the top three careers, plan and analysis, with a referral link. Visitors can resend it; at most once per 10 minutes. Sends through Gmail/SMTP (`IKIGAI_SMTP_USER`, `IKIGAI_SMTP_PASS`) or Resend (`RESEND_API_KEY`, `IKIGAI_MAIL_FROM`)
- IKIGAI: the admin page shows whether and when each client's report was emailed

## 4.17.0 (2026-11-22)

### New Features

- IKIGAI: referral rewards. Clients see their invite progress; once enough friends finish (`IKIGAI_REFERRAL_GOAL`, default 3) they unlock a gold limited-edition card style and a full report with preparation plans for their top three careers (`IKIGAI_REFERRAL_REWARD` sets the wording). `GET /ikigai/referrals/:rid` returns the count
- IKIGAI: referral leaderboard in the admin page

## 4.16.0 (2026-11-22)

### New Features

- IKIGAI: personality type from the four circles (nine types with a tagline, strengths and advice)
- IKIGAI: six share cards (type, map, talents and careers, 30-day challenge, overlaps, plan) in three styles (晨光, 夜空, 和紙) and two sizes (post 4:5, story 9:16), each with a QR code; download one or all, or share on phones
- IKIGAI: referral tracking. Invite links, card QR codes and share pages carry the client's code; new visitors are credited to whoever brought them, shown in the admin list, detail view, stats and CSV
- IKIGAI: 「邀請朋友一起測」 with a ready-made invitation message

## 4.15.0 (2026-11-22)

### New Features

- IKIGAI: visitors leave a name and a phone/LINE ID or email, and agree to share, before the results. Their answers, career suggestions, plan, analysis and an activity log are saved to a private Vercel Blob store (`IKIGAI_BLOB_READ_WRITE_TOKEN`)
- IKIGAI: admin page at `/ikigai/admin` (password `IKIGAI_ADMIN_PASSWORD`) with stats, search, each client's full record and activity log, CSV export for Excel, and delete

## 4.14.0 (2026-11-22)

### New Features

- IKIGAI: career suggestions on the result page, PDF report, copied text and share view, built in without AI: up to six careers with the circles they cover, three paths (stable, passion, side project), skills to strengthen, the weakest circle, and a 1-month to 12-month plan. Careers can be added to the career plan and the plan steps to the action list
- IKIGAI: 深度解析 now also covers suggested careers, skills to strengthen and a staged career plan; `IKIGAI_MAX_TOKENS` defaults to 1800

## 4.13.1 (2026-11-21)

### Changes

- IKIGAI: the site root shows the IKIGAI page to browsers (other clients still get the JSON status), so the address can be just a domain
- IKIGAI: visitors no longer see AI or vendor wording. The buttons are now 「深度解析」 and 「產生建議計畫」, the copy-prompt buttons are removed, and failures show a plain message with a short code (see the troubleshooting table in [docs/IKIGAI-WEB.zh-TW.md](docs/IKIGAI-WEB.zh-TW.md))

## 4.13.0 (2026-11-21)

### New Features

- IKIGAI: redesigned page. Adds a welcome screen with a sample, a progress bar that marks finished steps, step transitions, a sticky bottom bar (and arrow keys), prompt questions on each step, undo after removing an item, colour toggle buttons in the match step, result counts with a next-step tip, an animated diagram, AI loading progress, and "copy prompt" to use any AI assistant when the AI analysis is unavailable
- IKIGAI: each circle is sized by how many items it holds, with a proportion legend
- IKIGAI: step 7 career plan: up to three directions scored against the four circles (fit out of 20), 30-day / 90-day / 1-year goals, and an action checklist with progress; `POST /ikigai/plan` fills goals and actions with AI
- IKIGAI: share and export: 1080 × 1350 share cards (PNG, download or share), a read-only share link that keeps the data in the URL, and an A4 PDF report through the print dialog
- IKIGAI: demo of the whole flow in [docs/IKIGAI-WEB.zh-TW.md](docs/IKIGAI-WEB.zh-TW.md)

## 4.12.1 (2026-11-20)

### Bug Fixes

- IKIGAI: show why AI analysis failed (invalid key, quota, unknown model, timeout, ...) instead of a generic error, without exposing the provider's raw message. See the troubleshooting table in [docs/IKIGAI-WEB.zh-TW.md](docs/IKIGAI-WEB.zh-TW.md)
- IKIGAI: wait up to `IKIGAI_TIMEOUT` (default 50 seconds) for the AI reply, so a short `APP_API_TIMEOUT`/`OPENAI_TIMEOUT` no longer cuts off the longer IKIGAI answer
- IKIGAI: incomplete forms no longer count toward the hourly limit

## 4.12.0 (2026-11-20)

See [docs/IKIGAI-WEB.zh-TW.md](docs/IKIGAI-WEB.zh-TW.md) for how to use it.

### New Features

- Add the IKIGAI web page at `/ikigai`: four circles (love, good at, world needs, paid for), a match table, a clickable Venn diagram, and copy/export/import/print. Progress is kept in the browser
- Add `POST /ikigai/analyze`: an AI reading of the four lists in Traditional Chinese, with input limits, optional moderation and a per-IP hourly limit
- New settings: `IKIGAI_ENABLED`, `IKIGAI_AI_ENABLED`, `IKIGAI_MAX_TOKENS`, `IKIGAI_RATE_LIMIT`

## 4.11.0 (2026-11-15)

### New Features

- Add `畫圖示` (`/icon`): generates an SVG icon from a description and replies with a download link
- Add `畫動畫` (`/anim`): generates a GIF animation and replies with a download link
- Add `數據卡` (`/kpi`): turns typed numbers into a KPI Flex card (big number + coloured delta) via `createKpiBubble()`
- Image generation now supports `svg` and `gif` output formats (`output_format`, GIF frame count/duration); hosted files keep their real content type

## 4.10.0 (2026-11-14)

See [docs/UPGRADE-2026.zh-TW.md](docs/UPGRADE-2026.zh-TW.md) for setup.

### New Features

- Add `畫介面` (`/ui`): turns a short request into a UI prompt using a glossary of 157 component, layout and motion names
- Add `寫貼文` (`/post`): writes a Threads or Instagram post from a topic or the recent chat
- Add `模型檢查` (`/models`): shows each configured model's announced shutdown date from OpenAI
- Add `我的ID` (`/id`) and an allowlist (`APP_ALLOWED_USER_IDS`, `APP_ALLOWED_GROUP_IDS`)
- Optional moderation of incoming text and images with `omni-moderation-latest` (`OPENAI_MODERATION_ENABLED`)
- Support Flex Messages with `createCardBubble()` and `context.pushFlex()`
- Run chat on another OpenAI-compatible provider with `OPENAI_COMPLETION_BASE_URL` and `OPENAI_COMPLETION_API_KEY`
- Raise the default reply limit from 64 to 500 tokens and Vercel `maxDuration` to 60 seconds
- Run lint and tests on every pull request with GitHub Actions
- Use Node 22 in Docker

### Bug Fixes

- Replace models that OpenAI shut down: chat `gpt-3.5-turbo` → `gpt-6-luna`, image `dall-e-2` → `gpt-image-2.6-flare`, vision `gpt-4o` → `gpt-6-luna`, transcription `whisper-1` → `gpt-transcribe`
- Send `max_completion_tokens` and `reasoning_effort` to OpenAI, and only send penalties when set
- Host generated images on Vercel Blob or the bot's own `/images` route, since GPT Image models return base64
- Fix production dependency vulnerabilities (`axios`, `express`, `form-data`, `zod` override)
- `回報` links to `APP_REPORT_URL` (this fork's issues by default) instead of the original project
- `版本` checks this fork and compares version numbers, so a newer local version no longer asks to update
- Skip the version test when GitHub can't be reached

## 4.9.1 (2024-07-10)

### Bug Fixes

- Update `talk` command

## 4.9.0 (2024-07-10)

### New Features

- Support `gpt-4o` model

## 4.8.4 (2024-07-06)

### Bug Fixes

- Update status page

## 4.8.3 (2024-02-03)

### Bug Fixes

- Fix `maxDuration` for `vercel.json`

## 4.8.2 (2024-02-03)

### Bug Fixes

- Use `gl` param for SerpApi
- Remove `SERPAPI_LANG` environment variable

## 4.8.1 (2024-02-03)

### Bug Fixes

- Add `maxDuration` for `vercel.json`

## 4.8.0 (2023-12-07)

### New Features

- Support fine-tuned models

## 4.7.6 (2023-11-18)

### Bug Fixes

- Change default max groups to 1000
- Change default max users to 1000
- Change default max prompt messages to 4
- Change default max prompt tokens to 160
- Change default completion temperature to 1
- Change default completion max tokens to 64

## 4.7.5 (2023-10-01)

### Bug Fixes

- Update status page

## 4.7.4 (2023-08-26)

### Bug Fixes

- Update status page

## 4.7.3 (2023-08-25)

### Bug Fixes

- Fix commands

## 4.7.2 (2023-08-05)

### Bug Fixes

- Fix `translate` command

## 4.7.1 (2023-08-01)

### Bug Fixes

- Optimize `search` command
- Add aliases for commands

## 4.7.0 (2023-06-08)

### New Features

- Add `OPENAI_COMPLETION_STOP_SEQUENCES` environment variable

## 4.6.0 (2023-05-03)

### New Features

- Support `gpt-4` model

## 4.5.0 (2023-04-27)

### New Features

- Support `zh_CN` locale

## 4.4.4 (2023-03-21)

### Bug Fixes

- Fix default value of `APP_MAX_GROUPS` environment variable
- Fix default value of `APP_MAX_USERS` environment variable

## 4.4.3 (2023-03-11)

### Bug Fixes

- Fix wording of `doc` and `report` commands

## 4.4.2 (2023-03-11)

### Bug Fixes

- Add `ERROR_MESSAGE_DISABLED` environment variable
- Deprecate `ERROR_TIMEOUT_DISABLED` environment variable

## 4.4.1 (2023-03-10)

### Bug Fixes

- Add default max prompt tokens for chat completion api

## 4.4.0 (2023-03-08)

### New Features

- Support snapshots of `gpt-3.5-turbo` model

## 4.3.0 (2023-03-08)

### New Features

- Add `VERCEL_TEAM_ID` environment variable

## 4.2.2 (2023-03-08)

### Bug Fixes

- Optimize error handling

## 4.2.1 (2023-03-07)

### Bug Fixes

- Fix `add-mark` util

## 4.2.0 (2023-03-05)

### New Features

- Add `APP_INIT_PROMPT` environment variable

## 4.1.3 (2023-03-05)

### Bug Fixes

- Fix `add-mark` util

## 4.1.2 (2023-03-05)

### Bug Fixes

- Update `add-mark` util

## 4.1.1 (2023-03-05)

### Bug Fixes

- End text with dot

## 4.1.0 (2023-03-05)

- Support `whisper-1` model
- Add `opencc` text converter
- Store display name and group name to storage

## 4.0.4 (2023-03-03)

### Bug Fixes

- Optimize `search` command

## 4.0.3 (2023-03-03)

### Bug Fixes

- Optimize `search` and `draw` commands

## 4.0.2 (2023-03-02)

### Bug Fixes

- Fix prompt messages

## 4.0.1 (2023-03-02)

### Bug Fixes

- Fix `enquire` command

## 4.0.0 (2023-03-02)

### New Features

- Support `gpt-3.5-turbo` model

### Bug Fixes

- Rename `APP_MAX_PROMPT_SENTENCES` environment variable to `APP_MAX_PROMPT_MESSAGES`

## 3.7.0 (2023-02-26)

### New Features

- Add demo for `search` command
- Add `SERPAPI_LOCATION` environment variable
- Add `SERPAPI_LANG` environment variable

## 3.6.0 (2023-02-26)

### New Features

- Add `APP_API_TIMEOUT` environment variable
- Add `APP_MAX_PROMPT_SENTENCES` environment variable
- Add `APP_MAX_PROMPT_TOKENS` environment variable

## 3.5.0 (2023-02-26)

### New Features

- Rename `HUMAN_BACKGROUND` environment variable to `HUMAN_INIT_PROMPT`
- Rename `BOT_BACKGROUND` environment variable to `BOT_INIT_PROMPT`

## 3.4.1 (2023-02-25)

### Bug Fixes

- Fix default bot name

## 3.4.0 (2023-02-24)

### New Features

- Add `info` endpoint

## 3.3.5 (2023-02-24)

### Bug Fixes

- Fix prompt wording

## 3.3.4 (2023-02-24)

### Bug Fixes

- Fix prompt wording

## 3.3.3 (2023-02-24)

### Bug Fixes

- Fix tests

## 3.3.2 (2023-02-23)

### Bug Fixes

- Fix prompt wording

## 3.3.1 (2023-02-23)

### Bug Fixes

- Fix prompt wording

## 3.3.0 (2023-02-23)

### New Features

- Add `BOT_TONE` environment variable

## 3.2.1 (2023-02-22)

### Bug Fixes

- Fix timeout wording

## 3.2.0 (2023-02-22)

### New Features

- Add `HUMAN_NAME` environment variable
- Add `HUMAN_BACKGROUND` environment variable
- Add `BOT_BACKGROUND` environment variable

## 3.1.0 (2023-02-21)

### New Features

- Implement `forget` command

## 3.0.0 (2023-02-18)

### New Features

- Implement `search` command

## 2.5.1 (2023-02-18)

### New Features

- Rename `BOT_TIMEOUT_DISABLED` environment variable to `ERROR_TIMEOUT_DISABLED`

## 2.5.0 (2023-02-18)

### New Features

- Add `BOT_TIMEOUT_DISABLED` environment variable

## 2.4.0 (2023-02-17)

### New Features

- Add `BOT_DEACTIVATED` environment variable

## 2.3.0 (2023-02-11)

### New Features

- Add `VERCEL_TIMEOUT` environment variable
- Add `OPENAI_TIMEOUT` environment variable
- Add `LINE_TIMEOUT` environment variable

## 2.2.0 (2023-02-04)

### New Features

- Implement `retry` command

## 2.1.4 (2023-01-15)

### Bug Fixes

- Ignore non-text message events

## 2.1.3 (2023-01-15)

### Bug Fixes

- Add command aliases

## 2.1.2 (2023-01-15)

### Bug Fixes

- Add command aliases

## 2.1.1 (2023-01-14)

### Bug Fixes

- Fix `enquire` command

## 2.1.0 (2023-01-11)

### New Features

- Add `VERCEL_PROJECT_NAME` environment variable

## 2.0.1 (2023-01-11)

### Bug Fixes

- Add logs for webhook endpoint

## 2.0.0 (2023-01-10)

### New Features

- Implement `sum` command
- Implement `analyze` command
- Implement `translate` command
- Add `BOT_NAME` environment variable
- Add `APP_MAX_GROUPS` environment variable
- Add `APP_MAX_USERS` environment variable

### Bug Fixes

- Remove `SETTING_AI_NAME` environment variable
- Remove `SETTING_AI_ACTIVATED` environment variable
- Refactor `storage` module
- Refactor `prompt` module
- Refactor `history` module

## 1.12.4 (2022-12-31)

### Bug Fixes

- Rename `chat` command to `talk`

## 1.12.3 (2022-12-31)

### Bug Fixes

- Update command template

## 1.12.2 (2022-12-30)

### Bug Fixes

- Fix summarize request wording

## 1.12.1 (2022-12-30)

### Bug Fixes

- Handle non-text messages

## 1.12.0 (2022-12-30)

### New Features

- Implement `summarize` command

## 1.11.3 (2022-12-29)

### Bug Fixes

- Add command aliases

## 1.11.2 (2022-12-26)

### Bug Fixes

- Handle error messages in every commands

## 1.11.1 (2022-12-26)

### Bug Fixes

- Trim AI Name when sending prompt

## 1.11.0 (2022-12-26)

### New Features

- Implement `call` command
- Add `SETTING_AI_NAME` environment variable
- Add `SETTING_AI_ACTIVATED` environment variable

### Bug Fixes

- Remove `APP_STORAGE` environment variable

## 1.10.2 (2022-12-25)

### Bug Fixes

- Rename methods

## 1.10.1 (2022-12-25)

### Bug Fixes

- Fix wording of commands

## 1.10.0 (2022-12-25)

### New Features

- Add `OPENAI_IMAGE_GENERATION_SIZE` environment variable

### Bug Fixes

- Remove `SETTING_IMAGE_GENERATION_SIZE` setting

## 1.9.1 (2022-12-24)

### Bug Fixes

- Rename functions and variables

## 1.9.0 (2022-12-24)

### New Features

- Implement dynamic configuration
- Implement `configure` command
- Add `SETTING_IMAGE_GENERATION_SIZE` setting

## 1.8.0 (2022-12-24)

### New Features

- Implement `doc` command

### Bug Fixes

- Rename `settings` command to `command`

## 1.7.1 (2022-12-23)

### Bug Fixes

- Fix wording of commands

## 1.7.0 (2022-12-23)

### New Features

- Implement localization
- Implement command aliases

### Bug Fixes

- Rename `OPENAI_COMPLETION_INIT_LANG` environment variable to `APP_LANG`

## 1.6.0 (2022-12-23)

### New Features

- Implement `settings` command

### Bug Fixes

- Rename `chat --auto-reply off` command to `deactivate`
- Rename `chat --auto-reply on` command to `activate`
- Rename `CHAT_AUTO_REPLY` setting to `AI_ACTIVATED`

## 1.5.0 (2022-12-22)

### New Features

- Implement `continue` command with quick reply feature

### Bug Fixes

- Change default max completion tokens to 160
- Change default max prompt messages to 16

## 1.4.6 (2022-12-20)

### Bug Fixes

- Add comments

## 1.4.5 (2022-12-19)

### Bug Fixes

- Add `ja` initial language
- Add `ai` alias for `chat` command

## 1.4.4 (2022-12-18)

### Bug Fixes

- Rename `AI_AUTO_REPLY` setting to `CHAT_AUTO_REPLY`
- Fix case sensitivity of command issues

## 1.4.3 (2022-12-18)

### Bug Fixes

- Rename `ai` command to `chat`
- Rename `ai --auto-reply off` command to `chat --auto-reply off`
- Rename `ai --auto-reply on` command to `chat --auto-reply on`
- Rename `image` command to `draw`

## 1.4.2 (2022-12-18)

### Bug Fixes

- Refactor commands

## 1.4.1 (2022-12-18)

### Bug Fixes

- Refactor tests

## 1.4.0 (2022-12-18)

### New Features

- Implement `image` command

## 1.3.1 (2022-12-18)

### Bug Fixes

- Rename `VERCEL_WEBHOOK_URL` environment variable to `VERCEL_DEPLOY_HOOK_URL`

## 1.3.0 (2022-12-18)

### New Features

- Implement custom webhook path
- Add `APP_WEBHOOK_PATH` environment variable

## 1.2.1 (2022-12-18)

### Bug Fixes

- Refactor main functions

## 1.2.0 (2022-12-17)

### New Features

- Implement `deploy` command
- Add `VERCEL_WEBHOOK_URL` environment variable

## 1.1.3 (2022-12-17)

### Bug Fixes

- Fix storage module
- Fix `ai --auto-reply off` command
- Fix `ai --auto-reply on` command

## 1.1.2 (2022-12-16)

### Bug Fixes

- Refactor utility functions

## 1.1.1 (2022-12-16)

### Bug Fixes

- Rename `VERCEL_API_KEY` environment variable to `VERCEL_ACCESS_TOKEN`
- Rename `LINE_API_KEY` environment variable to `LINE_CHANNEL_ACCESS_TOKEN`
- Rename `LINE_API_SECRET` environment variable to `LINE_CHANNEL_SECRET`

## 1.1.0 (2022-12-16)

### New Features

- Implement `version` command
- Implement `ai` command
- Implement `ai --auto-reply off` command
- Implement `ai --auto-reply on` command
- Add Vercel API module
- Add `VERCEL_API_KEY` environment variable
- Add `LINE_API_SECRET` environment variable

### Bug Fixes

- Fix timeout issues

## 1.0.0 (2022-12-11)

### New Features

- Implement chat feature
- Add OpenAI API module
- Add LINE API module
