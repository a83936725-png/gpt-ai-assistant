/* 旅圖 eSIM：寫實世界地圖。
 * 平面：NASA Blue Marble 衛星影像（麥卡托）＋ d3 國界；3D：WebGL 把同一張影像貼在地球上，可拖曳旋轉。
 * 兩種模式共用一層 HTML：中文國名、去過的國旗、照片圖釘（同國多趟會合併）、放大後的推薦景點照片。 */
(function travelMap(global) {
  const { d3 } = global;
  const GEO = global.TRAVEL_GEO || {};
  const R2D = 180 / Math.PI;
  const MERC_TOP = 84;
  const MERC_BOTTOM = -57;
  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const SPAN = mercY(MERC_TOP) - mercY(MERC_BOTTOM);
  const REDUCED = global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dpr = () => Math.min(2, global.devicePixelRatio || 1);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  // Ocean names: two Pacific labels on the flat map (it sits at both edges), one on the globe.
  const OCEANS = [
    ['太平洋', -150, 8, 'both'], ['太平洋', 160, 22, 'flat'], ['大西洋', -38, 28, 'both'], ['大西洋', -18, -22, 'both'],
    ['印度洋', 78, -22, 'both'], ['北冰洋', 20, 80, 'globe'], ['南冰洋', 60, -62, 'globe'],
  ];

  const VERT = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
  // Each pixel inside the disc is turned back into a longitude/latitude and looked up in the texture.
  const FRAG = `precision highp float;
uniform sampler2D tex; uniform vec2 center; uniform float radius; uniform vec2 rot;
void main() {
  vec2 q = (gl_FragCoord.xy - center) / radius;
  float d = length(q);
  if (d > 1.0) discard;
  float z = sqrt(1.0 - d * d);
  vec3 v = vec3(q.x, q.y, z);
  float cp = cos(rot.y); float sp = sin(rot.y);
  vec3 a = vec3(v.x, v.y * cp + v.z * sp, -v.y * sp + v.z * cp);
  float cl = cos(rot.x); float sl = sin(rot.x);
  vec3 w = vec3(a.x * cl + a.z * sl, a.y, -a.x * sl + a.z * cl);
  float lon = atan(w.x, w.z);
  float lat = asin(clamp(w.y, -1.0, 1.0));
  vec3 col = texture2D(tex, vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.1415927)).rgb;
  float light = max(dot(v, normalize(vec3(-0.45, 0.5, 0.75))), 0.0);
  col *= 0.5 + 0.7 * light;
  col = mix(col, vec3(0.5, 0.74, 1.0), pow(1.0 - z, 2.6) * 0.55);
  float edge = smoothstep(1.0, 1.0 - 2.5 / radius, d);
  gl_FragColor = vec4(col * edge, edge);
}`;

  function createMap(root, hooks) {
    root.innerHTML = `<div class="tm-map">
      <div class="tm-glow"></div><div class="tm-base"></div><div class="tm-labels" aria-hidden="true"></div><div class="tm-pins"></div>
      <span class="tm-credit">衛星影像 NASA Blue Marble</span><div class="tm-hint" aria-live="polite"></div></div>`;
    const box = root.querySelector('.tm-map');
    const base = box.querySelector('.tm-base');
    const labelLayer = box.querySelector('.tm-labels');
    const pinLayer = box.querySelector('.tm-pins');
    const glow = box.querySelector('.tm-glow');
    const hintBox = box.querySelector('.tm-hint');
    const bubble = document.createElement('button'); // the "推薦" bubble over a photo while the globe idles
    bubble.type = 'button';
    bubble.className = 'tm-bubble';
    const st = {
      mode: 'globe', data: null, w: 0, h: 0, settleTimer: 0, frame: 0, labels: [], clusters: [], recs: [], sights: [], sel: null, world: [], worldOn: true, worldNodes: [], focus: null, expanded: false, inset: 0,
      // flat
      svg: null, g: null, proj: null, zoom: null, t: d3.zoomIdentity, W0: 0, H0: 0, img: null, hiRes: false,
      // globe
      rot: [-121, -18], k: 1, gproj: d3.geoOrthographic().clipAngle(90).precision(0.6), gl: null, glCanvas: null, ov: null, ctx: null, tex: null, texSize: 0, anim: 0, vel: null,
    };
    const colors = () => hooks.colors();

    // ---------- gestures. In the page, one finger and the mouse wheel scroll the page (a map this tall would
    // otherwise trap it); the map takes two fingers, a mouse drag, or Ctrl/⌘ + wheel (also a trackpad pinch).
    // Full screen takes every gesture.
    let hintTimer = 0;
    function hint(text) {
      hintBox.textContent = text;
      hintBox.classList.add('show');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hintBox.classList.remove('show'), 1600);
    }
    const gestures = (e) => {
      if (st.expanded) return !e.button;
      if (e.type === 'wheel') {
        if (e.ctrlKey || e.metaKey) return true;
        hint('按住 Ctrl（Mac 用 ⌘）再滾動可縮放地圖');
        return false;
      }
      if (e.type === 'touchstart') return e.touches.length > 1;
      return !e.button && !e.ctrlKey;
    };
    let touchFrom = null;
    box.addEventListener('touchstart', (e) => { touchFrom = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
    box.addEventListener('touchmove', (e) => {
      if (st.expanded || !touchFrom || e.touches.length !== 1) return;
      const dx = Math.abs(e.touches[0].clientX - touchFrom[0]);
      const dy = Math.abs(e.touches[0].clientY - touchFrom[1]);
      if (dx > 24 && dx > dy * 1.2) { touchFrom = null; hint('用兩指轉動地圖，或按右上角 ⤢ 全螢幕'); }
    }, { passive: true });

    // ---------- shared projection helpers
    const baseR = () => Math.min(st.w, st.h) * 0.43;
    // Vertical middle of the visible map: a card over its bottom (st.inset px) pushes the globe up.
    const midY = () => (st.h - st.inset) / 2;
    function screen(lng, lat) {
      if (st.mode === 'flat') {
        const p = st.proj([lng, lat]);
        return [st.t.applyX(p[0]), st.t.applyY(p[1])];
      }
      const center = [-st.rot[0], -st.rot[1]];
      if (d3.geoDistance([lng, lat], center) > Math.PI / 2 - 0.06) return null;
      return st.gproj([lng, lat]);
    }
    // Kilometres to screen pixels near a point, used to decide whether a country is big enough for its name.
    function pxPerKm(lat) {
      if (st.mode === 'flat') return (st.proj.scale() * st.t.k) / (6371 * Math.cos((lat * Math.PI) / 180));
      return (baseR() * st.k) / 6371;
    }
    const inView = (p, m = 40) => p && p[0] > -m && p[1] > -m && p[0] < st.w + m && p[1] < st.h + m;

    // ---------- flat map (SVG)
    // zoom.transform does not keep the view inside the map by itself, so every programmatic move goes through this.
    const clamp = (t) => st.zoom.constrain()(t, [[0, 0], [st.w, st.h]], [[0, 0], [st.W0, st.H0]]);
    function buildFlat(view) {
      const { w, h } = st;
      const s = Math.max(w / (2 * Math.PI), h / SPAN);
      st.W0 = 2 * Math.PI * s;
      st.H0 = s * SPAN;
      st.proj = d3.geoMercator().scale(s).translate([st.W0 / 2, s * mercY(MERC_TOP)]);
      const path = d3.geoPath(st.proj);
      const { data } = st;
      base.innerHTML = '';
      const svg = d3.select(base).append('svg').attr('width', w).attr('height', h).attr('role', 'img').attr('aria-label', '世界旅遊足跡衛星地圖');
      const g = svg.append('g');
      st.hiRes = w * dpr() > 1400;
      st.img = g.append('image').attr('href', `travel-earth/merc-${st.hiRes ? 4096 : 2048}.webp`).attr('width', st.W0).attr('height', st.H0).attr('preserveAspectRatio', 'none');
      g.append('g').selectAll('path').data(data.features).join('path')
        .attr('class', (f) => `tm-land ${data.visits.get(f.id) || ''} ${f.id === data.home.n ? 'home' : ''} ${st.sel && st.sel.id === f.id ? 'sel' : ''}`)
        .attr('d', path)
        .on('click', (e, f) => { ripple(e); hooks.onCountry(f.id); });
      g.append('path').attr('class', 'tm-border').attr('d', path(data.borders));
      const arcs = g.append('g');
      data.arcs.forEach(([a, b, cls]) => arcs.append('path').attr('class', `tm-arc ${cls}`).attr('d', path({ type: 'LineString', coordinates: [a, b] })));
      st.svg = svg; st.g = g;
      st.zoom = d3.zoom().filter(gestures).scaleExtent([1, 14]).extent([[0, 0], [w, h]]).translateExtent([[0, 0], [st.W0, st.H0]])
        .on('zoom', (e) => {
          st.t = e.transform;
          g.attr('transform', st.t);
          if (!st.hiRes && st.t.k > 1.6) { st.hiRes = true; st.img.attr('href', 'travel-earth/merc-4096.webp'); }
          place();
          settleSoon();
        });
      d3.select(box).on('.zoom', null).call(st.zoom).on('dblclick.zoom', null);
      // Keep looking at the same place when the map is rebuilt (new data, full screen); otherwise start near home.
      const c = st.proj(view ? view.center : [data.home.lng + 12, 28]);
      d3.select(box).call(st.zoom.transform, clamp(d3.zoomIdentity.translate(w / 2, h / 2).scale(view ? view.k : 1).translate(-c[0], -c[1])));
    }

    // ---------- globe (WebGL texture + canvas overlay)
    function initGl(canvas) {
      const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) return null;
      const shader = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null; };
      const vs = shader(gl.VERTEX_SHADER, VERT);
      const fs = shader(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      return {
        gl, u: { center: gl.getUniformLocation(prog, 'center'), radius: gl.getUniformLocation(prog, 'radius'), rot: gl.getUniformLocation(prog, 'rot') }, max: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      };
    }
    function loadTexture(size) {
      if (!st.gl || st.texSize >= size || st.gl.max < size) return;
      st.texSize = size;
      const img = new Image();
      img.onload = () => {
        const { gl } = st.gl;
        if (!st.tex) st.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, st.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        st.texReady = true;
        draw();
      };
      img.src = `travel-earth/earth-${size}.webp`;
    }
    function buildGlobe() {
      const { w, h } = st;
      const ratio = dpr();
      if (!st.glCanvas) {
        st.glCanvas = document.createElement('canvas');
        st.glCanvas.className = 'tm-gl';
        st.ov = document.createElement('canvas');
        st.ov.className = 'tm-ov';
        st.ctx = st.ov.getContext('2d');
        st.gl = initGl(st.glCanvas);
        loadTexture(2048);
      }
      [st.glCanvas, st.ov].forEach((cv) => { cv.width = Math.round(w * ratio); cv.height = Math.round(h * ratio); });
      base.replaceChildren(st.glCanvas, st.ov);
      let last = null;
      let lastMid = null;
      let moved = [];
      const spin = (dx, dy) => {
        const f = R2D / (baseR() * st.k);
        st.rot = [st.rot[0] + dx * f, Math.max(-85, Math.min(85, st.rot[1] - dy * f))];
        moved.push([performance.now(), dx, dy]);
      };
      st.zoom = d3.zoom().filter(gestures).scaleExtent([0.85, 9])
        .on('start', (e) => { last = e.transform; lastMid = null; moved = []; cancelAnimationFrame(st.anim); touched(e.sourceEvent); })
        .on('zoom', (e) => {
          const t = e.transform;
          const touches = e.sourceEvent?.touches;
          if (touches && touches.length > 1) {
            // Two fingers: their midpoint turns the globe while their spread zooms it.
            const mid = [(touches[0].clientX + touches[1].clientX) / 2, (touches[0].clientY + touches[1].clientY) / 2];
            if (lastMid) spin(mid[0] - lastMid[0], mid[1] - lastMid[1]);
            lastMid = mid;
          } else {
            lastMid = null;
            if (last && t.k === last.k) spin(t.x - last.x, t.y - last.y);
          }
          st.k = t.k;
          last = t;
          draw();
          settleSoon();
        })
        .on('end', () => {
          // A flick keeps the globe turning for a moment.
          const now = performance.now();
          const recent = moved.filter(([time]) => now - time < 90);
          if (REDUCED || recent.length < 2) return;
          let vx = recent.reduce((s, m) => s + m[1], 0) / recent.length;
          let vy = recent.reduce((s, m) => s + m[2], 0) / recent.length;
          const step = () => {
            vx *= 0.93; vy *= 0.93;
            if (Math.abs(vx) + Math.abs(vy) < 0.15) { settleSoon(); return; }
            const f = R2D / (baseR() * st.k);
            st.rot = [st.rot[0] + vx * f, Math.max(-85, Math.min(85, st.rot[1] - vy * f))];
            draw();
            st.anim = requestAnimationFrame(step);
          };
          st.anim = requestAnimationFrame(step);
        });
      d3.select(box).on('.zoom', null).call(st.zoom).on('dblclick.zoom', null);
      d3.select(box).property('__zoom', d3.zoomIdentity.scale(st.k));
      d3.select(st.ov).on('click', null).on('click', (e) => {
        const [x, y] = d3.pointer(e, st.ov);
        const ll = st.gproj.invert([x, y]);
        if (!ll || Math.hypot(x - st.w / 2, y - midY()) > baseR() * st.k) return;
        const f = st.data.features.find((ft) => d3.geoContains(ft, ll));
        if (f) { ripple(e); hooks.onCountry(f.id); }
      });
    }
    const syncGlobe = () => st.gproj.scale(baseR() * st.k).translate([st.w / 2, midY()]).rotate(st.rot);
    function drawGlobe() {
      const { w, h } = st;
      const ratio = dpr();
      const r = baseR() * st.k;
      syncGlobe();
      const cy = midY();
      glow.style.cssText = `width:${r * 2.36}px;height:${r * 2.36}px;left:${w / 2 - r * 1.18}px;top:${cy - r * 1.18}px`;
      if (st.gl && st.texReady) {
        const { gl, u } = st.gl;
        gl.viewport(0, 0, st.glCanvas.width, st.glCanvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(u.center, (w / 2) * ratio, st.glCanvas.height - cy * ratio);
        gl.uniform1f(u.radius, r * ratio);
        gl.uniform2f(u.rot, (-st.rot[0] * Math.PI) / 180, (-st.rot[1] * Math.PI) / 180);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (r * ratio > 650) loadTexture(4096);
      }
      const { ctx } = st;
      const { data } = st;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const path = d3.geoPath(st.gproj, ctx);
      const col = colors();
      if (!st.gl || !st.texReady) {
        // No WebGL (or the photo is still loading): a drawn globe instead of the satellite one.
        ctx.beginPath(); path({ type: 'Sphere' });
        const sea = ctx.createRadialGradient(w / 2 - r * 0.3, cy - r * 0.35, r * 0.1, w / 2, cy, r);
        sea.addColorStop(0, '#2d6fb7'); sea.addColorStop(1, '#0b2a55');
        ctx.fillStyle = sea; ctx.fill();
        ctx.beginPath(); path({ type: 'FeatureCollection', features: st.k > 2.2 ? data.features : data.lite }); ctx.fillStyle = '#5f7f4f'; ctx.fill();
      }
      const features = st.k > 2.2 ? data.features : data.lite;
      const byClass = {};
      features.forEach((f) => { const c = data.visits.get(f.id); if (c) (byClass[c] ||= []).push(f); });
      Object.entries(byClass).forEach(([cls, list]) => {
        const c = col[cls] || col.v25;
        ctx.beginPath(); list.forEach((f) => path(f));
        ctx.globalAlpha = 0.42; ctx.fillStyle = c; ctx.fill();
        ctx.globalAlpha = 1; ctx.lineWidth = 1.3; ctx.strokeStyle = c; ctx.setLineDash(cls === 'vsoon' ? [4, 3] : []); ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.beginPath(); path(st.k > 2.2 ? data.borders : data.bordersLite);
      ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(255,255,255,.38)'; ctx.stroke();
      const picked = st.sel && (features.find((f) => f.id === st.sel.id) || data.features.find((f) => f.id === st.sel.id));
      if (picked) {
        ctx.beginPath(); path(picked);
        ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fill();
        ctx.shadowColor = 'rgba(255,255,255,.9)'; ctx.shadowBlur = 10; ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.shadowBlur = 0;
      }
      data.arcs.forEach(([a, b, cls]) => {
        ctx.beginPath(); path({ type: 'LineString', coordinates: [a, b] });
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3.2; ctx.setLineDash([]); ctx.stroke();
        ctx.strokeStyle = col[cls] || col.v25; ctx.lineWidth = 1.5; ctx.setLineDash(cls === 'soon' ? [5, 4] : []); ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    // ---------- labels, pins (HTML, both modes)
    function placeEl(node, lng, lat) {
      const p = screen(lng, lat);
      const show = inView(p);
      node.classList.toggle('off', !show);
      // The translate property (not transform), so a pin's pop-in or hover scale happens where it stands.
      if (show) node.style.translate = `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`;
    }
    function place() {
      if (st.mode === 'globe') syncGlobe();
      st.labels.forEach((l) => placeEl(l.node, l.lng, l.lat));
      st.clusters.forEach((c) => placeEl(c.node, c.lng, c.lat));
      st.recs.forEach((r) => placeEl(r.node, r.lng, r.lat));
      st.sights.forEach((x) => placeEl(x.node, x.lng, x.lat));
      st.worldNodes.forEach((x) => placeEl(x.node, x.lng, x.lat));
      if (st.spot) {
        placeEl(bubble, st.spot.lng, st.spot.lat);
        if (!st.worldNodes.some((x) => x.key === st.spot.key)) { bubble.classList.remove('show'); st.spot = null; }
      }
      if (st.homeNode) placeEl(st.homeNode, st.data.home.lng, st.data.home.lat);
      if (st.focus) placeEl(st.focus.node, st.focus.lng, st.focus.lat);
    }
    function draw() {
      cancelAnimationFrame(st.frame);
      st.frame = requestAnimationFrame(() => {
        if (st.mode === 'globe') drawGlobe();
        place();
      });
    }
    function settleSoon() {
      clearTimeout(st.settleTimer);
      st.settleTimer = setTimeout(settle, 140);
    }
    function overlaps(box1, list) {
      return list.some((b) => box1[0] < b[2] && box1[2] > b[0] && box1[1] < b[3] && box1[3] > b[1]);
    }
    // Rebuilds what is shown once the map stops moving: names that fit, merged photo pins, nearby picks.
    function settle() {
      const { data } = st;
      if (!data) return;
      if (st.mode === 'globe') syncGlobe();
      const taken = [];
      // The tapped country's famous sights come first; new ones pop in one after another.
      const oldSights = new Map(st.sights.map((x) => [x.key, x]));
      st.sights = [];
      // The highlighted sight goes first so it is never hidden behind its neighbours.
      const order0 = st.sel ? [...st.sel.list].sort((a, b) => (b.i === st.sel.active) - (a.i === st.sel.active)) : [];
      order0.forEach((x, order) => {
        const p = screen(x.lng, x.lat);
        if (!inView(p, 0)) return;
        const rect = [p[0] - 23, p[1] - 52, p[0] + 23, p[1] + 18];
        if (overlaps(rect, taken)) return;
        taken.push(rect);
        const key = `${st.sel.code}:${x.i}:${x.photo ? 1 : 0}`; // a pin pops in again once its photo arrives
        let node = oldSights.get(key)?.node;
        oldSights.delete(key);
        if (!node) {
          node = document.createElement('button');
          node.type = 'button';
          node.className = 'tm-sight';
          node.dataset.pinSight = `${st.sel.code}:${x.i}`;
          node.style.setProperty('--d', `${order * 80}ms`);
          node.setAttribute('aria-label', x.name);
          node.innerHTML = `<span class="tm-ph">${x.photo ? `<img src="${esc(x.photo)}" alt="" referrerpolicy="no-referrer">` : ''}</span><small>${esc(x.name)}</small>`;
          pinLayer.appendChild(node);
        }
        node.classList.toggle('on', st.sel.active === x.i);
        st.sights.push({ ...x, key, node });
      });
      oldSights.forEach((x) => x.node.remove());
      // Photo pins: one per place, merged when they would overlap.
      const clusters = [];
      data.trips.forEach((t) => {
        const p = screen(t.lng, t.lat);
        if (!p) return;
        const near = clusters.find((c) => Math.hypot(c.p[0] - p[0], c.p[1] - p[1]) < 40);
        if (near) near.trips.push(t); else clusters.push({ p, trips: [t], lng: t.lng, lat: t.lat });
      });
      const keep = new Map(st.clusters.map((c) => [c.key, c]));
      st.clusters = clusters.map((c) => {
        const lead = c.trips[0];
        const key = `${lead.id}:${c.trips.length}:${lead.photo || ''}`;
        const old = keep.get(key);
        keep.delete(key);
        const node = old?.node || document.createElement('button');
        if (!old) {
          node.className = `tm-pin ${lead.cls}`;
          node.type = 'button';
          node.dataset.pin = c.trips.map((t) => t.id).join(',');
          node.setAttribute('aria-label', c.trips.length > 1 ? `${c.trips.length} 趟：${c.trips.map((t) => t.city).join('、')}` : `${lead.city} ${lead.date}`);
          node.innerHTML = `<span class="tm-ph">${lead.photo ? `<img src="${esc(lead.photo)}" alt="" referrerpolicy="no-referrer">` : `<b>${esc(lead.city.slice(0, 1))}</b>`}</span>
            ${lead.code ? `<img class="tm-flag" src="${esc(hooks.flagSrc(lead.code))}" alt="">` : ''}${c.trips.length > 1 ? `<b class="tm-n">${c.trips.length}</b>` : ''}`;
          pinLayer.appendChild(node);
        }
        taken.push([c.p[0] - 23, c.p[1] - 56, c.p[0] + 23, c.p[1] - 6]);
        return { ...c, key, node };
      });
      keep.forEach((c) => c.node.remove());

      // Every country's famous sights as photo pins: each country's best-known one first, more as you zoom in,
      // never overlapping. Turning the globe brings other countries' photos into view.
      const zoomNow = st.mode === 'flat' ? st.t.k : st.k;
      box.classList.toggle('near', zoomNow >= (st.mode === 'flat' ? 3 : 2));
      const oldWorld = new Map(st.worldNodes.map((x) => [x.key, x]));
      st.worldNodes = [];
      if (st.worldOn && st.world.length) {
        const flatK = st.mode === 'flat' ? zoomNow / 1.6 : zoomNow;
        let maxRank = 9;
        if (flatK < 1.6) maxRank = 0; else if (flatK < 3) maxRank = 1; else if (flatK < 5) maxRank = 3;
        const limit = st.w < 600 ? 26 : 54;
        st.world.forEach((x) => {
          if (st.worldNodes.length >= limit || x.rank > maxRank || (st.sel && x.code === st.sel.code)) return;
          const p = screen(x.lng, x.lat);
          if (!inView(p, 0)) return;
          const rect = [p[0] - 19, p[1] - 44, p[0] + 19, p[1] + 4];
          if (overlaps(rect, taken)) return;
          taken.push(rect);
          const key = `${x.code}:${x.i}`;
          let node = oldWorld.get(key)?.node;
          oldWorld.delete(key);
          if (!node) {
            node = document.createElement('button');
            node.type = 'button';
            node.className = 'tm-sight mini';
            node.dataset.pinSight = key;
            node.style.setProperty('--d', `${Math.min(st.worldNodes.length, 20) * 35}ms`);
            node.setAttribute('aria-label', `${x.name}（${hooks.name(x.code)}）`);
            node.innerHTML = `<span class="tm-ph"><img src="${esc(x.photo)}" alt="" referrerpolicy="no-referrer" loading="lazy"></span><small>${esc(x.name)}</small>`;
            pinLayer.appendChild(node);
          }
          st.worldNodes.push({ ...x, key, node });
        });
      }
      oldWorld.forEach((x) => x.node.remove());

      // Country names: biggest first, visited ones always tried, nothing overlapping.
      const items = data.features.map((f) => {
        const g = GEO[f.id];
        if (!g) return null;
        const visited = data.visits.get(f.id);
        return { id: f.id, code: g[0], lng: g[1], lat: g[2], area: g[3], visited, score: g[3] * (visited ? 60 : 1) * (f.id === data.home.n ? 30 : 1) };
      }).filter(Boolean).sort((a, b) => b.score - a.score);
      const labels = [];
      items.forEach((it) => {
        if (labels.length > 90) return;
        const p = screen(it.lng, it.lat);
        if (!inView(p, 0)) return;
        const name = hooks.name(it.code);
        const size = it.area > 2.5e6 ? 13 : 12;
        const width = name.length * size + (it.visited ? 20 : 0);
        const extent = Math.sqrt(it.area) * pxPerKm(it.lat);
        if (extent < (it.visited ? 6 : Math.max(14, width * 0.5))) return; // names may spill a little past small countries
        const rect = [p[0] - width / 2 - 3, p[1] - size / 2 - 3, p[0] + width / 2 + 3, p[1] + size / 2 + 3];
        if (overlaps(rect, taken)) return;
        taken.push(rect);
        labels.push({ ...it, name, size });
      });
      labelLayer.innerHTML = labels.map((l) => `<span class="tm-label ${l.visited ? `on ${l.visited}` : ''}" style="font-size:${l.size}px">${l.visited ? `<img src="${esc(hooks.flagSrc(l.code))}" alt="">` : ''}${esc(l.name)}</span>`).join('')
        + OCEANS.filter((o) => o[3] === 'both' || o[3] === st.mode).map((o) => `<span class="tm-label sea">${o[0]}</span>`).join('');
      const nodes = [...labelLayer.children];
      st.labels = labels.map((l, i) => ({ ...l, node: nodes[i] }));
      OCEANS.filter((o) => o[3] === 'both' || o[3] === st.mode).forEach((o, i) => st.labels.push({ lng: o[1], lat: o[2], node: nodes[labels.length + i] }));

      // Recommended places, with their photos, once zoomed in far enough to see a region.
      const close = st.mode === 'flat' ? st.t.k >= 2.4 : st.k >= 2.1;
      pinLayer.querySelectorAll('.tm-rec').forEach((n) => n.remove());
      st.recs = [];
      if (close && !st.sel && !st.worldOn) {
        data.recs.forEach((r) => {
          if (st.recs.length >= 24) return;
          const p = screen(r.lng, r.lat);
          if (!inView(p, 0)) return;
          const rect = [p[0] - 18, p[1] - 18, p[0] + 18, p[1] + 30];
          if (overlaps(rect, taken)) return;
          taken.push(rect);
          const node = document.createElement('button');
          node.type = 'button';
          node.className = 'tm-rec';
          node.dataset.pinDest = r.id;
          node.innerHTML = `<span class="tm-ph">${r.photo ? `<img src="${esc(r.photo)}" alt="" referrerpolicy="no-referrer">` : ''}</span><small>${esc(r.name)}</small>`;
          pinLayer.appendChild(node);
          st.recs.push({ ...r, node });
        });
      }
      place();
    }

    // ---------- when left alone, the globe turns slowly and recommends a sight now and then
    let lastTouch = performance.now();
    let spinFrame = 0;
    let spinLast = 0;
    let spinSettle = 0;
    let bubbleAt = 0;
    let onScreen = true;
    function ripple(e) {
      if (REDUCED) return;
      const [x, y] = d3.pointer(e, box);
      const node = document.createElement('span');
      node.className = 'tm-ripple';
      node.style.translate = `${x}px ${y}px`;
      box.appendChild(node);
      setTimeout(() => node.remove(), 800);
    }
    function touched(e) {
      lastTouch = performance.now();
      if (e?.target && bubble.contains(e.target)) return; // pressing the bubble opens it, so keep it
      bubble.classList.remove('show');
      st.spot = null;
    }
    ['pointerdown', 'wheel', 'touchstart'].forEach((t) => box.addEventListener(t, touched, { passive: true }));
    if ('IntersectionObserver' in global) {
      new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; }).observe(box);
    }
    function recommend() {
      // A photo near the front of the globe, not the one shown last time.
      const front = st.worldNodes.filter((x) => {
        const p = screen(x.lng, x.lat);
        return p && Math.abs(p[0] - st.w / 2) < st.w * 0.3 && p[1] > 70 && p[1] < midY() + baseR() * 0.6 && x.key !== st.spot?.key;
      });
      if (!front.length) return;
      const x = front[Math.floor(Math.random() * front.length)];
      st.spot = x;
      const info = hooks.describeSight ? hooks.describeSight(x.code, x.i) : { title: x.name, sub: '' };
      bubble.dataset.pinSight = x.key;
      bubble.innerHTML = `<span class="tm-bubble-in"><small>推薦</small><b>${esc(info.title)}</b>${info.sub ? `<span>${esc(info.sub)}</span>` : ''}</span>`;
      if (bubble.parentNode !== pinLayer) pinLayer.appendChild(bubble);
      bubble.classList.remove('show');
      bubble.getBoundingClientRect();
      bubble.classList.add('show');
      st.worldNodes.forEach((n) => n.node.classList.toggle('spot', n.key === x.key));
    }
    function idleSpin(now) {
      const idle = now - lastTouch > 6000 && st.mode === 'globe' && !st.sel && !st.expanded && onScreen && !document.hidden && st.data;
      // Only animate while actually turning; otherwise look again in a moment (saves battery).
      if (!idle) { spinLast = now; spinFrame = setTimeout(() => requestAnimationFrame(idleSpin), 400); return; }
      spinFrame = requestAnimationFrame(idleSpin);
      const dt = Math.min(64, now - spinLast);
      spinLast = now;
      st.rot = [st.rot[0] + dt * 0.004, st.rot[1]];
      drawGlobe();
      place();
      if (now - spinSettle > 1200) { spinSettle = now; settle(); }
      if (now - bubbleAt > 5200) { bubbleAt = now; recommend(); }
    }
    if (!REDUCED) spinFrame = requestAnimationFrame(idleSpin);

    pinLayer.addEventListener('click', (e) => {
      const pin = e.target.closest('.tm-pin');
      if (pin) {
        const ids = pin.dataset.pin.split(',');
        const c = st.clusters.find((x) => x.node === pin);
        if (ids.length > 1 && c) { api.focus(c.lng, c.lat, st.mode === 'flat' ? Math.min(14, st.t.k * 2.8) : Math.min(8, st.k * 2.2)); return; } // eslint-disable-line no-use-before-define
        hooks.onTrip(ids[0]);
        return;
      }
      const sight = e.target.closest('.tm-sight, .tm-bubble');
      if (sight) {
        const [code, i] = sight.dataset.pinSight.split(':');
        hooks.onSight(code, Number(i));
        return;
      }
      const rec = e.target.closest('.tm-rec');
      if (rec) hooks.onDest(rec.dataset.pinDest);
    });

    const sizeKey = () => `${st.mode}:${root.clientWidth || 800}:${st.expanded ? root.clientHeight : ''}`;
    function build(keep) {
      const view = keep && st.mode === 'flat' && st.proj && st.w ? { center: st.proj.invert(st.t.invert([st.w / 2, st.h / 2])), k: st.t.k } : null;
      st.w = root.clientWidth || 800;
      const tall = st.w < 600 ? Math.min(460, Math.max(330, st.w * 1.02)) : Math.min(580, Math.max(380, st.w * 0.56));
      st.h = Math.round(st.expanded ? root.clientHeight || window.innerHeight : tall);
      box.style.height = `${st.h}px`;
      box.dataset.mode = st.mode;
      cancelAnimationFrame(st.anim);
      pinLayer.innerHTML = `<span class="tm-home" title="出發：${esc(st.data.home.name)}"><i></i><small>${esc(st.data.home.name)}</small></span>`;
      st.homeNode = pinLayer.firstElementChild;
      st.clusters = []; st.recs = [];
      if (st.focus) { pinLayer.appendChild(st.focus.node); }
      if (st.mode === 'flat') buildFlat(view); else buildGlobe();
      st.built = sizeKey();
      draw();
      settle();
    }

    const api = {
      setData(data) {
        const first = !st.data;
        const homeName = st.data?.home.name;
        st.data = data;
        const same = st.built === sizeKey() && homeName === data.home.name;
        if (same && st.mode === 'globe') { draw(); settle(); return; }
        build(same);
        if (first && st.mode === 'globe' && !REDUCED) {
          // Arrive from the east and settle over home.
          const to = [...st.rot];
          st.rot = [to[0] - 70, to[1] + 10];
          api.rotateTo(to, st.k, 1600);
        }
      },
      setMode(mode) {
        if (mode === st.mode) return;
        st.mode = mode;
        if (st.data) build();
      },
      get mode() { return st.mode; },
      resize() { if (st.data && st.built !== sizeKey()) build(true); },
      setExpanded(on) {
        st.expanded = Boolean(on);
        box.classList.toggle('expanded', st.expanded);
        hintBox.classList.remove('show');
        if (st.data) build(true);
      },
      get expanded() { return st.expanded; },
      // All countries' sights for the photo layer: [{ code, i, name, lng, lat, photo, rank }], best first.
      setWorldSights(list) {
        st.world = list || [];
        settle();
      },
      setWorldPhotos(on) {
        st.worldOn = Boolean(on);
        settle();
      },
      // A tapped country: outline it and show its famous sights as photo pins ({ id, code, list, active }).
      showSights(sel) {
        touched();
        if (sel && st.sel && st.sel.id === sel.id && sel.active == null) sel.active = st.sel.active;
        st.sel = sel;
        if (st.g) st.g.selectAll('.tm-land').classed('sel', (f) => Boolean(sel) && f.id === sel.id);
        draw();
        settle();
      },
      setActiveSight(i) {
        if (!st.sel) return;
        st.sel.active = i;
        settle();
      },
      // Fly so that all the given places are in view (points: [[lng, lat], ...]).
      fitPoints(points) {
        if (points.length < 2) return;
        const visible = Math.min(st.w, st.h - st.inset);
        if (st.mode === 'globe') {
          const center = d3.geoCentroid({ type: 'MultiPoint', coordinates: points });
          const spread = Math.max(0.004, ...points.map((p) => d3.geoDistance(center, p)));
          const k = (visible * 0.36) / (baseR() * Math.sin(Math.min(Math.PI / 2, spread)));
          api.rotateTo([-center[0], -center[1]], Math.max(1.1, Math.min(8, k)), 1000);
          return;
        }
        const xy = points.map((p) => st.proj(p));
        const [x0, x1] = d3.extent(xy, (p) => p[0]);
        const [y0, y1] = d3.extent(xy, (p) => p[1]);
        const k = Math.max(1.5, Math.min(14, Math.min((st.w * 0.7) / Math.max(1, x1 - x0), ((st.h - st.inset) * 0.6) / Math.max(1, y1 - y0))));
        const t = d3.zoomIdentity.translate(st.w / 2, midY()).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
        d3.select(box).transition().duration(REDUCED ? 0 : 900).ease(d3.easeCubicInOut).call(st.zoom.transform, clamp(t));
      },
      // Fly to a country, closer for small ones (area in km²).
      // Space taken by a card over the bottom of the map; the globe glides up to stay in view.
      setInset(px) {
        const from = st.inset;
        const to = Math.max(0, Math.min(st.h * 0.55, px || 0));
        if (from === to) return;
        const start = performance.now();
        const step = (now) => {
          const p = REDUCED ? 1 : Math.min(1, (now - start) / 420);
          st.inset = from + (to - from) * d3.easeCubicOut(p);
          if (st.mode === 'globe') { drawGlobe(); place(); }
          if (p < 1) requestAnimationFrame(step); else settleSoon();
        };
        requestAnimationFrame(step);
      },
      focusArea(lng, lat, area) {
        const size = Math.sqrt(Math.max(1, area || 1));
        if (st.mode === 'globe') { api.rotateTo([-lng, -lat], Math.max(1.1, Math.min(6, 1800 / size)), 1100); return; }
        api.focus(lng, lat, Math.max(1.5, Math.min(12, 3600 / size)));
      },
      rotateTo(rot, k, ms = 1000) {
        touched();
        cancelAnimationFrame(st.anim);
        const from = [...st.rot];
        const k0 = st.k;
        const dl = ((((rot[0] - from[0]) % 360) + 540) % 360) - 180;
        const start = performance.now();
        const ease = d3.easeCubicInOut;
        const step = (now) => {
          const p = REDUCED ? 1 : Math.min(1, (now - start) / ms);
          const e = ease(p);
          st.rot = [from[0] + dl * e, from[1] + (rot[1] - from[1]) * e];
          st.k = k0 + (k - k0) * e;
          d3.select(box).property('__zoom', d3.zoomIdentity.scale(st.k));
          drawGlobe(); place();
          if (p < 1) st.anim = requestAnimationFrame(step); else settle();
        };
        st.anim = requestAnimationFrame(step);
      },
      focus(lng, lat, k = 5, mark = false) {
        if (mark) {
          if (!st.focus) {
            const node = document.createElement('span');
            node.className = 'tm-focus';
            st.focus = { node };
          }
          st.focus.lng = lng; st.focus.lat = lat;
          pinLayer.appendChild(st.focus.node);
        }
        if (st.mode === 'globe') { api.rotateTo([-lng, -lat], Math.min(8, Math.max(1.6, k / 2)), 1100); return; }
        const p = st.proj([lng, lat]);
        const t = d3.zoomIdentity.translate(st.w / 2, midY()).scale(k).translate(-p[0], -p[1]);
        d3.select(box).transition().duration(REDUCED ? 0 : 900).ease(d3.easeCubicInOut).call(st.zoom.transform, clamp(t));
      },
      zoomBy(f) {
        if (st.mode === 'globe') { api.rotateTo(st.rot, Math.min(9, Math.max(0.85, st.k * f)), 300); return; }
        d3.select(box).transition().duration(300).call(st.zoom.scaleBy, f);
      },
      reset() {
        if (st.mode === 'globe') { api.rotateTo([-st.data.home.lng, -18], 1, 700); return; }
        const c = st.proj([st.data.home.lng + 12, 28]);
        d3.select(box).transition().duration(500).call(st.zoom.transform, clamp(d3.zoomIdentity.translate(st.w / 2 - c[0], st.h / 2 - c[1])));
      },
    };
    return api;
  }

  global.TravelMap = { create: createMap };
}(window));
