/* 外出好幫手資料：外出時間選項、依月齡的一般參考值（沒有足夠紀錄時才用）、外部連結。
 * 月齡參考值是常見育兒衛教的大約數字，只用來「估算要帶多少」，不是餵養或醫療建議。
 * 這裡不放任何真實活動或場館資料：活動由媽媽自己存，找活動一律連到外部網站。 */
(function () {
  const App = window.App = window.App || {};

  // 外出時間（hours；'night' = 過夜，以「晚數 × 24 小時」估算）
  const DURATIONS = [
    { value: 1, label: '1 小時' },
    { value: 2, label: '2 小時' },
    { value: 4, label: '4 小時' },
    { value: 6, label: '6 小時' },
    { value: 8, label: '8 小時' },
    { value: 'night', label: '過夜' },
  ];

  // 依月齡的一般參考（maxMonths 以下適用）
  // diaperGapH：大約多久換一次尿布；feedMl：一次瓶餵大約奶量；foodPerDay：一天副食品／點心餐數
  const BY_AGE = [
    { maxMonths: 1, diaperGapH: 2, feedMl: 80, foodPerDay: 0 },
    { maxMonths: 3, diaperGapH: 2.5, feedMl: 120, foodPerDay: 0 },
    { maxMonths: 6, diaperGapH: 3, feedMl: 150, foodPerDay: 0 },
    { maxMonths: 9, diaperGapH: 3.5, feedMl: 180, foodPerDay: 2 },
    { maxMonths: 12, diaperGapH: 3.5, feedMl: 200, foodPerDay: 3 },
    { maxMonths: 24, diaperGapH: 4, feedMl: 200, foodPerDay: 4 },
    { maxMonths: 999, diaperGapH: 4, feedMl: 200, foodPerDay: 5 },
  ];
  const byAge = (months) => BY_AGE.find((r) => months < r.maxMonths) || BY_AGE[BY_AGE.length - 1];

  // 清單分組（順序即顯示順序）
  const GROUPS = [
    { id: 'diaper', label: '換尿布', icon: '🧷' },
    { id: 'feed', label: '餵食', icon: '🍼' },
    { id: 'food', label: '副食品', icon: '🥣' },
    { id: 'clothes', label: '衣物', icon: '👕' },
    { id: 'weather', label: '天氣', icon: '🌤️' },
    { id: 'health', label: '證件與健康', icon: '🩺' },
    { id: 'move', label: '移動', icon: '🚗' },
    { id: 'night', label: '過夜', icon: '🌙' },
    { id: 'other', label: '安撫與其他', icon: '🧸' },
    { id: 'custom', label: '我自己加的', icon: '✏️' },
  ];

  // 適合年齡選單（月）
  const AGE_OPTIONS = [
    { value: '', label: '不限' },
    { value: 0, label: '0 個月' },
    { value: 6, label: '6 個月' },
    { value: 12, label: '1 歲' },
    { value: 18, label: '1 歲半' },
    { value: 24, label: '2 歲' },
    { value: 36, label: '3 歲' },
    { value: 48, label: '4 歲' },
    { value: 72, label: '6 歲' },
    { value: 144, label: '12 歲' },
  ];

  // 找活動與設施：只放外部連結（另開新分頁），不抓取、不轉載任何內容
  const mapsSearch = (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}`;
  const LINKS = [
    {
      id: 'hhz', icon: '🗓️', title: 'HHZ.TW 好好找', url: 'https://hhz.tw',
      desc: '全台親子活動總整理：可依縣市、年齡、日期、室內、免費篩選。看到想去的，複製連結回來存成「週末計畫」。',
    },
    { id: 'nursing', icon: '🤱', title: '附近的哺乳室', url: mapsSearch('哺乳室'), desc: 'Google 地圖搜尋，出門前先看好換尿布、餵奶的地方' },
    { id: 'center', icon: '🧸', title: '附近的親子館', url: mapsSearch('親子館'), desc: 'Google 地圖搜尋，開放時間與預約方式請以官方公告為準' },
    { id: 'playground', icon: '🛝', title: '附近的共融遊戲場', url: mapsSearch('共融遊戲場'), desc: 'Google 地圖搜尋，戶外玩耍好去處' },
    { id: 'clinic', icon: '🩺', title: '附近的兒科診所', url: mapsSearch('兒科診所'), desc: 'Google 地圖搜尋，外出時寶寶不舒服可以先查' },
    { id: 'pharmacy', icon: '💊', title: '附近的藥局', url: mapsSearch('藥局'), desc: 'Google 地圖搜尋，臨時補尿布、退燒用品' },
  ];

  App.OUTING = { DURATIONS, BY_AGE, byAge, GROUPS, AGE_OPTIONS, LINKS, mapsSearch };
}());
