// UI vocabulary for prompts, transcribed from the cheat sheets by Threads account @nexora_macauai
// (Nexora AI 研究室). The 「畫介面」 command asks the model to pick names from this list.

export const UI_COMPONENTS = [
  '按鈕 Button', '圖示按鈕 Icon Button', '標籤頁 Tabs', '錨點導航 Anchor Navigation', '麵包屑 Breadcrumb',
  '下拉選單 Dropdown Menu', '導航選單 Navigation Menu', '頁首列 Header', '分頁器 Pagination',
  '步驟條 Stepper', '輸入框 Text Input', '核取方塊 Checkbox', '單選按鈕 Radio Button', '滑塊 Slider',
  '下拉選擇 Select', '開關切換 Toggle Switch', '評分星級 Star Rating', '上傳區 Upload Dropzone',
];

export const UI_ELEMENTS = [
  '瀏覽器視窗', '音量愛心卡', '音樂播放卡', '麥克風搜尋列', '放大鏡搜尋列', '按鈕搜尋列', '豎向音量桿',
  '豎向通知桿', '飽和度橫桿', '愛心進度條', '波形進度條', '媒體控制列', '迷你播放列', '完整播放列',
  '播放進度條', '底部導航列', '狀態資訊列', '模式切換列', '直式工具列', '游標指標組', '選擇裁切組',
  '開關切換鈕', '分段控制列', '標籤頁列', '浮動操作鈕', '提示氣泡卡', '輸入欄位組',
];

// Both layout sheets combined; names that appear in both are listed once.
export const UI_LAYOUTS = [
  '雙欄佈局', '分屏佈局', '非對稱佈局', 'F形佈局', 'Z形佈局', '卡片區塊佈局', '特色圖像佈局', '瀑布流佈局',
  '雜誌式佈局', '固定導航佈局', '隱藏導航佈局', '互動式佈局', '網格佈局', '堆疊佈局', '標籤頁佈局',
  '卡片式佈局', '懸浮操作鈕佈局', '流式響應佈局', '全屏佈局', '疊加層佈局', '環形佈局', '畫布式佈局',
  '多面板佈局', '層級式佈局', '散落自由佈局', '無限滾動佈局', '功能區佈局', '時間軸佈局', '視差滾動佈局',
  '固定側欄佈局', '黏性頭尾佈局', '畫布外佈局', '封面流佈局', '步驟式佈局', '目錄式佈局', '空狀態佈局',
  '地圖式佈局', '對比佈局', '表單式佈局', '對話式佈局',
];

export const UI_HOVER_EFFECTS = [
  '懸浮抬起', '懸浮放大', '游標跟隨', '磁力吸附', '漣漪點擊', '底線顯現', '前後對比', '離開意圖', '打字機',
  '跑馬燈', '漸層流動', '漂浮元素', '按鈕擠壓', '旋轉微動', '模糊對焦', '描邊描繪', '工具提示', '圖片揭示',
];

export const UI_LANDING_CARDS = [
  '編號裝置展示', '抽象賣點卡', '弧形扇卡', '立體環視卡', '精選畫廊卡', '彩虹扇卡',
];

export const UI_NUMBER_MOTIONS = [
  '數值累加', '大數字彈出', '滾動計數器', '銷售跳字', '粉絲成長計數', '倒數計時', '連續日數', 'KPI數字卡',
  '百分比累加', '圓形進度', '橫向進度條', '直立量尺', '完成儀表', '前後百分比', '佔比分段條', '多項進度比較',
  '雙數對比', '升跌變化', '價格對比', '耗時對比', '分數對決', '長條對比', '前後數據差', '差額高亮',
  '前三名', '前五榜', '獎牌榜', '簡潔榜單', '記分板', '人氣氣泡', '名次變動', '冠軍大數字',
  '長條生長', '圓餅組裝', '折線描繪', '面積填色', '迷你儀表板', '統計卡組', '市場佔比條', '表格高亮格',
  '三步重點', '編號清單', '三點摘要', '四卡流程', '年份時間軸', '流程編號', '核對清單', '關鍵指標卡',
];

export const UI_GLOSSARY = [
  { title: 'UI 組件', names: UI_COMPONENTS },
  { title: 'UI 元素', names: UI_ELEMENTS },
  { title: '版面佈局', names: UI_LAYOUTS },
  { title: 'Hover 互動效果', names: UI_HOVER_EFFECTS },
  { title: '落地頁卡片', names: UI_LANDING_CARDS },
  { title: '數字動態效果', names: UI_NUMBER_MOTIONS },
];

/**
 * @returns {string} One line per group, e.g. "版面佈局：雙欄佈局、分屏佈局…"
 */
export const formatGlossary = () => UI_GLOSSARY
  .map(({ title, names }) => `${title}：${names.join('、')}`)
  .join('\n');
