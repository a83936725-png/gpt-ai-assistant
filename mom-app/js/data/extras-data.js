/* 生育力自我評估 & 補助福利清單 資料。一般衛教與公開政策整理，不含金額；以政府最新公告為準。 */
(function () {
  const App = window.App = window.App || {};

  // 生育力自我評估題目（女方＋伴侶）；不是診斷，只判斷「何時該找生殖醫學專科」
  const FERTILITY_Q = [
    { id: 'age', q: '你的年齡', type: 'num', min: 18, max: 55, unit: '歲' },
    { id: 'pAge', q: '伴侶年齡（選填）', type: 'num', min: 18, max: 70, unit: '歲', optional: true },
    { id: 'trying', q: '規律性生活、沒有避孕多久了？', type: 'one', options: [{ v: 0, l: '還沒開始' }, { v: 3, l: '6 個月內' }, { v: 9, l: '6–12 個月' }, { v: 13, l: '超過 12 個月' }] },
    { id: 'cycle', q: '月經週期', type: 'one', options: [{ v: 'regular', l: '規律（21–35 天）' }, { v: 'irregular', l: '不規律、常提早或延後很多' }, { v: 'absent', l: '超過 3 個月沒來' }] },
    { id: 'pain', q: '經痛會影響工作或生活嗎？', type: 'one', options: [{ v: 'no', l: '不會／輕微' }, { v: 'yes', l: '會，常需要請假或吃止痛藥' }] },
    { id: 'history', q: '曾經有過（可複選）', type: 'many', options: [{ v: 'pcos', l: '多囊性卵巢' }, { v: 'endo', l: '子宮內膜異位症' }, { v: 'pid', l: '骨盆腔發炎' }, { v: 'surgery', l: '卵巢或輸卵管手術' }, { v: 'thyroid', l: '甲狀腺疾病' }, { v: 'miscarriage', l: '流產 2 次以上' }, { v: 'chemo', l: '化療或放射治療' }] },
    { id: 'partner', q: '伴侶狀況（可複選）', type: 'many', options: [{ v: 'semen', l: '做過精液檢查' }, { v: 'abnormal', l: '精液檢查有異常' }, { v: 'pSmoke', l: '伴侶抽菸' }, { v: 'heat', l: '常泡溫泉／久坐／高溫工作' }] },
    { id: 'life', q: '生活習慣（可複選）', type: 'many', options: [{ v: 'smoke', l: '我有抽菸' }, { v: 'alcohol', l: '常喝酒' }, { v: 'stay', l: '常熬夜、壓力大' }, { v: 'folic', l: '每天吃葉酸' }] },
  ];

  // 補助福利清單（政策島）：stage = prep / preg / birth / baby
  const BENEFITS = [
    { id: 'pre-check', stage: 'prep', title: '孕前健康檢查（部分縣市補助）', desc: '目前沒有全國統一的補助；台北、台中、台南等部分縣市有孕前檢查補助，資格與期限請洽戶籍地衛生局。', where: '各縣市衛生局', url: 'https://mammy.hpa.gov.tw/Home/NewsKBContent?id=1914&type=01' },
    { id: 'ivf', stage: 'prep', title: '人工生殖（試管嬰兒）補助', desc: '符合資格的不孕夫妻可申請，需在補助機構療程。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=4878&pid=19565' },
    { id: 'prenatal', stage: 'preg', title: '產前檢查 14 次＋超音波 3 次', desc: '持《孕媽咪健康手冊》到產檢院所即可使用，不需另外申請。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=4878&amp=&pid=19370' },
    { id: 'screens', stage: 'preg', title: '妊娠糖尿病、貧血、乙型鏈球菌篩檢', desc: '公費產檢項目，依週數由醫師安排。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=4878&amp=&pid=19370' },
    { id: 'leave-check', stage: 'preg', title: '產檢假 7 天', desc: '受僱者懷孕期間可請產檢假，薪資照給。', where: '勞動部', url: 'https://www.mol.gov.tw/1607/1632/1633/55496/post' },
    { id: 'leave-partner', stage: 'preg', title: '陪產檢及陪產假 7 天', desc: '配偶可在懷孕期間陪產檢，或分娩前後請陪產假。', where: '勞動部', url: 'https://www.mol.gov.tw/1607/1632/1633/55496/post' },
    { id: 'maternity', stage: 'birth', title: '產假 8 週', desc: '分娩前後休產假；工資規定依勞基法。', where: '勞動部', url: 'https://eeweb.mol.gov.tw/front/277' },
    { id: 'birth-pay', stage: 'birth', title: '生育給付＋補助，每胎合計 10 萬', desc: '2026 年 1 月 1 日起出生的寶寶，不論媽媽有沒有參加勞保、國保、農保，生育給付加政府補助每胎合計 10 萬元（雙胞胎 20 萬），以勞保局公告為準。', where: '勞動部勞工保險局', url: 'https://www.bli.gov.tw/0017641.html' },
    { id: 'city-bonus', stage: 'birth', title: '縣市生育津貼／獎勵', desc: '各縣市標準不同，通常在戶籍地辦出生登記時一併申請。', where: '戶籍地區公所／縣市政府' },
    { id: 'register', stage: 'birth', title: '出生登記（60 日內）', desc: '帶出生證明、父母身分證、戶口名簿到戶政事務所。', where: '戶政事務所', url: 'https://www.ris.gov.tw/documents/html/2/3/1/379.html' },
    { id: 'nhi', stage: 'birth', title: '新生兒健保加保', desc: '完成出生登記後辦理依附投保。', where: '衛生福利部中央健康保險署', url: 'https://www.nhi.gov.tw/ch/cp-4963-899d7-2669-1.html' },
    { id: 'parental', stage: 'baby', title: '育嬰留職停薪＋津貼', desc: '子女滿 3 歲前可申請；津貼由就業保險給付，條件依公告。', where: '勞動部勞工保險局', url: 'https://www.bli.gov.tw/0020785.html' },
    { id: 'raise', stage: 'baby', title: '0–6 歲國家一起養（育兒津貼、托育補助）', desc: '依照顧方式申請育兒津貼或托育補助，條件依公告。', where: '衛生福利部社會及家庭署', url: 'https://www.sfaa.gov.tw/SFAA/Pages/VDetail.aspx?nodeid=1057&pid=10779' },
    { id: 'child-check', stage: 'baby', title: '兒童預防保健 9 次＋公費疫苗', desc: '2026 年 7 月起預防保健由 7 次增為 9 次。持《兒童健康手冊》和健保卡到合約院所即可。', where: '國民健康署／疾病管制署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=5020&pid=19967' },
    { id: 'dev-screen', stage: 'baby', title: '兒童發展篩檢 6 次', desc: '2024 年 7 月起，未滿 7 歲兒童有 6 次公費發展篩檢（6–10 個月、10 個月–1 歲半、1 歲半–2 歲、2–3 歲、3–5 歲、5–7 歲），可和預防保健一起做。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/List.aspx?nodeid=4824' },
    { id: 'pp-care', stage: 'birth', title: '產後健康照護服務', desc: '產後媽媽有公費的產後健康照護（身心評估與衛教），次數與時間以國健署公告為準。', where: '國民健康署', url: 'https://mammy.hpa.gov.tw/Home/NewsKBContent?id=3644&type=01' },
    { id: 'fluoride', stage: 'baby', title: '兒童牙齒塗氟', desc: '未滿 6 歲兒童每半年可到牙科塗氟一次，次數依公告。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=1098&pid=6455' },
  ];

  App.EXTRAS = { FERTILITY_Q, BENEFITS };
}());
