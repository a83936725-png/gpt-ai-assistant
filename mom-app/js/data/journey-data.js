/* 孕產路線圖資料：懷孕初期 → 中期 → 後期 → 足月待產 → 生產 → 產後坐月子。
 * 內容為一般衛教整理（參考國健署孕媽咪健康手冊、兒童健康手冊、衛福部公開資訊），不能取代醫師建議。
 * level: 'urgent' = 請立即就醫（必要時 119）；'soon' = 請盡快聯絡產檢醫院／醫師；'crisis' = 心理危機，提供專線。 */
(function () {
  const App = window.App = window.App || {};

  const PHASES = [
    {
      id: 'early', title: '懷孕初期', range: '0–13 週', icon: '🌱', from: 0, to: 13,
      intro: '小生命剛開始，最重要的是確認懷孕、開始產檢、照顧好身體。',
      todo: [
        { id: 'e-confirm', text: '到婦產科確認子宮內懷孕、看到胎心', week: 6 },
        { id: 'e-handbook', text: '第一次產檢，領取《孕媽咪健康手冊》', week: 8, tool: 'prenatal' },
        { id: 'e-folic', text: '每天補充葉酸（或孕婦維他命）', tool: 'home' },
        { id: 'e-edd', text: '在 App 設定預產期，開始看每週寶寶變化', tool: 'pregnancy' },
        { id: 'e-screen', text: '與醫師討論第一孕期唐氏症篩檢（約 11–14 週，自費或依縣市補助）', week: 11 },
        { id: 'e-leave', text: '了解產檢假（7 天）、產假與育嬰留停規定', week: 12 },
      ],
      watch: [
        '陰道出血，或伴隨持續、劇烈的腹痛',
        '吐到無法進食喝水、尿量明顯變少',
        '發燒 38°C 以上',
        '單側下腹劇痛、頭暈或昏倒（需排除子宮外孕）',
      ],
      tips: ['少量多餐、避免空腹可減輕孕吐', '避免菸酒、生食與未經醫師同意的藥物', '每天記錄身體狀況，產檢時給醫師看'],
    },
    {
      id: 'mid', title: '懷孕中期', range: '14–27 週', icon: '🌼', from: 14, to: 27,
      intro: '通常是最舒服的階段，會開始感覺到胎動，也有幾項重要篩檢。',
      todo: [
        { id: 'm-move', text: '留意第一次胎動（約 18–20 週，第一胎可能更晚）', week: 18 },
        { id: 'm-level2', text: '與醫師討論高層次超音波（約 20–24 週，多為自費）', week: 20 },
        { id: 'm-gdm', text: '妊娠糖尿病篩檢＋貧血檢驗（24–28 週，公費）', week: 24, tool: 'prenatal' },
        { id: 'm-weight', text: '每週記錄體重，看增重是否在建議範圍', tool: 'pregweight' },
        { id: 'm-class', text: '報名媽媽教室、了解生產方式與醫院', week: 22 },
        { id: 'm-care', text: '開始規劃坐月子方式（月子中心／到府／在家）', week: 24 },
      ],
      watch: [
        '陰道出血或有液體流出（疑似破水）',
        '未滿 37 週出現規律宮縮、下腹規律緊繃或下墜感',
        '頭痛不止、視力模糊、臉和手突然水腫（子癲前症警訊）',
        '血壓 ≥ 140/90 mmHg',
        '胎動出現後又明顯減少',
      ],
      tips: ['側睡（左側更好）比較舒服', '腿抽筋可睡前伸展小腿、補充水分', '牙齒問題趁這時處理比較安全'],
    },
    {
      id: 'late', title: '懷孕後期', range: '28–36 週', icon: '🍈', from: 28, to: 36,
      intro: '寶寶快速長大，每天數胎動、準備待產包、認識產兆。',
      todo: [
        { id: 'l-kick', text: '每天固定時間數胎動', tool: 'kick' },
        { id: 'l-gbs', text: '乙型鏈球菌（GBS）篩檢（35–37 週，公費）', week: 35, tool: 'prenatal' },
        { id: 'l-bag', text: '準備待產包，證件、健保卡、孕媽咪健康手冊放一起', week: 32, tool: 'hospitalbag' },
        { id: 'l-carseat', text: '安裝嬰兒汽車安全座椅', week: 34, tool: 'goods', params: { item: 'carseat' } },
        { id: 'l-route', text: '確認去醫院的路線、時間與聯絡人', week: 34 },
        { id: 'l-leave', text: '和公司安排產假交接', week: 32 },
      ],
      watch: [
        '未滿 37 週規律宮縮（1 小時 4 次以上）、破水或落紅（早產徵兆）',
        '胎動明顯減少或感覺不到',
        '頭痛、視力模糊、上腹痛、突然水腫（子癲前症）',
        '陰道出血',
        '全身或手掌腳底劇烈搔癢',
      ],
      tips: ['肚子變大，起身時先側身再撐起來', '少量多餐可減少胃食道逆流', '學會分辨假性宮縮（不規律、休息會緩解）'],
    },
    {
      id: 'term', title: '足月待產', range: '37 週以後', icon: '🎒', from: 37, to: 42,
      intro: '隨時可能生！熟悉產兆，知道什麼時候該去醫院。',
      todo: [
        { id: 't-signs', text: '熟悉三大產兆：落紅、破水、規律宮縮', tool: 'contraction' },
        { id: 't-bag', text: '待產包放在門口或車上', tool: 'hospitalbag' },
        { id: 't-contact', text: '把醫院產房電話存在手機', week: 37 },
        { id: 't-plan', text: '過了預產期依醫師安排回診（約 41 週會討論催生）', week: 40 },
      ],
      watch: [
        '破水：不論有沒有宮縮，都要直接去醫院（記下時間、羊水顏色）',
        '大量出血（比月經多）',
        '規律宮縮：約每 5 分鐘一次、每次 1 分鐘、持續 1 小時（第一胎參考 5-1-1）',
        '胎動明顯減少',
        '劇烈頭痛、視力模糊',
      ],
      tips: ['宮縮計時器可以幫你判斷頻率', '想吃東西就吃一點，保持體力', '陪產的人也要先準備好證件與保暖衣物'],
    },
    {
      id: 'birth', title: '生產', range: '寶寶出生', icon: '👶',
      intro: '恭喜！記下這一天，接下來寶寶有幾項很重要的檢查。',
      todo: [
        { id: 'b-record', text: '填寫生產紀錄（時間、體重、身長、生產方式）', action: 'birth' },
        { id: 'b-skin', text: '肌膚接觸、早點開始哺乳' },
        { id: 'b-hepb', text: '寶寶 B 型肝炎疫苗第 1 劑（出生 24 小時內）', tool: 'prevention' },
        { id: 'b-screen', text: '新生兒代謝異常篩檢（出生 48 小時後）、聽力篩檢', tool: 'prevention' },
        { id: 'b-handbook', text: '領取《兒童健康手冊》，認識裡面的「嬰兒大便顏色卡」' },
        { id: 'b-learn', text: '出院前學會臍帶護理、洗澡、餵奶姿勢' },
      ],
      watch: [
        '媽媽：產後大量出血、頭暈、發燒',
        '寶寶：呼吸急促或費力、嘴唇發紫、24 小時內出現黃疸',
      ],
      tips: ['出院前把寶寶的出生資料填進 App，成長曲線會從出生開始畫'],
    },
    {
      id: 'pp', title: '產後坐月子', range: '產後 0–6 週', icon: '🍲',
      intro: '好好休息、讓身體恢復；同時觀察寶寶的吃、睡、尿、便。',
      todo: [
        { id: 'p-daily', text: '每天記錄身體恢復：惡露、傷口、體溫、心情', tool: 'postpartum' },
        { id: 'p-baby', text: '記錄寶寶餵奶、尿布、睡眠', tool: 'log' },
        { id: 'p-register', text: '出生後 60 天內到戶政事務所辦出生登記，接著辦健保', week: 2 },
        { id: 'p-hepb2', text: '寶寶 B 型肝炎疫苗第 2 劑、第 1 次兒童預防保健（約 1 個月）', tool: 'prevention' },
        { id: 'p-checkup', text: '產後約 6 週回婦產科檢查', week: 6 },
        { id: 'p-subsidy', text: '查詢生育給付、育兒津貼等補助（依政府最新公告）' },
      ],
      watch: [
        '發燒 38°C 以上',
        '惡露突然變多（1 小時濕透一片衛生棉）、有大血塊或異味',
        '傷口紅腫、流膿或越來越痛',
        '單側小腿腫痛、胸痛、呼吸困難（立即就醫）',
        '乳房紅腫熱痛合併發燒（乳腺炎）',
        '情緒低落超過 2 週，或有傷害自己或寶寶的念頭（立即求助）',
      ],
      tips: ['惡露通常約 4–8 週：鮮紅 → 粉褐 → 黃白', '寶寶睡的時候你也睡', '讓家人分擔：換尿布、洗澡、家事都可以交出去'],
    },
  ];

  // 症狀：懷孕期間
  const PREG_SYMPTOMS = [
    { id: 'nausea', label: '噁心孕吐' },
    { id: 'tired', label: '疲倦想睡' },
    { id: 'heartburn', label: '胃食道逆流' },
    { id: 'constipation', label: '便秘' },
    { id: 'backpain', label: '腰痠背痛' },
    { id: 'cramp', label: '腿抽筋' },
    { id: 'footswell', label: '腳踝水腫' },
    { id: 'insomnia', label: '失眠' },
    { id: 'gums', label: '牙齦出血' },
    { id: 'moody', label: '情緒起伏' },
    { id: 'spotting', label: '少量出血／點狀', level: 'soon' },
    { id: 'vomit', label: '吐到無法進食喝水', level: 'soon' },
    { id: 'fever', label: '發燒 ≥38°C', level: 'soon' },
    { id: 'uti', label: '小便疼痛灼熱', level: 'soon' },
    { id: 'itch', label: '手掌腳底劇烈搔癢', level: 'soon' },
    { id: 'faceswell', label: '臉和手突然水腫', level: 'soon' },
    { id: 'bleeding', label: '大量出血', level: 'urgent' },
    { id: 'pain', label: '持續或劇烈腹痛', level: 'urgent' },
    { id: 'fluid', label: '疑似破水（有液體流出）', level: 'urgent' },
    { id: 'headache', label: '頭痛不止／視力模糊', level: 'urgent' },
    { id: 'lessmove', label: '胎動明顯減少', level: 'urgent' },
    { id: 'contract', label: '未滿 37 週規律宮縮', level: 'urgent' },
  ];

  // 症狀：產後媽媽
  const PP_SYMPTOMS = [
    { id: 'afterpain', label: '子宮收縮痛' },
    { id: 'woundpain', label: '傷口疼痛（逐漸改善）' },
    { id: 'engorge', label: '乳房脹' },
    { id: 'tired', label: '疲倦' },
    { id: 'constipation', label: '便秘' },
    { id: 'blues', label: '想哭、情緒起伏' },
    { id: 'mastitis', label: '乳房紅腫熱痛', level: 'soon' },
    { id: 'smell', label: '惡露有異味', level: 'soon' },
    { id: 'wound', label: '傷口紅腫、滲液', level: 'soon' },
    { id: 'urine', label: '排尿疼痛或解不出來', level: 'soon' },
    { id: 'lowmood', label: '情緒低落超過 2 週', level: 'soon' },
    { id: 'fever', label: '發燒 ≥38°C', level: 'urgent' },
    { id: 'heavy', label: '大量出血／大血塊', level: 'urgent' },
    { id: 'calf', label: '單側小腿腫痛', level: 'urgent' },
    { id: 'chest', label: '胸痛、呼吸困難', level: 'urgent' },
    { id: 'headache', label: '劇烈頭痛、視力模糊', level: 'urgent' },
    { id: 'harm', label: '有傷害自己或寶寶的念頭', level: 'crisis' },
  ];

  const LOCHIA = {
    amount: [{ value: 'none', label: '幾乎沒有' }, { value: 's', label: '少' }, { value: 'm', label: '中' }, { value: 'l', label: '多' }],
    color: [
      { value: 'red', label: '鮮紅', hex: '#c0392b' },
      { value: 'dark', label: '暗紅', hex: '#7b241c' },
      { value: 'pink', label: '粉褐', hex: '#c8907a' },
      { value: 'yellow', label: '黃白', hex: '#e9dcb5' },
    ],
  };
  const MOODS = [
    { value: 5, emoji: '😄', label: '很好' },
    { value: 4, emoji: '🙂', label: '還不錯' },
    { value: 3, emoji: '😐', label: '普通' },
    { value: 2, emoji: '😞', label: '低落' },
    { value: 1, emoji: '😢', label: '很難受' },
  ];

  // 新生兒前幾週要觀察的事
  const NEWBORN = [
    { id: 'n-diaper', text: '濕尿布：出生第 N 天至少 N 片，第 6 天起每天 6 片以上（喝得夠的指標）' },
    { id: 'n-poo', text: '便便：胎便（墨綠黑）約 3–4 天轉成黃色；灰白色便請立即就醫（對照嬰兒大便顏色卡）' },
    { id: 'n-jaundice', text: '黃疸：在自然光下看眼白與皮膚；黃到肚子、手腳，或精神差、不愛喝奶要就醫' },
    { id: 'n-weight', text: '體重：前幾天下降 7–10% 內常見，約 2 週回到出生體重' },
    { id: 'n-cord', text: '臍帶：保持乾燥清潔，約 1–3 週脫落；紅腫、流膿、異味要就醫' },
    { id: 'n-sleep', text: '睡眠安全：仰睡、獨立床面、不放枕頭棉被玩偶' },
    { id: 'n-fever', text: '未滿 3 個月體溫 ≥38°C，請立即就醫' },
  ];

  const HOTLINES = [
    { label: '緊急救護', number: '119' },
    { label: '孕產婦關懷專線（國健署）', number: '0800-870-870' },
    { label: '安心專線（24 小時心理諮詢）', number: '1925' },
  ];

  App.JOURNEY = { PHASES, PREG_SYMPTOMS, PP_SYMPTOMS, LOCHIA, MOODS, NEWBORN, HOTLINES };
}());
