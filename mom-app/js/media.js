/* 易家做媽媽 — photos (ultrasound pictures, diary photos) kept on this phone, in their own IndexedDB database.
 * They never go into the main saved state (which has to stay small) and are never uploaded; a backup file carries
 * them along, and a family merge brings in the other phone's photos too.
 *   App.media.fromFile(file) -> compressed JPEG Blob     App.media.put(blob) -> id     App.media.url(id) -> object URL
 *   App.media.dataUrl(id)    App.media.del(id)           App.media.exportAll(ids) / importAll(map) for backups */
(function () {
  const App = window.App = window.App || {};
  const DB = /[?&]sandbox=1(&|$)/.test(location.search) ? 'yijia-mom-media-sandbox' : 'yijia-mom-media'; const STORE = 'blobs'; // 試玩 keeps its own photos
  let dbp = null;
  const db = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
        const rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE); };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  };
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const rq = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(rq ? rq.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    });
  };
  const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const urls = new Map();

  async function put(blob, id = newId()) { await run('readwrite', (s) => s.put(blob, id)); return id; }
  async function get(id) { try { return (await run('readonly', (s) => s.get(id))) || null; } catch (e) { return null; } }
  async function del(id) { if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); } try { await run('readwrite', (s) => s.delete(id)); } catch (e) { /* gone already */ } }
  async function keys() { try { return (await run('readonly', (s) => s.getAllKeys())) || []; } catch (e) { return []; } }
  async function url(id) {
    if (urls.has(id)) return urls.get(id);
    const b = await get(id); if (!b) return null;
    const u = URL.createObjectURL(b); urls.set(id, u); return u;
  }
  const blobToDataUrl = (b) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(b); });
  async function dataUrl(id) { const b = await get(id); return b ? blobToDataUrl(b) : null; }
  function dataUrlToBlob(d) {
    const [head, body] = String(d).split(',');
    const type = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(body); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
  }
  // phone photos are big: keep the long side at `max` px as a JPEG (an ultrasound picture ends up around 150–300 KB)
  async function fromFile(file, { max = 1600, quality = 0.82 } = {}) {
    const src = URL.createObjectURL(file);
    try {
      const im = await loadImage(src);
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return await new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', quality));
    } finally { URL.revokeObjectURL(src); }
  }
  // backups: { id: dataURL } for the photos the saved state points at
  async function exportAll(ids) {
    const out = {};
    for (const id of [...new Set(ids || await keys())]) { const d = await dataUrl(id); if (d) out[id] = d; }
    return out;
  }
  async function importAll(map) {
    let n = 0;
    for (const [id, d] of Object.entries(map || {})) {
      if (typeof d !== 'string' || !d.startsWith('data:image/')) continue;
      try { await put(dataUrlToBlob(d), id); n += 1; } catch (e) { /* skip a broken one */ }
    }
    return n;
  }
  // every photo id the saved state refers to (diary entries + prenatal visits + 寶寶月照)
  function referenced(state = App.store && App.store.state) {
    const ids = [];
    const p = (state && state.preg) || {};
    Object.values(p.visitNotes || {}).forEach((v) => (v && v.photos || []).forEach((id) => ids.push(id)));
    (p.diary || []).forEach((e) => (e.photos || []).forEach((id) => ids.push(id)));
    Object.values((state && state.monthly && state.monthly.babies) || {}).forEach((bs) => Object.values(bs || {}).forEach((sl) => { if (sl && sl.photo) ids.push(sl.photo); }));
    return ids;
  }

  // every photo gone (清除所有資料); photos nothing points at any more (after loading demo data or a full restore)
  async function clear() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); try { await run('readwrite', (s) => s.clear()); } catch (e) { /* nothing stored */ } }
  async function prune(keep = referenced()) {
    const k = new Set(keep); let n = 0;
    for (const id of await keys()) if (!k.has(id)) { await del(id); n += 1; }
    return n;
  }
  async function stats() {
    let count = 0; let bytes = 0;
    try { const all = await run('readonly', (s) => s.getAll()); (all || []).forEach((b) => { count += 1; bytes += b && b.size ? b.size : 0; }); } catch (e) { /* none */ }
    return { count, bytes };
  }
  // 清除所有資料 = everything, ultrasound photos included (they are private)
  if (App.store && typeof App.store.reset === 'function' && !App.store.reset.__media) {
    const reset = App.store.reset;
    App.store.reset = function (...a) { const r = reset.apply(this, a); clear(); return r; };
    App.store.reset.__media = true;
  }

  App.media = { put, get, del, keys, url, dataUrl, fromFile, exportAll, importAll, referenced, loadImage, blobToDataUrl, clear, prune, stats };
}());
