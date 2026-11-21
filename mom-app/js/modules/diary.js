/* 易家做媽媽 — 產檢日記島 (the pregnancy diary).
 * Every prenatal visit becomes a page: the week, the numbers, ultrasound photos, and one sentence to the baby.
 * Moms can add their own pages too (第一次胎動、4D 超音波…). Photos stay on this phone (App.media).
 * A page can become a share card (the ultrasound picture + the sentence), and the whole diary prints as a keepsake. */
(function () {
  const App = window.App = window.App || {};
  const { h, ui } = App;
  const store = App.store;
  const C = window.Core;
  const D = App.PREG_DATA || { PRENATAL: [] };

  const ensure = (s) => { s.preg = s.preg || {}; s.preg.prenatal = s.preg.prenatal || {}; s.preg.visitNotes = s.preg.visitNotes || {}; s.preg.diary = s.preg.diary || []; return s.preg; };
  const lmp = () => (App.preg && App.preg.pregLmp ? App.preg.pregLmp() : '');
  const weekAt = (date) => { const l = lmp(); if (!l || !date) return null; const ga = C.gestAge(l, C.parseKey(date)); return ga.totalDays >= 0 && ga.weeks <= 44 ? ga : null; };
  const babyName = () => { const b = store.baby && store.baby(); return b && b.name ? b.name : '寶寶'; };

  /* ---------- photos: a row of thumbnails with ＋ ---------- */
  function thumb(id, { onOpen, size = 76 } = {}) {
    const img = h('img', { alt: '照片', class: 'dy-thumb-img', loading: 'lazy' });
    const box = h('button', { type: 'button', class: 'dy-thumb', style: { width: `${size}px`, height: `${size}px` }, onclick: () => onOpen && onOpen(id) }, img);
    App.media.url(id).then((u) => { if (u) img.src = u; else { box.classList.add('missing'); box.textContent = '照片在另一台手機'; } });
    return box;
  }
  function photoField(initial = []) {
    const ids = [...initial];
    const added = []; // new this time: deleted again if the form is closed without saving
    const wrap = h('div', { class: 'dy-photos' });
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hide' });
    const render = () => {
      wrap.innerHTML = '';
      ids.forEach((id) => {
        const t = thumb(id, { size: 72 });
        const x = h('button', {
          type: 'button', class: 'dy-thumb-x', 'aria-label': '移除這張照片',
          onclick: () => {
            ids.splice(ids.indexOf(id), 1);
            const k = added.indexOf(id); if (k >= 0) { added.splice(k, 1); App.media.del(id); } // just added: gone at once
            render();
          },
        }, '✕');
        wrap.append(h('div', { class: 'dy-thumb-wrap' }, t, x));
      });
      wrap.classList.toggle('no-photos', !ids.length);
      if (!ids.length) {
        wrap.append(h('button', { type: 'button', class: 'dy-drop', onclick: () => file.click() },
          h('span', { class: 'dy-drop-ico', 'aria-hidden': 'true' }, '📷'), h('b', null, '加入超音波或產檢照片'),
          h('span', { class: 'tiny' }, '最多 6 張')));
      } else if (ids.length < 6) wrap.append(h('button', { type: 'button', class: 'dy-add-photo', 'aria-label': '再加一張照片', onclick: () => file.click() }, h('span', null, '＋'), h('small', null, '超音波照片')));
    };
    file.addEventListener('change', async () => {
      const files = [...(file.files || [])].slice(0, 6 - ids.length);
      for (const f of files) {
        try { const blob = await App.media.fromFile(f); const id = await App.media.put(blob); ids.push(id); added.push(id); } catch (e) { ui.toast('這張照片存不下來'); }
      }
      file.value = ''; render();
    });
    render();
    return {
      el: h('div', null, wrap, file, h('p', { class: 'tiny faint' }, '🔒 照片只存在這台手機，備份檔會一起帶走。')),
      ids: () => ids.slice(),
      commit: () => { added.length = 0; },
      discard: () => { added.splice(0).forEach((id) => App.media.del(id)); },
    };
  }
  const msgInput = (val) => h('textarea', { rows: 2, maxlength: 120, class: 'dy-msg-in', placeholder: '例如：今天第一次聽到你的心跳，好有力！' }, val || '');

  /* ---------- the pages ---------- */
  function pages() {
    const s = store.state; const p = ensure(s);
    const out = [];
    D.PRENATAL.forEach((v) => {
      const date = p.prenatal[v.key]; const n = p.visitNotes[v.key] || {};
      if (!date && !(n.photos && n.photos.length) && !n.msg) return;
      out.push({ kind: 'visit', key: v.key, v, date: date || '', title: `第 ${v.no} 次產檢`, ...n, photos: n.photos || [] });
    });
    (p.diary || []).forEach((e) => out.push({ kind: 'custom', key: e.id, ...e, photos: e.photos || [] }));
    return out.sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
  }
  const counts = () => { const ps = pages(); return { pages: ps.length, photos: ps.reduce((n, x) => n + x.photos.length, 0) }; };

  /* ---------- a page of your own (第一次胎動、4D 超音波…) ---------- */
  function openEntry(id) {
    const p = ensure(store.state);
    const e = id ? p.diary.find((x) => x.id === id) : null;
    const title = h('input', { type: 'text', maxlength: 30, value: e ? e.title : '', placeholder: '例如：第一次感覺到胎動' });
    const date = h('input', { type: 'date', value: e ? e.date : C.dateKey() });
    const pf = photoField(e ? e.photos : []);
    const msg = msgInput(e ? e.msg : '');
    const note = h('textarea', { rows: 2, maxlength: 300, placeholder: '想記下的事（選填）' }, e ? e.note || '' : '');
    let saved = false;
    const sh = ui.sheet({
      onClose: () => { if (!saved) pf.discard(); },
      title: e ? '編輯這一頁' : '新增一頁日記',
      body: h('div', null,
        ui.field('標題', title), ui.field('日期', date), ui.field('照片', pf.el),
        ui.field('💬 想對寶寶說的一句話', msg), ui.field('備註', note)),
      footer: h('div', { class: 'row gap' },
        e ? h('button', { class: 'btn btn-ghost', 'aria-label': '刪除這一頁', onclick: async () => {
          if (!(await ui.confirm('刪除這一頁日記？照片也會一起刪掉。', { ok: '刪除', danger: true }))) return;
          (e.photos || []).forEach((pid) => App.media.del(pid));
          store.update((s) => { ensure(s).diary = s.preg.diary.filter((x) => x.id !== e.id); }); saved = true; pf.discard(); sh.close();
        } }, ui.icon('trash')) : null,
        h('button', {
          class: 'btn btn-primary grow',
          onclick: () => {
            const rec = { id: e ? e.id : C.uid(), title: title.value.trim() || '日記', date: date.value || C.dateKey(), photos: pf.ids(), msg: msg.value.trim(), note: note.value.trim() };
            if (e) (e.photos || []).filter((pid) => !rec.photos.includes(pid)).forEach((pid) => App.media.del(pid));
            store.update((s) => { const d = ensure(s); d.diary = d.diary.filter((x) => x.id !== rec.id); d.diary.push(rec); });
            saved = true; pf.commit();
            sh.close(); ui.toast('已存進產檢日記 💌');
          },
        }, '儲存')),
    });
  }
  function editPage(pg) {
    if (pg.kind === 'custom') openEntry(pg.key);
    else if (App.preg && App.preg.openVisitSheet) App.preg.openVisitSheet(pg.v, pg.date);
  }

  /* ---------- one photo, big; share it as a card ---------- */
  function openPhoto(id, pg) {
    const img = h('img', { alt: '超音波照片', class: 'dy-big' });
    App.media.url(id).then((u) => { if (u) img.src = u; });
    const sh = ui.sheet({
      title: pg ? pg.title : '照片',
      body: h('div', null, img,
        pg && pg.msg ? h('p', { class: 'dy-quote' }, `「${pg.msg}」`) : null,
        h('div', { class: 'row gap-sm mt' },
          h('button', { class: 'btn btn-primary grow', onclick: () => { sh.close(); setTimeout(() => sharePage(pg, id), 240); } }, '📤 做成分享卡'),
          h('button', { class: 'btn btn-soft grow', onclick: () => savePage(pg, id) }, '🖼️ 存成圖片'))),
    });
  }
  async function pageSpec(pg, photoId) {
    const ga = pg ? weekAt(pg.date) : null;
    const photo = photoId ? await App.media.dataUrl(photoId) : null;
    return {
      bigPhoto: photo, emoji: '💌', kicker: ga ? `懷孕 ${ga.weeks} 週 ${ga.days} 天` : (pg && pg.title) || '產檢日記',
      title: pg && pg.msg ? `「${pg.msg}」` : `給${babyName()}的一頁日記`, subtitle: pg ? `${pg.title}・${C.fmtDateLong ? C.fmtDateLong(C.parseKey(pg.date)) : pg.date}` : '',
      theme: 'night', campaign: 'diary-ultrasound', path: 'island', params: { island: 'diary' },
    };
  }
  async function sharePage(pg, photoId) {
    const spec = await pageSpec(pg, photoId);
    App.share.open({ spec, text: `${spec.kicker}・${pg && pg.msg ? pg.msg : '我們的產檢日記'} 💌`, title: '產檢日記', campaign: 'diary-ultrasound', path: 'island', params: { island: 'diary' } });
  }
  async function savePage(pg, photoId) {
    ui.toast('產生圖片中…');
    try {
      const blob = await App.share.render(await pageSpec(pg, photoId));
      const how = await App.share.saveImage(blob, `產檢日記-${pg ? pg.date : C.dateKey()}.png`, '產檢日記');
      if (how === 'downloaded') ui.toast('圖片已下載');
    } catch (e) { ui.toast('圖片產生失敗，請再試一次'); }
  }

  /* ---------- the diary screen ---------- */
  App.screen('diary', {
    title: '產檢日記',
    tab: 'island',
    render(el) {
      const p = ensure(store.state);
      const ps = pages();
      const c = counts();
      const av = App.avatar && App.avatar.current();
      const cover = ui.card({ class: 'dy-cover' },
        h('div', { class: 'dy-cover-art', 'aria-hidden': 'true', html: av ? App.avatar.svg(av, { pose: 'preg', size: 96 }) : '' }, av ? null : h('span', { class: 'dy-cover-emoji' }, '💌')),
        h('div', { class: 'grow' },
          h('div', { class: 'dy-cover-kicker' }, '💌 產檢日記島'),
          h('div', { class: 'dy-cover-title' }, `給${babyName()}的產檢日記`),
          h('div', { class: 'small muted' }, `${c.pages} 頁・${c.photos} 張照片${lmp() ? `・預產期 ${C.fmtDate ? C.fmtDate(C.addDays(lmp(), 280)) : ''}` : ''}`)));
      el.append(cover);
      el.append(h('div', { class: 'row gap-sm wrap mb' },
        h('button', { class: 'btn btn-primary grow', onclick: () => openEntry() }, '＋ 新增一頁'),
        h('button', { class: 'btn btn-soft', onclick: () => App.navigate('diary-print') }, '📄 PDF'),
        av ? null : h('button', { class: 'btn btn-soft', onclick: () => App.navigate('avatar') }, '🙂 我的角色')));
      if (!ps.length) {
        el.append(ui.card({ class: 'soft center' },
          h('div', { class: 'empty-icon' }, '🩺'),
          h('p', null, '每次產檢完，放一張超音波照片、寫一句想對寶寶說的話，慢慢就是一本日記。'),
          h('p', { class: 'small muted' }, '在「產檢」標記完成時也可以順便加照片。')));
      }
      ps.forEach((pg) => {
        const ga = weekAt(pg.date);
        const vit = [pg.weight ? `體重 ${pg.weight} kg` : '', pg.fhr ? `胎心 ${pg.fhr}` : '', pg.sys && pg.dia ? `血壓 ${pg.sys}/${pg.dia}` : ''].filter(Boolean).join('・');
        const card = ui.card({ class: 'dy-page' },
          h('div', { class: 'row between' },
            h('div', null,
              h('div', { class: 'dy-page-week' }, ga ? `${ga.weeks} 週 ${ga.days} 天` : (pg.v ? `約 ${pg.v.week} 週` : '')),
              h('div', { class: 'dy-page-title' }, pg.title),
              h('div', { class: 'tiny muted' }, pg.date ? C.fmtDateLong(C.parseKey(pg.date)) : '還沒填日期')),
            h('button', { class: 'btn btn-sm btn-ghost', onclick: () => editPage(pg) }, '編輯')),
          pg.photos.length ? h('div', { class: 'dy-strip' }, pg.photos.map((id) => thumb(id, { onOpen: (x) => openPhoto(x, pg), size: 96 }))) : h('button', { class: 'dy-add-inline', onclick: () => editPage(pg) }, '＋ 加超音波照片'),
          pg.msg ? h('p', { class: 'dy-quote' }, `💬 「${pg.msg}」`) : h('button', { class: 'link-btn small', onclick: () => editPage(pg) }, '💬 寫一句想對寶寶說的話'),
          vit ? h('div', { class: 'tiny muted' }, vit) : null,
          pg.note ? h('p', { class: 'small' }, pg.note) : null,
          pg.photos.length || pg.msg ? h('div', { class: 'row gap-sm mt-xs' },
            h('button', { class: 'btn btn-sm btn-soft', onclick: () => sharePage(pg, pg.photos[0]) }, '📤 分享這一頁')) : null);
        el.append(card);
      });
      // visits still to come: a short list to fill in later
      const left = D.PRENATAL.filter((v) => !p.prenatal[v.key] && !(p.visitNotes[v.key] && (p.visitNotes[v.key].photos || []).length));
      if (left.length && store.stage === 'preg') {
        el.append(h('div', { class: 'section-title' }, h('span', null, '接下來的產檢')));
        el.append(h('div', { class: 'list' }, left.slice(0, 3).map((v) => h('button', { class: 'list-item', onclick: () => App.preg.openVisitSheet(v) },
          h('span', { class: 'li-icon' }, '🩺'),
          h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, `第 ${v.no} 次產檢`), h('div', { class: 'li-sub' }, `建議 ${v.range}`)),
          h('span', { class: 'li-right small muted' }, '記錄 ›')))));
      }
      el.append(h('p', { class: 'disclaimer center' }, '日記和照片只存在這台手機；記得定期到「我的」匯出備份。'));
    },
  });

  /* ---------- the diary on paper (print / PDF keepsake) ---------- */
  App.screen('diary-print', {
    title: '產檢日記 PDF',
    tab: 'island',
    actions: () => h('button', { class: 'icon-btn', 'aria-label': '列印或存成 PDF', html: ui.ICONS.print, onclick: () => window.print() }),
    render(el) {
      const ps = pages();
      const av = App.avatar && App.avatar.current();
      el.append(h('div', { class: 'no-print mb stack-sm' },
        h('button', { class: 'btn btn-primary btn-block', onclick: () => window.print() }, h('span', { class: 'ic', html: ui.ICONS.print }), '列印／存成 PDF'),
        h('p', { class: 'tiny faint' }, '在列印視窗選「儲存為 PDF」，就能存成一本電子日記，或印出來收藏。')));
      const doc = h('article', { class: 'dy-doc' },
        h('header', { class: 'dy-doc-cover' },
          av ? h('div', { class: 'dy-doc-av', html: App.avatar.svg(av, { pose: 'preg', size: 110 }) }) : h('div', { class: 'dy-doc-av emoji' }, '💌'),
          h('h2', null, `給${babyName()}的產檢日記`),
          h('div', { class: 'small' }, `${store.state.profile.momName ? `${store.state.profile.momName}・` : ''}${ps.length} 頁`)));
      ps.forEach((pg) => {
        const ga = weekAt(pg.date);
        const sec = h('section', { class: 'dy-doc-page' },
          h('h3', null, `${pg.title}${ga ? `・${ga.weeks} 週 ${ga.days} 天` : ''}`),
          h('div', { class: 'tiny' }, pg.date || ''),
          h('div', { class: 'dy-doc-photos' }),
          pg.msg ? h('p', { class: 'dy-quote' }, `「${pg.msg}」`) : null,
          pg.note ? h('p', { class: 'small' }, pg.note) : null);
        const box = sec.querySelector('.dy-doc-photos');
        pg.photos.slice(0, 2).forEach((id) => { const im = h('img', { alt: '超音波照片' }); App.media.url(id).then((u) => { if (u) im.src = u; }); box.append(im); });
        doc.append(sec);
      });
      if (!ps.length) doc.append(h('p', { class: 'center muted' }, '還沒有日記，先到產檢日記新增一頁吧。'));
      el.append(doc);
    },
  });

  App.diary = { pages, counts, openEntry, photoField, msgInput, sharePage, openPhoto };
}());
