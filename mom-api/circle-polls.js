/* 同週好孕圈: one light question a week for moms in the same circle (same due-date week, same birth month, or 備孕).
 * Experience questions only — nothing about symptoms that would need a doctor, nothing that could make anyone feel
 * judged. `range` is pregnancy weeks (kind 'preg') or baby age in months (kind 'baby'); `spot` links to the island
 * spot with the related, sourced knowledge. Everyone in a circle gets the same question in the same week. */
export const POLLS = [
  /* ---- 備孕 ---- */
  {
    id: 'prep-folic', kind: 'prep', q: '開始吃葉酸了嗎？', options: ['已經在吃', '準備開始', '還沒', '還在了解'], spot: 'folate',
  },
  {
    id: 'prep-check', kind: 'prep', q: '做孕前檢查了嗎？', options: ['做了', '預約了', '還沒', '不知道去哪做'], spot: 'precheck',
  },
  {
    id: 'prep-mood', kind: 'prep', q: '最近備孕的心情比較像？', options: ['很期待', '順其自然', '有點壓力', '有點焦慮'],
  },
  {
    id: 'prep-habit', kind: 'prep', q: '為了備孕，最近改變了什麼習慣？', options: ['早點睡', '多運動', '少喝咖啡／酒', '還沒開始'], spot: 'rhythm',
  },

  /* ---- 懷孕 ---- */
  {
    id: 'nausea', kind: 'preg', range: [4, 15], q: '這週害喜的程度？', options: ['幾乎沒有', '有點噁心', '常常想吐', '吐到不行'], spot: 'earlycare',
  },
  {
    id: 'tell', kind: 'preg', range: [4, 16], q: '已經跟身邊的人說懷孕了嗎？', options: ['還沒說', '只跟家人說', '好朋友也知道', '大家都知道了'],
  },
  {
    id: 'crave', kind: 'preg', range: [6, 30], q: '這週最想吃什麼？', options: ['酸的', '甜的', '鹹的', '什麼都不太想吃'], spot: 'market',
  },
  {
    id: 'sleep-early', kind: 'preg', range: [4, 27], q: '這週睡得好嗎？', options: ['很好', '還可以', '常醒來', '睡不太好'], spot: 'rhythm',
  },
  {
    id: 'kick-first', kind: 'preg', range: [16, 24], q: '感覺到胎動了嗎？', options: ['還沒有', '好像有', '很明顯', '常常在踢'], spot: 'kickpark',
  },
  {
    id: 'reveal', kind: 'preg', range: [14, 30], q: '知道寶寶的性別了嗎？', options: ['還不知道', '已經知道了', '想等出生再揭曉', '不太在意'],
  },
  {
    id: 'name', kind: 'preg', range: [18, 42], q: '想好寶寶的名字了嗎？', options: ['還沒', '有幾個候選', '小名想好了', '都想好了'],
  },
  {
    id: 'class', kind: 'preg', range: [18, 36], q: '有上媽媽教室或產前課程嗎？', options: ['已經上了', '打算要上', '還在考慮', '沒有打算'], spot: 'prenatal',
  },
  {
    id: 'move', kind: 'preg', range: [14, 36], q: '這週有活動身體嗎？', options: ['散步', '孕婦瑜伽', '游泳或其他', '這週比較懶'], spot: 'moveyoga',
  },
  {
    id: 'bag', kind: 'preg', range: [28, 42], q: '待產包準備好了嗎？', options: ['還沒開始', '準備一半', '快好了', '都準備好了'], spot: 'hospitalbag',
  },
  {
    id: 'look-forward', kind: 'preg', range: [28, 42], q: '現在最期待的是？', options: ['見到寶寶', '好好睡一覺', '吃想吃的東西', '身體輕鬆一點'],
  },
  {
    id: 'confinement', kind: 'preg', range: [24, 40], q: '坐月子打算怎麼安排？', options: ['月子中心', '在家請月嫂', '家人幫忙', '還在想'], spot: 'hotspring',
  },
  {
    id: 'night-up', kind: 'preg', range: [28, 42], q: '這週夜裡起床幾次？', options: ['0–1 次', '2–3 次', '4 次以上', '數不清了'], spot: 'rhythm',
  },
  {
    id: 'birth-plan', kind: 'preg', range: [30, 42], q: '生產時最希望誰陪在身邊？', options: ['另一半', '媽媽或家人', '都可以', '還沒想好'], spot: 'lighthouse',
  },

  /* ---- 寶寶 ---- */
  {
    id: 'nightfeed', kind: 'baby', range: [0, 3], q: '昨晚起來餵了幾次？', options: ['0–1 次', '2 次', '3 次', '4 次以上'], spot: 'cafe',
  },
  {
    id: 'busiest', kind: 'baby', range: [0, 3], q: '這週最常做的事？', options: ['餵奶', '哄睡', '換尿布', '抱著發呆'],
  },
  {
    id: 'helper', kind: 'baby', range: [0, 6], q: '這週誰最常幫忙？', options: ['另一半', '長輩', '月嫂或保母', '自己來'],
  },
  {
    id: 'me-time', kind: 'baby', range: [0, 12], q: '這週有屬於自己的時間嗎？', options: ['幾乎沒有', '偶爾半小時', '每天一點點', '還算充足'],
  },
  {
    id: 'longer-sleep', kind: 'baby', range: [2, 8], q: '寶寶晚上能睡長一點了嗎？', options: ['還常常醒', '偶爾睡長', '大多睡長', '一覺到天亮'], spot: 'sleepforest',
  },
  {
    id: 'roll', kind: 'baby', range: [3, 7], q: '寶寶會翻身了嗎？', options: ['還沒', '翻一邊', '兩邊都會', '翻來翻去停不下來'], spot: 'playland',
  },
  {
    id: 'outing', kind: 'baby', range: [2, 12], q: '這週帶寶寶出門幾次？', options: ['沒有', '1–2 次', '3–4 次', '幾乎每天'],
  },
  {
    id: 'solids', kind: 'baby', range: [5, 12], q: '副食品吃得怎麼樣？', options: ['還沒開始', '剛開始試', '吃得不錯', '挑食中'], spot: 'kitchen',
  },
  {
    id: 'favorite', kind: 'baby', range: [6, 12], q: '寶寶現在最愛？', options: ['翻身', '坐著玩', '爬來爬去', '扶著站'], spot: 'playland',
  },
  {
    id: 'teeth', kind: 'baby', range: [5, 15], q: '長牙了嗎？', options: ['還沒', '1–2 顆', '3–4 顆', '更多了'], spot: 'tooth',
  },
  {
    id: 'words', kind: 'baby', range: [10, 30], q: '寶寶會說的詞有幾個？', options: ['還沒有', '1–3 個', '4–10 個', '好多個'], spot: 'storyhouse',
  },
  {
    id: 'walk', kind: 'baby', range: [10, 20], q: '走路的情況？', options: ['還在扶走', '可以走幾步', '走得很穩', '到處跑'], spot: 'steps',
  },
  {
    id: 'play', kind: 'baby', range: [12, 84], q: '最近最愛的遊戲？', options: ['積木', '畫畫', '扮家家酒', '到戶外跑跳'], spot: 'outdoor',
  },
  {
    id: 'bedtime', kind: 'baby', range: [12, 84], q: '晚上大概幾點睡？', options: ['8 點前', '8–9 點', '9–10 點', '10 點以後'], spot: 'sleepforest',
  },
  {
    id: 'eat', kind: 'baby', range: [12, 84], q: '吃飯的情況？', options: ['自己吃得很好', '要人餵', '邊玩邊吃', '挑食中'], spot: 'table',
  },
  {
    id: 'feelings', kind: 'baby', range: [18, 84], q: '孩子鬧脾氣時，你最常怎麼做？', options: ['先抱抱', '等孩子冷靜', '轉移注意力', '還在找方法'], spot: 'feelings',
  },
];

// 這週的心情: a tally, so each mom sees she is not the only one who is tired
export const MOODS = ['good', 'tired', 'sick', 'worried', 'happy', 'busy'];
