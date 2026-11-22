/* 品牌設定 — 改這裡就能換名字、LOGO、連結，不用動程式。
 * 換成正式 LOGO：把原始圖檔放到 assets/logo.png，然後把 logo 改成 'assets/logo.png'。 */
window.BRAND = {
  appName: '易家做媽媽',
  brandName: '易家滴雞精',
  tagline: '易家滴雞精・陪你從備孕到育兒',
  logo: 'assets/logo.svg', // 只有圖形的 LOGO（方形）
  logoFull: 'assets/logo-full.svg', // 圖形 + 字（啟動畫面、品牌頁、報告用）
  // 以下連結請換成你們自己的（留空就不顯示按鈕）
  shopUrl: '', // 官網 / 購物頁，例如 https://www.example.com
  lineOaUrl: '', // LINE 官方帳號加好友連結，例如 https://lin.ee/xxxxxx
  phone: '',
  // 分享與邀請：正式網址（部署後填，例如 https://mom.example.com/）；留空就用目前網址
  appUrl: '',
  // 雙向邀請禮：朋友用你的連結或邀請碼加入、完成設定並註冊會員時，兩邊各得的好孕點數（friend 見面禮、inviter 每位朋友）
  inviteGift: { friend: 30, inviter: 50 },
  // 新手任務：剛開始用的 3 週（或剛註冊的 1 週）首頁的 5 件小事，每件 points 點，全部做完再 bonus 點
  starter: { points: 5, bonus: 15 },
  // 分享獎勵：好孕點數達到 points 時顯示的優惠（code 留空 = 先不提供）
  shareReward: { points: 100, title: '易家滴雞精會員好禮', code: '', note: '請到官網結帳時輸入優惠碼，或出示給門市人員。' },
  // 即時人數：數字達到門檻才顯示（數字永遠是真實的，只是太小時先不顯示）
  liveStats: { showOnlineFrom: 1, showRegisteredFrom: 1 },
  // 團購「正在開團」的參加人數：真實的總數，達到這個人數才顯示（太少時先不顯示）
  groupbuyStatsFrom: 3,
  // 網頁預覽：網站沒有會員伺服器時（例如預覽版），一打開就顯示 3 個標「範例」的限時團購，可以試開團、跟團。
  // 接上會員伺服器後只會顯示真的團購（這裡不用改）；伺服器暫時連不上時也不會顯示範例。
  groupbuyPreview: true,
  // 開團時「公開這一團」預設要不要勾（公開的團會出現在「正在開團」，其他媽媽可以直接跟團；開團的人可以隨時取消公開）
  groupbuyPublicDefault: true,
  // 常見好物：品牌自家商品放在「產後媽媽」分類並標示「品牌」；show: false 可隱藏
  goodsBrandItem: { show: true, when: '孕期、坐月子' },
  // 分享文案的 hashtag
  hashtags: ['易家做媽媽', '易家滴雞精', '好孕島'],
  // 品牌介紹（品牌頁顯示，可自行改寫）
  story: '易家滴雞精，用一滴一滴的耐心，陪伴每一位媽媽走過備孕、懷孕、坐月子到育兒的每一天。',
  // 隱私權政策（個資法第 8 條告知事項）——上線前請填好，並請法務確認政策內容（App 內「我的 → 隱私權政策與使用條款」）
  privacy: {
    company: '', // 營運公司全名，例如「〇〇股份有限公司」；留空時顯示品牌名稱
    contact: '', // 個資窗口：Email 或電話，例如 privacy@example.com；留空時請至品牌頁的聯絡方式
    region: '', // 會員資料存放與處理的地區，例如「美國（Vercel、Upstash 的資料中心與寄驗證碼的 Resend／Twilio）」
    processors: 'Vercel（網站主機）、Upstash／Vercel KV（會員資料庫）、寄送驗證碼的 Email／簡訊服務商', // 受託處理會員資料的服務商（寄驗證碼請寫實際使用的，例如 Resend、Twilio）
  },
};
