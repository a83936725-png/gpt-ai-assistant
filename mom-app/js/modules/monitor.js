/* 看寶寶 — baby monitor: an old phone / iPad becomes the camera, another phone on the same Wi-Fi watches.
 *
 * No server and no third-party service. WebRTC peer-to-peer, paired by hand:
 *   camera shows a 配對碼 (SDP offer) → viewer pastes it and shows a 回覆碼 (SDP answer) → camera pastes that back.
 * Codes travel by copy/paste or LINE share:
 *   'YJ1.' + base64url(deflate-raw(JSON {t:'offer'|'answer', id, sdp}))      ('YJ0.' + base64url(JSON) when CompressionStream is missing)
 * iceServers: [] → host candidates only, so both devices must be on the same network. 4G / outside home needs a
 * relay (TURN) server — planned for a later version. Media is DTLS-SRTP encrypted; nothing is recorded or stored.
 *
 * Exposes App.monitor = { encodeCode, decodeCode, reset, state, testLevel } (testLevel: number overrides the sound meter, for tests).
 */
(function () {
  const App = window.App;
  const { h, ui } = App;

  /* ---------- per-device preferences (this device only, not part of the synced store) ---------- */
  const PKEY = 'yijia-monitor';
  const PREF_DEFAULTS = { role: 'viewer', facing: 'environment', awake: true, cry: true, sens: 'mid' };
  const prefs = (() => {
    try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PKEY) || '{}') }; } catch (e) { return { ...PREF_DEFAULTS }; }
  })();
  const savePrefs = () => { try { localStorage.setItem(PKEY, JSON.stringify(prefs)); } catch (e) { /* storage blocked */ } };

  // sound level is 0–100 (−60 dBFS … 0 dBFS); the cry alert fires when it stays above `thr` for ~3 s
  const SENS = { low: { label: '低', thr: 72 }, mid: { label: '中', thr: 58 }, high: { label: '高', thr: 44 } };
  const CRY_MS = 3000;
  const CRY_COOLDOWN = 20000;
  const RTC_CONFIG = { iceServers: [], bundlePolicy: 'max-bundle' };
  const CONNECT_TIMEOUT = 20000;

  /* ---------- icons (same stroke style as App.ui.ICONS) ---------- */
  const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>'),
    paste: svg('<rect x="5" y="4.5" width="14" height="16" rx="2.5"/><path d="M9 4.5v-1h6v1"/><path d="M8.5 10h7M8.5 14h5"/>'),
    camera: svg('<path d="M3.5 8.5a2 2 0 0 1 2-2h2l1.5-2h6l1.5 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/>'),
    flip: svg('<path d="M4.5 9.5a8 8 0 0 1 14-4M19.5 14.5a8 8 0 0 1-14 4"/><path d="M18.5 2.5v3h-3M5.5 21.5v-3h3"/>'),
    soundOn: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    soundOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
    expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    shrink: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
    retry: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4.5H9"/>'),
    help: svg('<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6"/><path d="M12 17h.01"/>'),
  };
  const ic = (name) => h('span', { class: 'ic', html: IC[name] || ui.ICONS[name] || '' });

  /* =====================================================================
   * Pairing codes
   * ===================================================================== */
  class CodeError extends Error { constructor(kind) { super(kind); this.kind = kind; } }
  const CODE_RE = /YJ([01])\.([A-Za-z0-9_-]+)/;
  const MAX_CODE = 30000;

  const toB64u = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64u = (str) => {
    if (str.length % 4 === 1) throw new CodeError('corrupt');
    const b = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  };
  const through = async (bytes, transform) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());

  async function encodeCode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      try { return `YJ1.${toB64u(await through(raw, new CompressionStream('deflate-raw')))}`; } catch (e) { /* no deflate-raw → plain */ }
    }
    return `YJ0.${toB64u(raw)}`;
  }

  // Accepts the bare code or a whole pasted LINE message; whitespace/line breaks inside the code are ignored.
  async function decodeCode(text) {
    const flat = String(text || '').replace(/\s+/g, '');
    if (!flat) throw new CodeError('empty');
    if (flat.length > MAX_CODE) throw new CodeError('format');
    const m = flat.match(CODE_RE);
    if (!m) throw new CodeError('format');
    let bytes;
    try { bytes = fromB64u(m[2]); } catch (e) { throw new CodeError('corrupt'); }
    if (m[1] === '1') {
      let ds;
      try { ds = new DecompressionStream('deflate-raw'); } catch (e) { throw new CodeError('old'); }
      try { bytes = await through(bytes, ds); } catch (e) { throw new CodeError('corrupt'); }
    }
    let obj;
    try { obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (e) { throw new CodeError('corrupt'); }
    if (!obj || (obj.t !== 'offer' && obj.t !== 'answer') || typeof obj.sdp !== 'string' || !obj.sdp.startsWith('v=0')) throw new CodeError('corrupt');
    return obj;
  }

  // TCP host candidates are never needed on a home LAN; dropping them keeps the code shorter.
  const slimSdp = (sdp) => {
    const lines = sdp.split('\r\n');
    const isTcp = (l) => /^a=candidate:\S+ \d+ tcp /i.test(l);
    const hasUdp = lines.some((l) => /^a=candidate:/.test(l) && !isTcp(l));
    return hasUdp ? lines.filter((l) => !isTcp(l)).join('\r\n') : sdp;
  };
  const randomId = () => Math.random().toString(36).slice(2, 8);

  // Fewer codecs → much shorter SDP. H.264 first (hardware encoder on old phones), VP8 as the universal fallback.
  function preferCodecs(pc) {
    const Cap = window.RTCRtpReceiver && RTCRtpReceiver.getCapabilities ? RTCRtpReceiver : (window.RTCRtpSender && RTCRtpSender.getCapabilities ? RTCRtpSender : null);
    if (!Cap) return;
    pc.getTransceivers().forEach((tr) => {
      const kind = tr.sender.track && tr.sender.track.kind;
      if (!kind || typeof tr.setCodecPreferences !== 'function') return;
      try {
        const caps = (Cap.getCapabilities(kind) || {}).codecs || [];
        const mime = (c) => c.mimeType.toLowerCase();
        let pick;
        if (kind === 'audio') pick = caps.filter((c) => mime(c) === 'audio/opus');
        else {
          const h264 = caps.filter((c) => mime(c) === 'video/h264' && /packetization-mode=1/.test(c.sdpFmtpLine || ''));
          const base = h264.filter((c) => /profile-level-id=42e01f/i.test(c.sdpFmtpLine || ''));
          pick = [...(base.length ? base : h264).slice(0, 1), ...caps.filter((c) => mime(c) === 'video/vp8')];
          if (pick.length) pick.push(...caps.filter((c) => mime(c) === 'video/rtx'));
        }
        if (pick.length) tr.setCodecPreferences(pick);
      } catch (e) { /* keep the browser's defaults */ }
    });
  }

  function waitIce(pc, ms = 5000) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        pc.removeEventListener('icecandidate', onCand);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      const onCand = (e) => { if (!e.candidate) done(); };
      const timer = setTimeout(done, ms);
      pc.addEventListener('icegatheringstatechange', check);
      pc.addEventListener('icecandidate', onCand);
    });
  }

  /* =====================================================================
   * Session state (one session per screen visit; never persisted)
   * phases — camera: idle → starting → offer → waiting → connecting → connected ⇄ disconnected → failed | ended | error
   *          viewer: idle → answer → waiting → connected ⇄ disconnected → failed | ended | error
   * ===================================================================== */
  const S = {
    role: prefs.role === 'camera' ? 'camera' : 'viewer',
    phase: 'idle',
    error: null, // camera/network problem key (ERR)
    inputError: null, // pasted-code problem key (CODE_ERR)
    failReason: '',
    gen: 0, // bumped on every reset so late async results are dropped
    root: null,
    slots: null,
    localStream: null,
    remoteStream: null,
    pc: null,
    dc: null,
    videoSender: null,
    offerId: '',
    code: '', // the code this device shows
    draft: '', // what was typed / pasted into the code box
    peerName: '',
    connectedAt: null,
    noMic: false,
    camCount: 0,
    muted: true,
    level: 0,
    loud: 0,
    cryShown: false,
    cryAt: 0,
    audioCtx: null,
    meter: null,
    meterTimer: null,
    wake: null,
    wakePending: false,
    dimEl: null,
    connTimer: null,
    discTimer: null,
    view: null, // persistent viewer player
    camView: null, // persistent camera preview
    flipping: false,
  };
  const api = { encodeCode, decodeCode, reset: () => { resetSession(); paint(); }, testLevel: null };
  Object.defineProperty(api, 'state', { get: () => S });
  App.monitor = api;

  const alive = () => !!S.root && S.root.isConnected && document.body.dataset.screen === 'monitor';
  const isLive = () => S.phase === 'connected' || S.phase === 'disconnected';
  const isFs = () => !!S.view && (document.fullscreenElement || document.webkitFullscreenElement) === S.view.el;
  const who = () => (App.store && App.store.state.profile && App.store.state.profile.member) || '家人';
  const stopStream = (st) => { if (st) st.getTracks().forEach((t) => t.stop()); };

  /* ---------- messages ---------- */
  const ERR = {
    denied: ['沒有相機權限', '請允許這個網站使用「相機」和「麥克風」。iPhone：設定 → Safari → 相機、麥克風 → 允許；Android Chrome：點網址列左邊的圖示 → 權限。改好後按「再試一次」。'],
    nocam: ['找不到相機', '這台裝置好像沒有可用的鏡頭，請換一台有鏡頭的手機或平板當攝影機。'],
    busy: ['相機正在被別的 App 使用', '請先關掉視訊通話、相機等 App，再按「再試一次」。'],
    insecure: ['需要安全連線', '相機只能在 https 網址下使用，請從正式網址開啟 App。'],
    unsupported: ['這個瀏覽器不支援', '請把系統更新到最新版：iPhone、iPad 請用 Safari，Android 請用 Chrome。'],
    nonet: ['沒有連上網路', '請確認這台已經連上家裡的 Wi-Fi，再按「再試一次」。'],
    ended: ['攝影機停止了', '鏡頭被系統關掉了（可能是鎖定螢幕或切到別的 App）。請讓這個畫面保持開著，按「再試一次」。'],
    unknown: ['發生問題', '請按「再試一次」；如果一直不行，把 App 關掉重新打開。'],
  };
  const CODE_ERR = {
    empty: '請先貼上代碼。',
    format: '這不是看寶寶的代碼。代碼是「YJ」開頭的一長串英文數字，請整段複製再貼上。',
    corrupt: '代碼不完整或被改到了。請回到另一台按「複製」，整段重新貼一次。',
    old: '這支手機的瀏覽器版本太舊，讀不了這個代碼。請更新系統或瀏覽器。',
    wantAnswer: '這是攝影機自己的「配對碼」。這裡要貼的是看的那支手機產生的「回覆碼」。',
    wantOffer: '這是「回覆碼」，要貼回攝影機那台。這裡要貼的是攝影機顯示的「配對碼」。',
    stale: '這個回覆碼跟目前的配對碼對不上（可能是舊的）。請在看的那支手機用最新的配對碼重新產生。',
  };
  const CHIP = {
    wait: '等待配對', connecting: '連線中', connected: '已連線', broken: '已中斷',
  };
  const chipKey = () => ({
    connecting: 'connecting', connected: 'connected', disconnected: 'broken', failed: 'broken', ended: 'broken',
  }[S.phase] || 'wait');
  const statusText = () => {
    const cam = S.role === 'camera';
    switch (S.phase) {
      case 'starting': return '正在開啟相機…';
      case 'offer': return '正在產生配對碼…';
      case 'answer': return '正在產生回覆碼…';
      case 'waiting': return cam ? '等看的那支手機回覆' : '等攝影機那台貼上回覆碼';
      case 'connecting': return '正在連線…';
      case 'connected': return cam ? `${S.peerName ? `${S.peerName}的手機` : '看的手機'}正在看` : '正在看攝影機畫面';
      case 'disconnected': return '訊號不穩，等待恢復…';
      case 'failed': return S.failReason === 'timeout' ? '連不上' : '連線中斷了';
      case 'ended': return cam ? '看的那支手機已離開' : '攝影機那台已關閉';
      case 'error': return '需要處理一下';
      default: return cam ? '還沒開啟攝影機' : '還沒配對';
    }
  };

  /* =====================================================================
   * Camera side
   * ===================================================================== */
  const AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: true };
  const videoConstraints = (facing) => ({
    facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 24 },
  });
  const mediaErr = (e) => ({
    NotAllowedError: 'denied', PermissionDeniedError: 'denied', SecurityError: 'denied',
    NotFoundError: 'nocam', DevicesNotFoundError: 'nocam', OverconstrainedError: 'nocam',
    NotReadableError: 'busy', TrackStartError: 'busy', AbortError: 'busy',
  }[e && e.name] || 'unknown');

  function fail(kind) {
    S.phase = 'error';
    S.error = kind;
    paint();
  }

  async function startCamera() {
    if (S.phase === 'starting') return;
    const gen = S.gen;
    S.error = null;
    if (!window.isSecureContext) return fail('insecure');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) return fail('unsupported');
    unlockAudio();
    S.phase = 'starting';
    paint();
    const gum = (c) => navigator.mediaDevices.getUserMedia(c);
    let stream;
    let noMic = false;
    try {
      stream = await gum({ video: videoConstraints(prefs.facing), audio: AUDIO });
    } catch (e) {
      if (gen !== S.gen) return;
      if (e && ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'NotReadableError'].includes(e.name)) {
        try { stream = await gum({ video: videoConstraints(prefs.facing) }); noMic = true; } // a device without a (free) microphone
        catch (e2) { if (gen === S.gen) fail(mediaErr(e2)); return; }
      } else { fail(mediaErr(e)); return; }
    }
    if (gen !== S.gen) { stopStream(stream); return; }
    S.localStream = stream;
    S.noMic = noMic || !stream.getAudioTracks().length;
    stream.getTracks().forEach((t) => t.addEventListener('ended', onTrackEnded));
    keepAwake();
    startMeter(stream);
    if (navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices()
        .then((ds) => { if (gen === S.gen) { S.camCount = ds.filter((d) => d.kind === 'videoinput').length; updateStage(); } })
        .catch(() => {});
    }
    await makeOffer();
  }

  async function makeOffer() {
    if (!S.localStream) return startCamera();
    const gen = S.gen;
    closePeer();
    Object.assign(S, { phase: 'offer', error: null, inputError: null, draft: '', failReason: '' });
    paint();
    let pc;
    try {
      pc = new RTCPeerConnection(RTC_CONFIG);
      S.pc = pc;
      S.offerId = randomId();
      S.localStream.getTracks().forEach((t) => {
        const tr = pc.addTransceiver(t, { direction: 'sendonly', streams: [S.localStream] });
        if (t.kind === 'video') S.videoSender = tr.sender;
      });
      preferCodecs(pc);
      S.dc = pc.createDataChannel('yj');
      wireDc(S.dc, pc);
      watchPc(pc);
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      if (gen !== S.gen || pc !== S.pc) return;
      const sdp = pc.localDescription.sdp;
      if (!/a=candidate:/.test(sdp)) { closePeer(); fail('nonet'); return; }
      const code = await encodeCode({ t: 'offer', id: S.offerId, sdp: slimSdp(sdp) });
      if (gen !== S.gen || pc !== S.pc) return;
      S.code = code;
      S.phase = 'waiting';
      paint();
    } catch (e) {
      console.error(e);
      if (gen === S.gen) { closePeer(); fail('unknown'); }
    }
  }

  async function acceptAnswer(text) {
    if (S.phase !== 'waiting') return;
    const gen = S.gen;
    const pc = S.pc;
    let obj;
    try { obj = await decodeCode(text); } catch (e) { inputErr(e.kind || 'corrupt'); return; }
    if (gen !== S.gen || pc !== S.pc || S.phase !== 'waiting') return;
    if (obj.t === 'offer') { inputErr('wantAnswer'); return; }
    if ((obj.id && obj.id !== S.offerId) || !pc || pc.signalingState !== 'have-local-offer') { inputErr('stale'); return; }
    try { await pc.setRemoteDescription({ type: 'answer', sdp: obj.sdp }); } catch (e) { inputErr('corrupt'); return; }
    if (gen !== S.gen || pc !== S.pc) return;
    S.inputError = null;
    if (S.phase === 'waiting') { S.phase = 'connecting'; paint(); }
    clearTimeout(S.connTimer);
    S.connTimer = setTimeout(() => {
      if (gen === S.gen && pc === S.pc && S.phase === 'connecting') { S.phase = 'failed'; S.failReason = 'timeout'; paint(); }
    }, CONNECT_TIMEOUT);
  }

  async function flipCamera() {
    if (!S.localStream || S.flipping) return;
    S.flipping = true;
    const gen = S.gen;
    const next = prefs.facing === 'user' ? 'environment' : 'user';
    const old = S.localStream.getVideoTracks()[0];
    const open = (facing) => navigator.mediaDevices.getUserMedia({ video: videoConstraints(facing) });
    if (old) { old.removeEventListener('ended', onTrackEnded); old.stop(); } // phones cannot open two cameras at once
    let stream = null;
    let facing = next;
    try { stream = await open(next); } catch (e) {
      facing = prefs.facing;
      try { stream = await open(facing); } catch (e2) { stream = null; }
    }
    S.flipping = false;
    if (gen !== S.gen || !S.localStream) { stopStream(stream); return; }
    if (!stream) { onTrackEnded(); return; }
    const track = stream.getVideoTracks()[0];
    if (old) S.localStream.removeTrack(old);
    S.localStream.addTrack(track);
    track.addEventListener('ended', onTrackEnded);
    if (S.videoSender) { try { await S.videoSender.replaceTrack(track); } catch (e) { /* the viewer keeps the last frame */ } }
    const got = track.getSettings ? track.getSettings().facingMode : '';
    if (facing === next) { prefs.facing = next; savePrefs(); }
    ui.toast(got && got !== facing ? '這台好像只有一個鏡頭' : (prefs.facing === 'user' ? '已切到前鏡頭' : '已切到後鏡頭'));
    if (S.camView) { const v = S.camView.video; v.srcObject = null; v.srcObject = S.localStream; }
    updateStage();
  }

  // the camera stopped by itself (system took it away, device unplugged, permission revoked)
  function onTrackEnded() {
    if (!S.localStream) return;
    const wasVideo = S.localStream.getVideoTracks().every((t) => t.readyState === 'ended');
    if (!wasVideo && !S.flipping) return; // a lost microphone alone is not fatal
    closePeer();
    stopLocal();
    S.camView = null;
    fail('ended');
  }

  async function stopCamera() {
    if (S.phase === 'connected' && !(await ui.confirm('關閉後，看的那支手機就看不到畫面了。確定要關閉攝影機嗎？', { ok: '關閉攝影機', danger: true }))) return;
    resetSession();
    paint();
  }

  /* =====================================================================
   * Viewer side
   * ===================================================================== */
  async function acceptOffer(text) {
    if (S.phase === 'answer') return;
    const gen = S.gen;
    unlockAudio(); // inside the tap, so the sound meter is allowed to run
    if (!window.RTCPeerConnection) { fail('unsupported'); return; }
    let obj;
    try { obj = await decodeCode(text); } catch (e) { inputErr(e.kind || 'corrupt'); return; }
    if (gen !== S.gen) return;
    if (obj.t === 'answer') { inputErr('wantOffer'); return; }
    closePeer();
    Object.assign(S, { phase: 'answer', error: null, inputError: null, failReason: '', muted: true });
    paint();
    let pc;
    try {
      pc = new RTCPeerConnection(RTC_CONFIG);
      S.pc = pc;
      pc.ontrack = (e) => onRemoteTrack(e, pc);
      pc.ondatachannel = (e) => { if (pc === S.pc) { S.dc = e.channel; wireDc(e.channel, pc); } };
      watchPc(pc);
      try { await pc.setRemoteDescription({ type: 'offer', sdp: obj.sdp }); } catch (e) {
        if (gen === S.gen && pc === S.pc) { closePeer(); S.phase = 'idle'; inputErr('corrupt'); }
        return;
      }
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      if (gen !== S.gen || pc !== S.pc) return;
      const sdp = pc.localDescription.sdp;
      if (!/a=candidate:/.test(sdp)) { closePeer(); fail('nonet'); return; }
      const code = await encodeCode({ t: 'answer', id: obj.id || '', sdp: slimSdp(sdp) });
      if (gen !== S.gen || pc !== S.pc) return;
      S.code = code;
      if (S.phase === 'answer') S.phase = 'waiting';
      paint();
    } catch (e) {
      console.error(e);
      if (gen === S.gen) { closePeer(); fail('unknown'); }
    }
  }

  function onRemoteTrack(e, pc) {
    if (pc !== S.pc) return;
    const stream = (e.streams && e.streams[0]) || S.remoteStream || new MediaStream();
    if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
    S.remoteStream = stream;
    const v = viewerStage().video;
    if (v.srcObject !== stream) v.srcObject = stream;
    v.muted = S.muted;
    v.play().catch(() => {});
    if (e.track.kind === 'audio') startMeter(stream);
    updateStage();
  }

  function toggleSound() {
    const v = S.view && S.view.video;
    if (!v) return;
    S.muted = !S.muted;
    v.muted = S.muted;
    if (!S.muted) { v.volume = 1; v.play().catch(() => {}); unlockAudio(); }
    updateStage();
    ui.toast(S.muted ? '已靜音' : (S.remoteStream && S.remoteStream.getAudioTracks().length ? '已開聲音' : '攝影機沒有傳聲音過來'));
  }

  function toggleFullscreen() {
    const v = S.view;
    if (!v) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (isFs()) { try { Promise.resolve(exit.call(document)).catch(() => {}); } catch (e) { /* ignore */ } return; }
    const req = v.el.requestFullscreen || v.el.webkitRequestFullscreen;
    const fallback = () => {
      if (v.video.webkitEnterFullscreen) v.video.webkitEnterFullscreen(); // iPhone Safari: video-only fullscreen
      else ui.toast('這個瀏覽器不支援全螢幕，可以把手機橫放看');
    };
    if (!req) { fallback(); return; }
    try { Promise.resolve(req.call(v.el)).catch(fallback); } catch (e) { fallback(); }
  }
  const exitFs = () => {
    if (!isFs()) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try { Promise.resolve(exit.call(document)).catch(() => {}); } catch (e) { /* ignore */ }
  };
  document.addEventListener('fullscreenchange', () => updateStage());
  document.addEventListener('webkitfullscreenchange', () => updateStage());

  async function resetViewer(ask) {
    if (ask && S.phase === 'connected' && !(await ui.confirm('重新連線需要兩台重新交換一次代碼。確定要中斷目前的畫面嗎？', { ok: '重新連線' }))) return;
    exitFs();
    closePeer();
    stopMeter();
    releaseAwake();
    hideCry();
    Object.assign(S, { phase: 'idle', error: null, inputError: null, draft: '', failReason: '' });
    paint();
    const steps = S.slots && S.slots.body.querySelector('.mon-steps');
    if (steps && steps.scrollIntoView) steps.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* =====================================================================
   * Connection plumbing (both sides)
   * ===================================================================== */
  function watchPc(pc) {
    const gen = S.gen;
    const on = () => {
      if (gen !== S.gen || pc !== S.pc) return;
      const st = pc.connectionState || ({ checking: 'connecting', completed: 'connected' }[pc.iceConnectionState] || pc.iceConnectionState);
      if (st === 'connected') onConnected();
      else if (st === 'disconnected') onDisconnected();
      else if (st === 'failed') onFailed();
    };
    pc.addEventListener('connectionstatechange', on);
    pc.addEventListener('iceconnectionstatechange', on);
  }

  function onConnected() {
    clearTimeout(S.connTimer);
    clearTimeout(S.discTimer);
    if (S.phase === 'connected' || S.phase === 'ended' || S.phase === 'error') return;
    const first = !S.connectedAt;
    S.phase = 'connected';
    S.failReason = '';
    if (first) S.connectedAt = new Date().toISOString();
    if (S.role === 'viewer') {
      keepAwake();
      if (S.view) S.view.video.play().catch(() => {});
    }
    if (first) ui.toast(S.role === 'camera' ? '已連線，對方看得到畫面了' : '已連上攝影機');
    paint();
  }
  function onDisconnected() {
    if (S.phase !== 'connected') return;
    S.phase = 'disconnected';
    paint();
    clearTimeout(S.discTimer);
    S.discTimer = setTimeout(() => { if (S.phase === 'disconnected') { S.phase = 'failed'; paint(); } }, 15000);
  }
  function onFailed() {
    clearTimeout(S.connTimer);
    clearTimeout(S.discTimer);
    if (['ended', 'error', 'failed', 'idle', 'offer', 'answer'].includes(S.phase)) return;
    if (S.role === 'viewer' && S.phase === 'waiting') return; // camera hasn't pasted the 回覆碼 yet; its checks will revive the pair
    S.phase = 'failed';
    paint();
  }

  // tiny control channel: 'hi' (who is watching) and 'bye' (the other side left on purpose)
  function wireDc(dc, pc) {
    dc.onopen = () => { if (pc === S.pc && S.role === 'viewer') sendDc({ type: 'hi', name: who() }); };
    dc.onmessage = (e) => {
      if (pc !== S.pc) return;
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.type === 'hi') { S.peerName = String(m.name || '').slice(0, 12); paint(); }
      else if (m.type === 'bye') {
        clearTimeout(S.connTimer);
        clearTimeout(S.discTimer);
        S.phase = 'ended';
        hideCry();
        if (S.role === 'viewer') { stopMeter(); releaseAwake(); exitFs(); }
        paint();
      }
    };
  }
  const sendDc = (m) => { try { if (S.dc && S.dc.readyState === 'open') S.dc.send(JSON.stringify(m)); } catch (e) { /* closing */ } };

  function closePeer() {
    clearTimeout(S.connTimer);
    clearTimeout(S.discTimer);
    const { pc, dc } = S;
    const open = dc && dc.readyState === 'open';
    if (open) sendDc({ type: 'bye' });
    S.pc = null;
    S.dc = null;
    S.videoSender = null;
    if (pc) {
      pc.ontrack = null;
      pc.ondatachannel = null;
      const close = () => { try { pc.close(); } catch (e) { /* already closed */ } };
      if (open) setTimeout(close, 150); else close(); // let the 'bye' leave first
    }
    if (S.remoteStream) { stopStream(S.remoteStream); S.remoteStream = null; }
    if (S.view) S.view.video.srcObject = null;
    Object.assign(S, { code: '', offerId: '', connectedAt: null, peerName: '', muted: true });
  }

  function stopLocal() {
    if (S.localStream) {
      S.localStream.getTracks().forEach((t) => t.removeEventListener('ended', onTrackEnded));
      stopStream(S.localStream);
    }
    S.localStream = null;
    if (S.camView) S.camView.video.srcObject = null;
    stopMeter();
    releaseAwake();
    setDim(false);
  }

  function resetSession() {
    S.gen += 1;
    exitFs();
    closePeer();
    stopLocal();
    hideCry();
    if (S.view && S.view.cry.parentNode) S.view.cry.remove();
    Object.assign(S, {
      phase: 'idle', error: null, inputError: null, draft: '', failReason: '', view: null, camView: null, noMic: false, camCount: 0, flipping: false,
    });
  }

  window.addEventListener('pagehide', () => sendDc({ type: 'bye' }));

  /* =====================================================================
   * Sound meter + cry alert
   * ===================================================================== */
  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!S.audioCtx || S.audioCtx.state === 'closed') { try { S.audioCtx = new AC(); } catch (e) { return null; } }
    if (S.audioCtx.state === 'suspended') {
      S.audioCtx.resume().catch(() => {});
      // iPhone Safari keeps audio suspended until a tap: resume on the next touch anywhere
      const ctx = S.audioCtx;
      document.addEventListener('pointerdown', () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); }, { once: true, capture: true });
    }
    return S.audioCtx;
  }

  function startMeter(stream) {
    stopMeter();
    const track = stream && stream.getAudioTracks()[0];
    if (!track) return;
    const ctx = unlockAudio();
    if (!ctx) return;
    try {
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      const sink = ctx.createGain();
      sink.gain.value = 0; // keeps the graph pulled in every browser without playing anything
      src.connect(an);
      an.connect(sink);
      sink.connect(ctx.destination);
      S.meter = { src, an, sink, buf: new Float32Array(an.fftSize), bytes: new Uint8Array(an.fftSize), last: performance.now() };
      S.meterTimer = setInterval(tick, 100);
    } catch (e) { S.meter = null; }
  }
  function stopMeter() {
    clearInterval(S.meterTimer);
    S.meterTimer = null;
    if (S.meter) { try { S.meter.src.disconnect(); S.meter.sink.disconnect(); } catch (e) { /* gone */ } }
    S.meter = null;
    S.level = 0;
    S.loud = 0;
    renderMeter();
  }

  function tick() {
    const m = S.meter;
    if (!m) return;
    const now = performance.now();
    const dt = Math.min(1500, now - m.last); // timers are throttled in background tabs; use real elapsed time
    m.last = now;
    let sum = 0;
    if (m.an.getFloatTimeDomainData) {
      m.an.getFloatTimeDomainData(m.buf);
      for (let i = 0; i < m.buf.length; i += 1) sum += m.buf[i] * m.buf[i];
    } else {
      m.an.getByteTimeDomainData(m.bytes);
      for (let i = 0; i < m.bytes.length; i += 1) { const x = (m.bytes[i] - 128) / 128; sum += x * x; }
    }
    const rms = Math.sqrt(sum / m.buf.length);
    let lvl = rms > 0 ? ((20 * Math.log10(rms) + 60) / 60) * 100 : 0;
    if (typeof api.testLevel === 'number') lvl = api.testLevel;
    lvl = Math.max(0, Math.min(100, lvl));
    S.level = Math.max(lvl, S.level * 0.8); // fast attack, ~0.3 s release, so short breaths don't reset the cry timer
    renderMeter();
    if (S.role === 'viewer' && prefs.cry && S.phase === 'connected') detectCry(dt);
  }

  function detectCry(dt) {
    if (S.level >= SENS[prefs.sens].thr) S.loud += dt;
    else S.loud = Math.max(0, S.loud - dt * 0.5);
    if (S.loud >= CRY_MS && !S.cryShown && Date.now() - S.cryAt > CRY_COOLDOWN) cryAlert();
  }

  function cryAlert() {
    S.cryShown = true;
    S.loud = 0;
    if (S.view) S.view.cry.hidden = false;
    try { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 600]); } catch (e) { /* not on iOS */ }
    ui.toast('👶 寶寶好像在哭，快去看看！', { ms: 5000 });
    // page in the background: a local notification if the mom already allowed notifications (no server push)
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const body = '聲音持續變大超過 3 秒，快去看看。';
      const reg = navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration() : Promise.resolve(null);
      reg.then((r) => (r ? r.showNotification('寶寶可能在哭', { body, tag: 'yj-monitor-cry', renotify: true }) : new Notification('寶寶可能在哭', { body })))
        .catch(() => {});
    }
  }
  function hideCry() {
    if (S.cryShown) S.cryAt = Date.now();
    S.cryShown = false;
    S.loud = 0;
    if (S.view) S.view.cry.hidden = true;
  }

  function renderMeter() {
    const v = S.role === 'viewer' ? S.view : S.camView;
    if (!v) return;
    const lvl = Math.round(S.level);
    v.fill.style.clipPath = `inset(0 ${100 - lvl}% 0 0)`;
    v.fill.style.webkitClipPath = v.fill.style.clipPath;
    const thr = SENS[prefs.sens].thr;
    const word = lvl < 20 ? '安靜' : lvl < thr ? '有聲音' : '很大聲';
    if (v.meterWord.textContent !== word) v.meterWord.textContent = word;
    v.meter.setAttribute('aria-valuenow', String(lvl));
    v.meter.setAttribute('aria-valuetext', word);
  }

  /* =====================================================================
   * Screen wake lock + 省電黑畫面
   * ===================================================================== */
  const sessionWantsAwake = () => alive() && (S.role === 'camera' ? !!S.localStream : isLive());
  async function keepAwake() {
    if (!prefs.awake || !('wakeLock' in navigator) || S.wake || S.wakePending || document.visibilityState !== 'visible') return;
    S.wakePending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!sessionWantsAwake()) { lock.release().catch(() => {}); return; }
      S.wake = lock;
      lock.addEventListener('release', () => { if (S.wake === lock) S.wake = null; });
    } catch (e) { /* low battery / not allowed — the toggle hint explains the manual way */ } finally { S.wakePending = false; }
  }
  function releaseAwake() {
    const lock = S.wake;
    S.wake = null;
    if (lock) lock.release().catch(() => {});
  }
  // the system drops the lock whenever the page is hidden; take it again when we come back
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sessionWantsAwake()) keepAwake(); });

  function setDim(on) {
    if (on === !!S.dimEl) return;
    if (on) {
      const status = h('p', { class: 'mon-dim-status', 'aria-live': 'polite' });
      const btn = h('button', { type: 'button', class: 'mon-dim-exit', onclick: () => setDim(false) }, '點這裡恢復畫面');
      const ov = h('div', { class: 'mon-dim', role: 'dialog', 'aria-modal': 'true', 'aria-label': '省電黑畫面' },
        h('div', { class: 'mon-dim-inner' }, status, btn));
      ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDim(false); });
      document.body.append(ov);
      S.dimEl = ov;
      S.dimStatus = status;
      syncDim();
      if (S.camView) S.camView.video.pause(); // the preview isn't needed while black; streaming continues
      btn.focus();
    } else {
      S.dimEl.remove();
      S.dimEl = null;
      S.dimStatus = null;
      if (S.camView) S.camView.video.play().catch(() => {});
    }
  }
  function syncDim() {
    if (!S.dimStatus) return;
    S.dimStatus.textContent = `攝影機運作中・${CHIP[chipKey()]}${S.phase === 'connected' ? '，畫面持續傳送' : ''}`;
  }

  /* =====================================================================
   * Small UI pieces
   * ===================================================================== */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      ui.toast('已複製，貼到另一台就可以了');
      return;
    } catch (e) { /* fall back to a hidden textarea */ }
    const ta = h('textarea', { readonly: true, class: 'mon-copy-helper', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    ui.toast(ok ? '已複製，貼到另一台就可以了' : '請長按代碼，選「全選」再「拷貝」');
  }

  async function pasteInto(ta, submit) {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) {
        ta.value = t;
        ta.dispatchEvent(new Event('input'));
        if (CODE_RE.test(t.replace(/\s+/g, ''))) submit(t);
        return;
      }
    } catch (e) { /* no clipboard permission */ }
    ta.focus();
    ui.toast('請長按輸入框，選「貼上」');
  }

  function shareLine(kind, code) {
    const text = kind === 'offer'
      ? `【看寶寶】攝影機配對碼\n在要用來看的手機打開「看寶寶」→「這台用來看」，把整段訊息貼上：\n${code}\n（只能用一次，請不要轉傳給別人）`
      : `【看寶寶】回覆碼\n回到攝影機那台，在第 3 步貼上整段訊息：\n${code}\n（只能用一次）`;
    window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  function inputErr(kind) {
    S.inputError = kind;
    if (S.phase === 'answer') S.phase = 'idle';
    paint();
    const ta = S.slots && S.slots.body.querySelector('.mon-code-in');
    if (ta) ta.focus();
  }

  const spinner = (text) => h('div', { class: 'mon-wait', role: 'status' }, h('span', { class: 'mon-spin', 'aria-hidden': 'true' }), text);
  const errorBox = (kind) => h('div', { class: 'mon-alert', role: 'alert' }, h('strong', null, ERR[kind][0]), h('p', null, ERR[kind][1]));

  function codeBox(code, kind) {
    const name = kind === 'offer' ? '配對碼' : '回覆碼';
    return h('div', { class: 'mon-codebox' },
      h('div', {
        class: 'mon-code mon-code-out', tabindex: '0', role: 'textbox', 'aria-readonly': 'true', 'aria-label': name, dataset: { kind },
      }, code),
      h('div', { class: 'mon-btnrow' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => copyText(code) }, ic('copy'), `複製${name}`),
        h('button', { type: 'button', class: 'btn btn-ghost mon-line', onclick: () => shareLine(kind, code) }, h('span', { class: 'ic mon-line-ic', html: ui.ICONS.line }), '傳到 LINE')),
      h('p', { class: 'tiny faint' }, `共 ${code.length} 個字，要整段一起傳；只能用一次。`));
  }

  function codeInput({ label, placeholder, submitLabel, busy, onSubmit }) {
    const errId = 'mon-code-err';
    const ta = h('textarea', {
      class: 'mon-code mon-code-in', rows: '3', placeholder, 'aria-label': label, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      'aria-invalid': S.inputError ? 'true' : null, 'aria-describedby': S.inputError ? errId : null,
    });
    ta.value = S.draft;
    const err = h('p', { class: 'mon-err', id: errId, role: 'alert' }, S.inputError ? CODE_ERR[S.inputError] : '');
    err.hidden = !S.inputError;
    ta.addEventListener('input', () => {
      S.draft = ta.value;
      if (S.inputError) { S.inputError = null; err.hidden = true; ta.removeAttribute('aria-invalid'); ta.removeAttribute('aria-describedby'); }
    });
    // pasting a whole code (or LINE message) goes straight on — one less tap
    ta.addEventListener('paste', () => setTimeout(() => { if (CODE_RE.test(ta.value.replace(/\s+/g, ''))) onSubmit(ta.value); }, 0));
    return h('div', { class: 'mon-codebox' }, ta, err,
      h('div', { class: 'mon-btnrow' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => pasteInto(ta, onSubmit) }, ic('paste'), '貼上'),
        h('button', { type: 'button', class: 'btn btn-primary mon-submit', disabled: !!busy, onclick: () => onSubmit(ta.value) }, submitLabel)));
  }

  // steps: [{title, state:'done'|'current'|'todo', open, body, doneText}]
  const stepsCard = (title, steps, footer) => h('section', { class: 'card mon-steps-card' },
    h('div', { class: 'card-title' }, title),
    h('ol', { class: 'mon-steps' }, steps.map((st, i) => h('li', { class: `mon-step is-${st.state}`, 'aria-current': st.state === 'current' ? 'step' : null },
      h('span', { class: 'mon-step-num', 'aria-hidden': 'true' }, st.state === 'done' ? '✓' : String(i + 1)),
      h('div', { class: 'mon-step-title' }, h('span', { class: 'mon-sr' }, `第 ${i + 1} 步${st.state === 'done' ? '（完成）' : ''}：`), st.title),
      st.open ? h('div', { class: 'mon-step-body' }, st.body) : (st.state === 'done' && st.doneText ? h('div', { class: 'mon-step-body small muted' }, st.doneText) : null)))),
    footer || null);

  function toggle({ label, sub, checked, disabled, onChange }) {
    const input = h('input', { type: 'checkbox', class: 'mon-switch', role: 'switch', checked: !!checked, disabled: !!disabled });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: `mon-toggle${disabled ? ' is-disabled' : ''}` },
      h('span', { class: 'mon-toggle-text' }, h('span', { class: 'mon-toggle-label' }, label), sub ? h('small', null, sub) : null), input);
  }

  const awakeToggle = () => {
    const ok = 'wakeLock' in navigator;
    const sub = !ok ? '這個瀏覽器不支援，請到手機設定暫時關掉「自動鎖定」'
      : S.role === 'camera' ? '攝影機這台的螢幕不會自動關掉（請插著充電）' : '看的時候螢幕不會自動關掉，哭聲提醒才不會停';
    return toggle({
      label: '螢幕保持常亮', sub, checked: ok && prefs.awake, disabled: !ok,
      onChange: (on) => { prefs.awake = on; savePrefs(); if (on) keepAwake(); else releaseAwake(); },
    });
  };

  function meterParts(label) {
    const fill = h('span', { class: 'mon-meter-fill' });
    const mark = h('span', { class: 'mon-meter-mark', 'aria-hidden': 'true' });
    const meter = h('span', {
      class: 'mon-meter', role: 'meter', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
    }, fill, mark);
    const meterWord = h('span', { class: 'mon-meter-word' }, '安靜');
    const meterRow = h('div', { class: 'mon-meter-row' }, h('span', { class: 'mon-meter-label', 'aria-hidden': 'true' }, label.slice(-2)), meter, meterWord);
    return { fill, mark, meter, meterWord, meterRow };
  }

  /* =====================================================================
   * Players (persistent while a session lives, so fullscreen / video playback survive repaints)
   * ===================================================================== */
  function viewerStage() {
    if (S.view) return S.view;
    const video = h('video', { class: 'mon-video', playsinline: true, autoplay: true, muted: true, 'aria-label': '寶寶即時畫面' });
    video.muted = true;
    video.playsInline = true;
    const phIcon = h('span', { class: 'mon-ph-icon', 'aria-hidden': 'true' });
    const phTitle = h('strong');
    const phText = h('span', { class: 'small' });
    const ph = h('div', { class: 'mon-placeholder' }, phIcon, phTitle, phText);
    const badge = h('span', { class: 'mon-badge is-live' }, h('span', { class: 'mon-dot', 'aria-hidden': 'true' }), '即時');
    const time = h('span', { class: 'mon-time num', 'aria-label': '已連線時間' });
    const muteBtn = h('button', { type: 'button', class: 'mon-ctl mon-ctl-sound', onclick: toggleSound });
    const fsBtn = h('button', { type: 'button', class: 'mon-ctl mon-ctl-fs', onclick: toggleFullscreen });
    const reBtn = h('button', { type: 'button', class: 'mon-ctl mon-ctl-retry', onclick: () => resetViewer(true) }, ic('retry'), h('span', null, '重新連線'));
    const controls = h('div', { class: 'mon-controls' }, muteBtn, fsBtn, reBtn);
    const meter = meterParts('寶寶房間聲音');
    const cry = h('div', { class: 'mon-cry', role: 'alert', hidden: true },
      h('span', { class: 'mon-cry-ico', 'aria-hidden': 'true' }, '👶'),
      h('div', { class: 'grow' }, h('strong', null, '寶寶可能在哭'), h('div', { class: 'small' }, '聲音持續變大超過 3 秒')),
      h('button', { type: 'button', class: 'mon-cry-ok', onclick: hideCry }, '我知道了'));
    const el = h('section', { class: 'mon-player', 'aria-label': '攝影機畫面' },
      h('div', { class: 'mon-screen' }, video, ph, badge, time), controls, meter.meterRow, cry);
    S.view = { el, video, ph, phIcon, phTitle, phText, badge, time, muteBtn, fsBtn, reBtn, controls, cry, ...meter };
    return S.view;
  }

  const PH = {
    idle: ['📹', '還沒有畫面', '照下面 3 個步驟和攝影機配對'],
    answer: ['⏳', '正在準備…', ''],
    waiting: ['⏳', '等攝影機那台貼上回覆碼…', '貼好按「連線」，畫面就會出現在這裡'],
    disconnected: ['📶', '訊號不穩，正在等它恢復…', '請確認兩台都還連著同一個 Wi-Fi'],
    failed: ['⚠️', '連線中斷了', '按下面的「重新連線」，兩台再配對一次'],
    ended: ['📷', '攝影機那台已經關閉', '要再看，請重新配對'],
    error: ['⚠️', '沒辦法開始', '請看下面的說明'],
  };

  function syncViewerStage() {
    const v = S.view;
    const live = S.phase === 'connected';
    v.badge.hidden = !live;
    v.time.hidden = !live;
    if (live && S.connectedAt) v.time.dataset.clock = S.connectedAt;
    else { delete v.time.dataset.clock; v.time.textContent = ''; }
    const ph = PH[S.phase];
    v.ph.hidden = live;
    v.ph.classList.toggle('is-over', S.phase === 'disconnected');
    if (ph) { [v.phIcon.textContent, v.phTitle.textContent, v.phText.textContent] = ph; }
    v.controls.hidden = !isLive();
    v.meterRow.hidden = !isLive();
    v.muteBtn.replaceChildren(ic(S.muted ? 'soundOff' : 'soundOn'), h('span', null, S.muted ? '開聲音' : '靜音'));
    const fs = isFs();
    v.fsBtn.replaceChildren(ic(fs ? 'shrink' : 'expand'), h('span', null, fs ? '離開全螢幕' : '全螢幕'));
    v.mark.hidden = !prefs.cry;
    v.mark.style.left = `${SENS[prefs.sens].thr}%`;
    v.el.classList.toggle('is-live', live);
    renderMeter();
  }

  function cameraStage() {
    if (S.camView) return S.camView;
    const video = h('video', { class: 'mon-video', playsinline: true, autoplay: true, muted: true, 'aria-label': '攝影機預覽畫面' });
    video.muted = true;
    video.playsInline = true;
    const badgeText = h('span', null, '預覽');
    const badge = h('span', { class: 'mon-badge' }, h('span', { class: 'mon-dot', 'aria-hidden': 'true' }), badgeText);
    const flip = h('button', { type: 'button', class: 'mon-ctl mon-ctl-flip', onclick: flipCamera }, ic('flip'), h('span', null, '切換鏡頭'));
    const dim = h('button', { type: 'button', class: 'mon-ctl mon-ctl-dim', onclick: () => setDim(true) }, ic('moon'), h('span', null, '省電黑畫面'));
    const stop = h('button', { type: 'button', class: 'mon-ctl mon-ctl-stop', onclick: stopCamera }, ic('stop'), h('span', null, '關閉攝影機'));
    const meter = meterParts('攝影機收音');
    const el = h('section', { class: 'mon-player mon-player-cam', 'aria-label': '攝影機預覽' },
      h('div', { class: 'mon-screen' }, video, badge), h('div', { class: 'mon-controls' }, flip, dim, stop), meter.meterRow);
    S.camView = { el, video, badge, badgeText, flip, dim, stop, ...meter };
    return S.camView;
  }

  function syncCameraStage() {
    const c = S.camView;
    const live = S.phase === 'connected';
    if (c.video.srcObject !== S.localStream) c.video.srcObject = S.localStream;
    if (!S.dimEl && c.video.paused) c.video.play().catch(() => {});
    c.video.classList.toggle('is-mirror', prefs.facing === 'user');
    c.badge.classList.toggle('is-live', live);
    c.badgeText.textContent = live ? '傳送中' : '預覽（還沒傳送）';
    c.flip.hidden = S.camCount === 1;
    c.flip.disabled = S.flipping;
    c.meterRow.hidden = S.noMic;
    c.mark.hidden = true;
    renderMeter();
  }

  function updateStage() {
    if (!alive()) return;
    const slot = S.slots.stage;
    const want = S.role === 'viewer' ? viewerStage() : (S.localStream ? cameraStage() : null);
    if (want ? slot.firstChild !== want.el : slot.firstChild) {
      slot.innerHTML = '';
      if (want) slot.append(want.el);
    }
    if (S.role === 'viewer') syncViewerStage();
    else if (want) syncCameraStage();
  }

  /* =====================================================================
   * Screen sections
   * ===================================================================== */
  function roleBar() {
    const seg = ui.seg([
      { value: 'camera', label: '這台當攝影機', icon: '📷' },
      { value: 'viewer', label: '這台用來看', icon: '👀' },
    ], S.role, setRole);
    seg.classList.add('mon-role');
    seg.setAttribute('aria-label', '這台裝置要做什麼');
    return seg;
  }

  async function setRole(role) {
    if (role === S.role) return;
    if ((S.localStream || S.pc) && !(await ui.confirm('切換用途會關掉目前的攝影機或連線，確定嗎？', { ok: '切換' }))) { paint(); return; }
    resetSession();
    S.role = role;
    prefs.role = role;
    savePrefs();
    paint();
  }

  const statusRow = () => {
    const k = chipKey();
    return h('div', { class: 'mon-statusrow', role: 'status', 'aria-live': 'polite' },
      h('span', { class: `mon-chip is-${k}` }, h('span', { class: 'mon-dot', 'aria-hidden': 'true' }), CHIP[k]),
      h('span', { class: 'mon-status-text' }, statusText()));
  };

  const liveCard = (title, sub, tip) => h('section', { class: 'card mon-live-card' },
    h('div', { class: 'row gap' },
      h('span', { class: 'mon-live-ico', 'aria-hidden': 'true' }, '✅'),
      h('div', { class: 'grow' },
        h('div', { class: 'card-title' }, title),
        h('div', { class: 'card-sub' }, sub, '・已連線 ', h('span', { class: 'num', 'data-clock': S.connectedAt || new Date().toISOString() }, '00:00')))),
    tip ? h('p', { class: 'tiny faint mon-live-tip' }, tip) : null);

  function brokenCard() {
    const cam = S.role === 'camera';
    let title;
    let text;
    if (S.phase === 'ended') {
      [title, text] = cam ? ['看的那支手機已經離開', '要再看的話，按下面的按鈕產生新的配對碼，再走一次 3 個步驟。']
        : ['攝影機那台已經關閉', '請在攝影機那台重新開啟，再配對一次。'];
    } else if (S.phase === 'disconnected') {
      [title, text] = ['訊號不穩', '正在等它自動恢復…如果一直沒恢復，請重新配對。'];
    } else {
      title = S.failReason === 'timeout' ? '連不上' : '連線中斷了';
      text = '請確認兩台連的是「同一個」Wi-Fi（不能一台用 4G），再重新配對一次。';
    }
    return h('section', { class: `card mon-broken${S.phase === 'disconnected' ? ' is-soft' : ''}` },
      h('div', { class: 'card-title' }, S.phase === 'disconnected' ? '📶 ' : '⚠️ ', title),
      h('p', { class: 'small muted' }, text),
      h('div', { class: 'mon-btnrow' },
        h('button', {
          type: 'button', class: `btn ${S.phase === 'disconnected' ? 'btn-ghost' : 'btn-primary'}`, onclick: cam ? makeOffer : () => resetViewer(false),
        }, ic('retry'), cam ? '重新產生配對碼' : '重新連線'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: helpSheet }, '連不上怎麼辦？')));
  }

  function cameraBody() {
    const p = S.phase;
    const has = !!S.localStream;
    const out = [];
    if (p === 'connected') {
      out.push(liveCard('已連線，對方看得到畫面', `${S.peerName ? `${S.peerName}的手機` : '看的手機'}正在看`, '可以按「省電黑畫面」讓螢幕變黑，影像會繼續傳送。'));
    } else if (['disconnected', 'failed', 'ended'].includes(p)) {
      out.push(brokenCard());
    } else {
      const pairing = p === 'waiting' || p === 'connecting';
      const s1Body = [
        h('p', { class: 'small muted' }, '把這台放在寶寶床邊（離床 1 公尺以上、寶寶碰不到的地方），插上充電線，鏡頭對準寶寶。'),
        S.error && !has ? errorBox(S.error) : null,
        h('button', { type: 'button', class: 'btn btn-primary btn-block mon-start', disabled: p === 'starting', onclick: startCamera },
          ic('camera'), p === 'starting' ? '開啟中…' : (S.error ? '再試一次' : '開啟攝影機')),
      ];
      let s2Body;
      if (p === 'offer') s2Body = spinner('正在產生配對碼…');
      else if (S.error && has) s2Body = [errorBox(S.error), h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: makeOffer }, ic('retry'), '再試一次')];
      else if (S.code) {
        s2Body = [h('p', { class: 'small muted' }, '在看的那支手機打開「看寶寶」→ 選「這台用來看」，把這段配對碼傳過去。'), codeBox(S.code, 'offer')];
      }
      const s3Body = p === 'connecting' ? spinner('連線中…')
        : codeInput({
          label: '回覆碼', placeholder: '把看的那支手機給你的回覆碼貼在這裡（YJ 開頭）', submitLabel: '連線', onSubmit: acceptAnswer,
        });
      out.push(stepsCard('📷 3 步驟把這台變成攝影機', [
        {
          title: '開啟攝影機', state: has ? 'done' : 'current', open: !has, body: s1Body,
          doneText: S.noMic ? '已開啟（這台沒有麥克風，只傳畫面）' : '已開啟相機和麥克風',
        },
        { title: '把「配對碼」傳給看的那支手機', state: !has ? 'todo' : pairing ? 'done' : 'current', open: has && !!s2Body, body: s2Body },
        { title: '貼上對方的「回覆碼」', state: pairing ? 'current' : 'todo', open: pairing, body: s3Body },
      ], S.code && p === 'waiting'
        ? h('button', { type: 'button', class: 'link-btn mon-regen', onclick: makeOffer }, '配對碼弄丟了？重新產生')
        : null));
    }
    if (has) {
      out.push(h('section', { class: 'card' }, h('div', { class: 'card-title' }, '⚙️ 攝影機設定'), awakeToggle(),
        h('p', { class: 'tiny faint' }, '這個畫面要保持開著；鎖定螢幕或切到別的 App，鏡頭就會被系統關掉。')));
    } else {
      out.push(h('section', { class: 'card' },
        h('div', { class: 'card-title' }, '📍 擺放小撇步'),
        h('ul', { class: 'small tight mon-tips' },
          h('li', null, '找一支不用的舊手機或平板，跟看的手機連同一個 Wi-Fi。'),
          h('li', null, '放高一點、離床 1 公尺以上，電線收好，寶寶碰不到。'),
          h('li', null, '一直插著充電；晚上開小夜燈，畫面會比較清楚。'),
          h('li', null, '連上後可以用「省電黑畫面」，螢幕變黑但影像照常傳送。'))));
    }
    return out;
  }

  function viewerBody() {
    const p = S.phase;
    const out = [];
    if (isLive()) {
      if (p === 'connected') out.push(liveCard('已連上攝影機', '正在看即時畫面', '一開始是靜音，按「開聲音」才聽得到。'));
      else out.push(brokenCard());
      const sensRow = h('div', { class: 'mon-sens' },
        h('span', { class: 'small muted', id: 'mon-sens-label' }, '靈敏度'),
        ui.seg(Object.entries(SENS).map(([value, s]) => ({ value, label: s.label })), prefs.sens, (val) => { prefs.sens = val; savePrefs(); S.loud = 0; updateStage(); }));
      sensRow.lastChild.setAttribute('aria-labelledby', 'mon-sens-label');
      sensRow.hidden = !prefs.cry;
      out.push(h('section', { class: 'card' },
        h('div', { class: 'card-title' }, '🔔 提醒'),
        toggle({
          label: '哭聲提醒', sub: '聲音持續變大約 3 秒，就震動手機並跳出提醒', checked: prefs.cry,
          onChange: (on) => { prefs.cry = on; savePrefs(); sensRow.hidden = !on; if (!on) hideCry(); S.loud = 0; updateStage(); },
        }),
        sensRow,
        h('p', { class: 'tiny faint' }, '聲音條上的白線是提醒門檻：「高」連小聲哭都提醒，「低」大哭才提醒。手機鎖定或切到別的 App 時，提醒會暫停。'),
        h('hr', { class: 'divider' }),
        awakeToggle()));
      return out;
    }
    if (p === 'failed' || p === 'ended') { out.push(brokenCard()); return out; }
    const hasCode = !!S.code;
    const s1Body = [
      h('p', { class: 'small muted' }, '先在當攝影機的那台（例如舊手機）打開「看寶寶」→「這台當攝影機」→「開啟攝影機」，再把它給你的配對碼貼到下面。'),
      S.error ? errorBox(S.error) : null,
      codeInput({
        label: '配對碼', placeholder: '貼上攝影機的配對碼（YJ 開頭）', submitLabel: p === 'answer' ? '產生中…' : '產生回覆碼', busy: p === 'answer', onSubmit: acceptOffer,
      }),
    ];
    const s2Body = hasCode ? [h('p', { class: 'small muted' }, '把回覆碼傳回攝影機那台，貼在它的第 3 步，按「連線」。'), codeBox(S.code, 'answer')] : null;
    out.push(stepsCard('👀 3 步驟連上攝影機', [
      { title: '貼上攝影機的「配對碼」', state: hasCode ? 'done' : 'current', open: !hasCode, body: s1Body, doneText: '已讀取配對碼' },
      { title: '把「回覆碼」傳回攝影機那台', state: hasCode ? 'done' : 'todo', open: hasCode, body: s2Body },
      {
        title: '等畫面出現', state: hasCode ? 'current' : 'todo', open: hasCode,
        body: h('p', { class: 'small muted' }, '攝影機那台貼上回覆碼、按「連線」後，畫面會出現在上面。'),
      },
    ], hasCode ? h('button', { type: 'button', class: 'link-btn mon-regen', onclick: () => resetViewer(false) }, '貼錯了？重新開始') : null));
    return out;
  }

  const notesCard = () => h('section', { class: 'card soft mon-notes' },
    h('div', { class: 'card-title' }, '🔒 隱私與連線'),
    h('ul', { class: 'mon-notelist' },
      h('li', null, h('strong', null, '影像只在兩台裝置之間直接傳送，不經過伺服器、不會錄影或儲存。'), '畫面全程加密，從攝影機那台直接傳到看的手機。'),
      h('li', null, '📶 兩台要連同一個家用 Wi-Fi，在家裡最順。用 4G 或出門在外看，需要「中繼伺服器」，預計在之後的版本提供。'),
      h('li', null, '🔁 代碼每次都不一樣、只能用一次；連線中斷後要重新配對。')),
    h('p', { class: 'tiny faint' }, '看寶寶只是輔助，不能取代大人照顧，也不是醫療用的呼吸或心跳監測器。'));

  function helpSheet() {
    ui.sheet({
      title: '連不上怎麼辦？',
      body: h('ol', { class: 'mon-help' },
        h('li', null, '兩台都要連「同一個」Wi-Fi，不能一台用 4G／5G 行動網路。'),
        h('li', null, '不要連「訪客網路」。有些路由器開了「AP 隔離」，裝置之間會互相看不到，請改連主要的 Wi-Fi。'),
        h('li', null, '代碼只能用一次。中斷後，在攝影機那台按「重新產生配對碼」，再走一次 3 個步驟。'),
        h('li', null, '攝影機那台要保持這個畫面開著、插著充電，不要鎖定螢幕（可以用「省電黑畫面」）。'),
        h('li', null, 'iPhone、iPad 請用 Safari 開啟；Android 請用 Chrome。'),
        h('li', null, '看的手機一開始是靜音，按「開聲音」才聽得到。')),
    });
  }

  /* ---------- render ---------- */
  function paint() {
    if (!alive()) return;
    const { top, body } = S.slots;
    top.innerHTML = '';
    top.append(roleBar(), statusRow());
    updateStage();
    body.innerHTML = '';
    body.append(...(S.role === 'camera' ? cameraBody() : viewerBody()));
    syncDim();
    if (App.updateTickers) App.updateTickers();
  }

  App.screen('monitor', {
    title: '看寶寶',
    tab: 'health',
    liveUpdate: false,
    actions: () => [h('button', { type: 'button', class: 'icon-btn mon-help-btn', 'aria-label': '連不上怎麼辦', html: IC.help, onclick: helpSheet })],
    render(el) {
      S.root = el;
      S.slots = {
        top: h('div', { class: 'mon-top' }),
        stage: h('div', { class: 'mon-stage-slot' }),
        body: h('div', { class: 'mon-body' }),
        notes: notesCard(),
      };
      el.append(S.slots.top, S.slots.stage, S.slots.body, S.slots.notes);
      paint();
    },
    onLeave() {
      resetSession();
      if (S.audioCtx) { S.audioCtx.close().catch(() => {}); S.audioCtx = null; }
      S.root = null;
      S.slots = null;
    },
  });

  App.tool({
    id: 'monitor', title: '看寶寶', icon: '📹', desc: '舊手機變攝影機，同一個 Wi-Fi 即時看', stages: ['baby'], screen: 'monitor', order: 70, group: '工具',
  });
}());
