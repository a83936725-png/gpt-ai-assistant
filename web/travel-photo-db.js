// The traveller's own photos (check-ins, album pages, bulk uploads) live in IndexedDB on this device:
// a full image (longest side 1600px) and a thumbnail per photo, with the date and place read from EXIF,
// so a stack of holiday photos can sort itself into the right trips.
(function photoDb() {
  const DB_NAME = 'travel-photos';
  const STORE = 'photos';
  let dbp = null;

  const open = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('indexedDB')); return; }
        const req = window.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  };
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
  };
  const all = () => run('readonly', (s) => s.getAll());
  const put = (rec) => run('readwrite', (s) => s.put(rec));
  const del = (id) => run('readwrite', (s) => s.delete(id));

  // ---------- EXIF: the date a photo was taken and where (JPEG only; other formats just skip this)
  function parseTiff(v, start) {
    const le = v.getUint16(start) === 0x4949;
    const u16 = (p) => v.getUint16(p, le);
    const u32 = (p) => v.getUint32(p, le);
    const ifd = (offset) => {
      const tags = {};
      const p = start + offset;
      if (p + 2 > v.byteLength) return tags;
      const n = u16(p);
      for (let i = 0; i < n; i += 1) {
        const e = p + 2 + i * 12;
        if (e + 12 > v.byteLength) break;
        tags[u16(e)] = e;
      }
      return tags;
    };
    const ascii = (e) => {
      const count = u32(e + 4);
      const p = count > 4 ? start + u32(e + 8) : e + 8;
      let s = '';
      for (let i = 0; i < count - 1 && p + i < v.byteLength; i += 1) s += String.fromCharCode(v.getUint8(p + i));
      return s;
    };
    const degrees = (e) => {
      const p = start + u32(e + 8);
      let out = 0;
      [1, 60, 3600].forEach((div, i) => {
        const den = u32(p + i * 8 + 4);
        out += den ? u32(p + i * 8) / den / div : 0;
      });
      return out;
    };
    const out = {};
    try {
      const ifd0 = ifd(u32(start + 4));
      if (ifd0[0x8769]) {
        const ex = ifd(u32(ifd0[0x8769] + 8));
        const e = ex[0x9003] || ex[0x9004];
        if (e) out.taken = ascii(e);
      }
      if (!out.taken && ifd0[0x0132]) out.taken = ascii(ifd0[0x0132]);
      if (ifd0[0x8825]) {
        const g = ifd(u32(ifd0[0x8825] + 8));
        if (g[2] && g[4]) {
          let lat = degrees(g[2]);
          let lng = degrees(g[4]);
          if (g[1] && ascii(g[1]) === 'S') lat = -lat;
          if (g[3] && ascii(g[3]) === 'W') lng = -lng;
          if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            out.lat = Math.round(lat * 1e5) / 1e5;
            out.lng = Math.round(lng * 1e5) / 1e5;
          }
        }
      }
    } catch { /* a partial or unusual EXIF block: keep what was read */ }
    const m = (out.taken || '').match(/^(\d{4}):(\d\d):(\d\d)/);
    out.taken = m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : null;
    return out;
  }
  function readExif(buffer) {
    const v = new DataView(buffer);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return {};
    let o = 2;
    while (o + 10 < v.byteLength) {
      const marker = v.getUint16(o);
      if (Math.floor(marker / 256) !== 0xFF || marker === 0xFFDA) break;
      const len = v.getUint16(o + 2);
      if (marker === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return parseTiff(v, o + 10);
      o += 2 + len;
    }
    return {};
  }

  // ---------- resizing (browsers apply the EXIF rotation when drawing, so portraits stay upright)
  const loadImage = (blob) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => resolve({ im, url });
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    im.src = url;
  });
  const toJpeg = (cv, quality) => new Promise((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality);
  });
  async function scaled(im, max, quality) {
    const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(im.naturalWidth * s));
    cv.height = Math.max(1, Math.round(im.naturalHeight * s));
    const x = cv.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, cv.width, cv.height);
    x.drawImage(im, 0, 0, cv.width, cv.height);
    return { blob: await toJpeg(cv, quality), w: cv.width, h: cv.height };
  }
  /** A picked file or camera shot → { full, thumb, w, h, taken, lat, lng, fileDate } */
  async function prepare(file) {
    const head = await file.slice(0, 256 * 1024).arrayBuffer().catch(() => null);
    const exif = head ? readExif(head) : {};
    const { im, url } = await loadImage(file);
    try {
      const full = await scaled(im, 1600, 0.82);
      const thumb = await scaled(im, 420, 0.72);
      return {
        full: full.blob,
        thumb: thumb.blob,
        w: full.w,
        h: full.h,
        taken: exif.taken || null,
        lat: exif.lat ?? null,
        lng: exif.lng ?? null,
        fileDate: file.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : null,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const fromDataUrl = async (src) => (await fetch(src)).blob();
  const usage = async () => (navigator.storage?.estimate ? navigator.storage.estimate().catch(() => null) : null);
  // Ask the browser not to clear these photos when space runs low.
  const persist = () => (navigator.storage?.persist ? navigator.storage.persist().catch(() => false) : Promise.resolve(false));

  window.TravelPhotoDB = {
    all, put, del, prepare, readExif, fromDataUrl, usage, persist,
  };
}());
