/* 生育力自我評估 & 補助福利清單 資料。一般衛教與公開政策整理（2026 年 11 月）；金額、資格以政府最新公告為準。 */
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
  //   amount  一眼看到的重點（金額、天數）；when  什麼時候辦、期限
  //   ages    [從出生第幾天, 到第幾天]：首頁「現在可以申請的福利」在這段期間提醒；due  出生後第幾天是期限（倒數）
  //   months  只在這幾個月提醒（季節性，例如流感疫苗）；auto  不用申請、到院所就有（清單裡有，首頁不提醒）
  // 金額與資格整理自 2026 年 11 月的政府公告與新聞，以主管機關最新公告為準。
  const BENEFITS = [
    { id: 'pre-check', stage: 'prep', title: '孕前健康檢查（部分縣市補助）', desc: '目前沒有全國統一的補助；台北、台中、台南等部分縣市有孕前檢查補助，資格與期限請洽戶籍地衛生局。', where: '各縣市衛生局', url: 'https://mammy.hpa.gov.tw/Home/NewsKBContent?id=1914&type=01' },
    { id: 'ivf', stage: 'prep', title: '人工生殖（試管嬰兒）補助', desc: '符合資格的不孕夫妻可申請，需在補助機構療程。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=4878&pid=19565' },
    { id: 'prenatal', stage: 'preg', title: '產前檢查 14 次＋超音波 3 次', amount: '公費', desc: '持《孕媽咪健康手冊》到產檢院所即可使用，不需另外申請。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=4878&amp=&pid=19370', auto: true },
    { id: 'screens', stage: 'preg', title: '妊娠糖尿病、貧血、乙型鏈球菌篩檢', amount: '公費', desc: '公費產檢項目，依週數由醫師安排。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=4878&amp=&pid=19370', auto: true },
    { id: 'leave-check', stage: 'preg', title: '產檢假', amount: '7 天', desc: '受僱者懷孕期間可請產檢假，薪資照給。', where: '勞動部', url: 'https://www.mol.gov.tw/1607/1632/1633/55496/post' },
    { id: 'leave-partner', stage: 'preg', title: '陪產檢及陪產假', amount: '7 天', desc: '配偶可在懷孕期間陪產檢，或分娩前後請陪產假。', where: '勞動部', url: 'https://www.mol.gov.tw/1607/1632/1633/55496/post' },
    { id: 'flu-preg', stage: 'preg', title: '孕婦公費流感疫苗', amount: '公費', desc: '孕婦在任何孕期都可以接種。帶健保卡和孕婦健康手冊到合約院所；可用疾管署「VAX MAP」、疾管家或撥 1922 查詢哪裡可以打。', when: '每年 10 月起開打（流感季前）', months: [10, 11, 12, 1, 2, 3], where: '衛生福利部疾病管制署', url: 'https://www.mohw.gov.tw/cp-16-88084-1.html' },
    { id: 'tdap-preg', stage: 'preg', title: '孕期百日咳疫苗（Tdap）', desc: '疾管署建議孕期接種一劑百日咳疫苗，讓寶寶出生前就從媽媽得到保護；費用與接種時間請問產檢醫師。', where: '衛生福利部疾病管制署', url: 'https://www.cdc.gov.tw/Category/Page/qtLT5XEA5spIfYmlrlOmRw' },
    { id: 'maternity', stage: 'birth', title: '產假', amount: '8 週', desc: '分娩前後休產假；工資規定依勞基法。', where: '勞動部', url: 'https://eeweb.mol.gov.tw/front/277' },
    { id: 'birth-pay', stage: 'birth', title: '生育給付＋補助', amount: '每胎 10 萬', desc: '2026 年 1 月 1 日起出生的寶寶，不論媽媽有沒有參加勞保、國保、農保，生育給付加政府補助每胎合計 10 萬元（雙胞胎 20 萬），以勞保局公告為準。', when: '寶寶出生後申請', ages: [0, 365], where: '勞動部勞工保險局', url: 'https://www.bli.gov.tw/0017641.html' },
    { id: 'register', stage: 'birth', title: '出生登記', desc: '帶出生證明、父母身分證、戶口名簿到戶政事務所。辦完才能申請育兒津貼、健保。', when: '出生後 60 天內', ages: [0, 60], due: 60, where: '戶政事務所', url: 'https://www.ris.gov.tw/documents/html/2/3/1/379.html' },
    { id: 'nhi', stage: 'birth', title: '新生兒健保加保', desc: '完成出生登記後辦理依附投保。', when: '辦完出生登記後', ages: [0, 90], where: '衛生福利部中央健康保險署', url: 'https://www.nhi.gov.tw/ch/cp-4963-899d7-2669-1.html' },
    { id: 'city-bonus', stage: 'birth', title: '縣市生育津貼／獎勵', desc: '各縣市標準不同，通常在戶籍地辦出生登記時一併申請。', when: '辦出生登記時一起問', ages: [0, 60], where: '戶籍地區公所／縣市政府' },
    { id: 'nbs-free', stage: 'birth', title: '新生兒先天性代謝異常疾病篩檢', amount: '全額公費', desc: '出生 48 小時後在醫院採足跟血。2026 年 7 月起改為全額公費，共 22 項（新增脊髓性肌肉萎縮症 SMA）。', where: '國民健康署', url: 'https://health99.hpa.gov.tw/theme/content/294', auto: true },
    { id: 'hearing', stage: 'birth', title: '新生兒聽力篩檢', amount: '公費', desc: '本國籍新生兒公費篩檢，最好在住院期間完成；沒通過要在 3 個月內完成確診檢查。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=515&pid=542', auto: true },
    { id: 'pp-care', stage: 'birth', title: '產後健康照護服務', amount: '公費', desc: '產後媽媽有公費的產後健康照護（身心評估與衛教），次數與時間以國健署公告為準。', where: '國民健康署', url: 'https://mammy.hpa.gov.tw/Home/NewsKBContent?id=3644&type=01', auto: true },
    { id: 'allowance-02', stage: 'baby', title: '未滿 2 歲育兒津貼', amount: '每月 5,000–7,000 元', desc: '自己或家人照顧、沒有送公共化／準公共托育：第 1 名每月 5,000 元、第 2 名 6,000 元、第 3 名以上 7,000 元，不排富；可以和育嬰留職停薪津貼一起領。', when: '出生後 60 天內完成出生登記並申請，可從出生月份算起；向寶寶戶籍地的區公所申請（部分縣市可線上申辦）', ages: [0, 730], due: 60, where: '衛生福利部／戶籍地區公所', url: 'https://www.sfaa.gov.tw/SFAA/Pages/VDetail.aspx?nodeid=1057&pid=10779' },
    { id: 'daycare-02', stage: 'baby', title: '未滿 2 歲托育補助（公托／準公共）', amount: '每月 7,000／13,000 元起', desc: '送公共化托育每月 7,000 元起、準公共托育 13,000 元起（第 2 名加 1,000 元、第 3 名以上加 2,000 元），每週送托 30 小時以上；和育兒津貼只能擇一。滿 2 歲續留準公共托育可延長到未滿 3 歲。', when: '要送托時', ages: [0, 1095], where: '衛生福利部', url: 'https://www.mohw.gov.tw/fp-5130-58003-1.html' },
    { id: 'parental', stage: 'baby', title: '育嬰留職停薪津貼', amount: '投保薪資 8 成', desc: '父母參加就業保險滿 1 年，子女滿 3 歲前辦理育嬰留職停薪，可以領投保薪資 8 成；2026 年起也可以「以日」申請，合計不超過 30 日。可在勞保局 e 化服務線上申請。', when: '子女滿 3 歲前', ages: [0, 1095], where: '勞動部勞工保險局', url: 'https://www.bli.gov.tw/0020785.html' },
    { id: 'nursing', stage: 'baby', title: '哺（集）乳時間', amount: '每天 60 分鐘', desc: '子女未滿 2 歲、需要親自哺（集）乳的受僱者，雇主每天另給 60 分鐘，視為工作時間；不限母乳，爸爸也可以請。', when: '回到職場後，跟公司說一聲', ages: [42, 730], where: '勞動部', url: 'https://www.mol.gov.tw/1607/28690/2282/2284/2294/' },
    { id: 'allowance-25', stage: 'baby', title: '2–5 歲育兒津貼或幼兒園學費減免', desc: '2 歲到未滿 5 歲：沒有讀公立、非營利或準公共幼兒園可以領育兒津貼；讀這些幼兒園則是學費減免（兩者擇一）。5 歲到上小學前是就學補助。', when: '寶寶滿 2 歲當天起可以申請（線上或戶籍地公所）', ages: [700, 1825], where: '教育部國民及學前教育署／戶籍地公所', url: 'https://www.banqiao.ntpc.gov.tw/userfiles/3010500/files/20251016-FQA.pdf' },
    { id: 'tax-preschool', stage: 'baby', title: '報稅：幼兒學前特別扣除額', amount: '每年 15 萬／22.5 萬', desc: '6 歲以下子女，第 1 名每年 15 萬元、第 2 名以上 22.5 萬元（2024 年度起），不排富，可以和扶養免稅額一起用。報綜所稅時申報扶養這位子女，網路報稅會自動算進去。', when: '每年 5 月報稅時', ages: [0, 2190], months: [5], where: '財政部', url: 'https://www.mof.gov.tw/singlehtml/384fb3077bb349ea973e7fc6f13b6974?cntId=b9f32044b5254406a78f91a9937e0bc4' },
    { id: 'child-check', stage: 'baby', title: '兒童預防保健 9 次＋公費疫苗', amount: '公費', desc: '2026 年 7 月起預防保健由 7 次增為 9 次。持《兒童健康手冊》和健保卡到合約院所即可。', where: '國民健康署／疾病管制署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=5020&pid=19967', auto: true },
    { id: 'dev-screen', stage: 'baby', title: '兒童發展篩檢 6 次', amount: '公費', desc: '2024 年 7 月起，未滿 7 歲兒童有 6 次公費發展篩檢（6–10 個月、10 個月–1 歲半、1 歲半–2 歲、2–3 歲、3–5 歲、5–7 歲），可和預防保健一起做。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/List.aspx?nodeid=4824', auto: true },
    { id: 'fluoride', stage: 'baby', title: '兒童牙齒塗氟', amount: '每半年 1 次', desc: '未滿 6 歲兒童每半年可到牙科塗氟一次，次數依公告。', where: '國民健康署', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=1098&pid=6455', auto: true },
  ];

  App.EXTRAS = { FERTILITY_Q, BENEFITS };
}());
