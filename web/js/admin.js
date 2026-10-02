// Admin panel (loaded only for admins).

const SECTIONS = ['overview', 'deposits', 'withdrawals', 'cases', 'items', 'users', 'promos', 'settings', 'broadcast'];
const REQ_KIND = { deposits: 'deposit', withdrawals: 'withdraw' };
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret'];

let C = null; // context from app.js
let bcastTimer = null;
let reqTimer = null;
let reqScope = 'active';
let reqSeq = 0; // the latest list/card load wins

function stopReqTimer() {
  if (reqTimer) clearInterval(reqTimer);
  reqTimer = null;
}

function h(...a) {
  return C.html(...a);
}

function adminError(e) {
  const code = e && e.code;
  if (code) {
    const key = 'a.e.' + code;
    const txt = C.t(key, { f: (e.data && (e.data.field || e.data.key || e.data.message)) || '' });
    if (txt !== key) {
      C.toast(txt, 'error');
      return;
    }
  }
  C.showError(e);
}

export function renderAdmin(view, route, ctx) {
  C = ctx;
  if (bcastTimer) {
    clearInterval(bcastTimer);
    bcastTimer = null;
  }
  stopReqTimer();
  const sub = SECTIONS.includes(route.sub) ? route.sub : 'overview';
  view.onclick = null;
  C.render(
    view,
    h`<div class="adm">
      <div class="adm-tabs">${SECTIONS.map(
        (s) => h`<a class="chip ${s === sub ? 'on' : ''}" href="#/admin/${s}">${C.t('a.' + s)}${REQ_KIND[s] ? h`<i class="chip-n" data-cnt="${REQ_KIND[s]}"></i>` : ''}</a>`,
      )}</div>
      <div id="admBody" class="adm-body"><div class="spinner"></div></div>
    </div>`,
  );
  if (sub !== 'overview') C.$('.adm-tabs .chip.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  refreshCounts();
  const body = C.$('#admBody');
  const run = {
    overview: () => overview(body),
    deposits: () => (route.id ? reqDetail(body, 'deposit', Number(route.id)) : reqList(body, 'deposit')),
    withdrawals: () => (route.id ? reqDetail(body, 'withdraw', Number(route.id)) : reqList(body, 'withdraw')),
    cases: () => (route.id ? caseEditor(body, route.id) : casesList(body)),
    items: () => itemsList(body),
    users: () => (route.id ? userDetail(body, Number(route.id)) : usersList(body)),
    promos: () => promos(body),
    settings: () => settingsForm(body),
    broadcast: () => broadcast(body),
  }[sub];
  Promise.resolve(run()).catch(adminError);
}

// ------------------------------------------------------------------ overview
async function overview(body) {
  const o = await C.API.get('/admin/overview');
  if (!body.isConnected) return;
  const keys = ['users', 'new24', 'online', 'opened24', 'upgrades24', 'coins', 'items_value'];
  C.render(
    body,
    h`<div class="stats adm-stats">${keys.map(
      (k) => h`<div class="stat"><div class="s-val">${k === 'coins' || k === 'items_value' ? C.money(o[k], 15) : C.fmt(o[k])}</div><div class="s-lbl">${C.t('a.st.' + k)}</div></div>`,
    )}</div>`,
  );
}

// ------------------------------------------------------------------ cases
async function casesList(body) {
  const { cases, categories } = await C.API.get('/admin/cases');
  if (!body.isConnected) return;
  const lang = document.documentElement.lang || 'ru';
  const row = (c) => h`<a class="row" href="#/admin/cases/${c.id}">
        <span class="row-art">${C.caseArt(c, 44)}</span>
        <span class="row-main"><b>${c['name_' + lang] || c.name_ru}</b><small>${c.is_free ? 'FREE' : C.money(c.price, 12)} · ${C.t('a.rtp')}: ${c.rtp === null ? '—' : C.fmt(c.rtp) + '%'}</small></span>
        <span class="badge ${c.enabled ? 'ok' : 'off'}">${c.enabled ? C.t('a.on') : C.t('a.off')}</span>
      </a>`;
  const known = new Set(categories.map((k) => k.id));
  const loose = cases.filter((c) => c.is_free || !c.category_id || !known.has(c.category_id));
  C.render(
    body,
    h`<div class="adm-actions"><a class="btn small" href="#/admin/cases/new">+ ${C.t('a.newCase')}</a><button type="button" class="btn small ghost" data-cat-edit="new">+ ${C.t('a.category')}</button></div>
    ${categories.length ? h`<h4 class="sec-title">${C.t('a.noCategory')}</h4>` : ''}
    <div class="list">${loose.map(row)}</div>
    ${categories.map(
      (k) => h`<div class="cat-head" data-cat="${k.id}"><h4 class="sec-title">${k.name}</h4><button type="button" class="btn small ghost" data-cat-edit="${k.id}">${C.t('a.edit')}</button></div>
        <div class="list">${cases.filter((c) => !c.is_free && c.category_id === k.id).map(row)}</div>`,
    )}`,
  );
  body.onclick = (e) => {
    const b = e.target.closest('[data-cat-edit]');
    if (!b) return;
    const id = b.dataset.catEdit === 'new' ? null : Number(b.dataset.catEdit);
    categoryEditor(categories.find((k) => k.id === id) || null, cases, () => casesList(body).catch(adminError));
  };
}

/** Create / edit a category: name, order and which cases are in it. */
function categoryEditor(cat, cases, done) {
  const lang = document.documentElement.lang || 'ru';
  const paid = cases.filter((c) => !c.is_free);
  const sheet = C.openModal(
    h`<form class="form" id="catForm" autocomplete="off">
      <div class="sheet-title">${cat ? cat.name : C.t('a.newCategory')}</div>
      <div class="grid3">
        <label class="span2">${C.t('a.catName')}<input class="input" name="name" maxlength="40" value="${cat ? cat.name : ''}"></label>
        <label>${C.t('a.sort')}<input class="input" name="sort" type="number" step="1" value="${cat ? cat.sort : 0}"></label>
      </div>
      <h4 class="sec-title">${C.t('a.catCases')}</h4>
      <div class="list cat-cases">${paid.map(
        (c) => h`<label class="row cat-case"><input type="checkbox" name="case" value="${c.id}" ${cat && c.category_id === cat.id ? C.raw('checked') : ''}>
          <span class="row-art">${C.caseArt(c, 40)}</span>
          <span class="row-main"><b>${c['name_' + lang] || c.name_ru}</b><small>${C.money(c.price, 11)}</small></span>
        </label>`,
      )}</div>
      <div class="form-foot">
        ${cat ? h`<button type="button" class="btn ghost danger" id="catDel">${C.t('a.delete')}</button>` : ''}
        <button type="submit" class="btn primary">${C.t('a.save')}</button>
      </div>
    </form>`,
    { cls: 'tall' },
  );
  const form = sheet.querySelector('#catForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const payload = { name: String(f.get('name') || '').trim(), sort: Number(f.get('sort') || 0), caseIds: f.getAll('case').map(Number) };
    if (!payload.name) return adminError({ code: 'bad_field', data: { field: C.t('a.catName') } });
    try {
      if (cat) await C.API.put(`/admin/categories/${cat.id}`, payload);
      else await C.API.post('/admin/categories', payload);
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
      C.closeModal();
      done();
    } catch (err) {
      adminError(err);
    }
  });
  sheet.querySelector('#catDel')?.addEventListener('click', async () => {
    if (!(await C.confirmModal(C.t('a.deleteCategory')))) return;
    try {
      await C.API.del(`/admin/categories/${cat.id}`);
      await C.reloadCatalog();
      done();
    } catch (err) {
      adminError(err);
    }
  });
}

async function caseEditor(body, id) {
  let data;
  const listed = await C.API.get('/admin/cases');
  if (!body.isConnected) return;
  const categories = listed.categories || [];
  if (id === 'new') {
    data = { id: null, name_ru: '', name_uk: '', name_en: '', price: 100, is_free: false, emoji: '📦', color: '#f59e0b', sort: 100, enabled: true, category_id: null, items: [] };
  } else {
    data = listed.cases.find((c) => c.id === Number(id));
    if (!data) return C.go('#/admin/cases');
  }
  const items = new Map(C.S.items.map((i) => [i.id, i]));
  // disabled items are not in the public list — fetch the full catalogue
  const all = await C.API.get('/admin/items');
  if (!body.isConnected) return;
  for (const i of all.items) items.set(i.id, i);
  const loot = data.items.map((e) => ({ ...e }));

  function summary() {
    const sum = loot.reduce((s, e) => s + (Number(e.chance) || 0), 0);
    const ev = sum ? loot.reduce((s, e) => s + ((Number(e.chance) || 0) / sum) * (items.get(e.itemId)?.value || 0), 0) : 0;
    const price = Number(body.querySelector('#cPrice')?.value || data.price) || 0;
    const rtp = price > 0 ? (ev / price) * 100 : null;
    return h`<div class="sum-row ${Math.abs(sum - 100) < 0.0001 ? 'ok' : 'bad'}"><span>${C.t('a.sum')}</span><b>${C.fmt(Math.round(sum * 10000) / 10000)}%</b></div>
      <div class="sum-row"><span>${C.t('a.ev')}</span><b>${C.money(Math.round(ev * 100) / 100, 13)}</b></div>
      ${rtp === null ? '' : h`<div class="sum-row"><span>${C.t('a.rtp')}</span><b>${C.fmt(Math.round(rtp * 100) / 100)}%</b></div>`}`;
  }

  function caseImgRow() {
    return h`<span class="img-lbl">${C.t('a.image')}</span>
      <label class="btn small ghost file-btn">${C.t('a.upload')}<input type="file" accept="image/*" id="cImgFile" hidden></label>
      ${data.image ? h`<button type="button" class="btn small ghost" id="cImgDel">${C.t('a.removeImg')}</button>` : ''}`;
  }

  function lootRows() {
    loot.sort((a, b) => (items.get(b.itemId)?.value || 0) - (items.get(a.itemId)?.value || 0));
    return h`${loot.map((e, i) => {
      const it = items.get(e.itemId);
      return h`<div class="loot-row r-${it ? it.rarity : 'common'}">
        <span class="lr-art">${it ? C.art(it) : '?'}</span>
        <span class="lr-name"><b>${it ? it.name : '#' + e.itemId}</b><small>${it ? C.money(it.value, 11) : ''}</small></span>
        <input class="input lr-chance" type="number" inputmode="decimal" step="any" min="0.0001" max="100" value="${e.chance}" data-i="${i}" aria-label="${C.t('a.chancePct')}">
        <button class="icon-btn small" data-rm="${i}" aria-label="${C.t('a.delete')}">×</button>
      </div>`;
    })}`;
  }

  C.render(
    body,
    h`<form class="form" id="caseForm" autocomplete="off">
      <div class="form-head"><a class="back" href="#/admin/cases">‹</a><span id="cPreview">${C.caseArt(data, 56)}</span><b>${data.id ? data['name_' + (document.documentElement.lang || 'ru')] : C.t('a.newCase')}</b></div>
      <label>${C.t('a.nameRu')}<input class="input" name="name_ru" maxlength="60" value="${data.name_ru}" required></label>
      <label>${C.t('a.nameUk')}<input class="input" name="name_uk" maxlength="60" value="${data.name_uk}" required></label>
      <label>${C.t('a.nameEn')}<input class="input" name="name_en" maxlength="60" value="${data.name_en}" required></label>
      <div class="grid3">
        ${data.is_free ? '' : h`<label>${C.t('a.price')}<input class="input" id="cPrice" name="price" type="number" min="1" step="1" value="${data.price}" required></label>`}
        <label>${C.t('a.emoji')}<input class="input" name="emoji" maxlength="16" value="${data.emoji}" required></label>
        <label>${C.t('a.color')}<input class="input color" name="color" type="color" value="${data.color}"></label>
        <label>${C.t('a.sort')}<input class="input" name="sort" type="number" step="1" value="${data.sort}"></label>
      </div>
      ${data.is_free
        ? ''
        : h`<label>${C.t('a.category')}<select class="input" name="category_id"><option value="">—</option>${categories.map(
            (k) => h`<option value="${k.id}" ${data.category_id === k.id ? C.raw('selected') : ''}>${k.name}</option>`,
          )}</select></label>`}
      ${data.id ? h`<div class="img-row" id="cImgRow">${caseImgRow()}</div>` : ''}
      <label class="switch"><input type="checkbox" name="enabled" ${data.enabled ? C.raw('checked') : ''}><i></i>${C.t('a.enabled')}</label>
      <h4 class="sec-title">${C.t('a.loot')}</h4>
      <div id="lootRows" class="loot">${lootRows()}</div>
      <div class="adm-actions">
        <button type="button" class="btn small ghost" id="addLoot">+ ${C.t('a.addItem')}</button>
        <button type="button" class="btn small ghost" id="normLoot">${C.t('a.normalize')}</button>
      </div>
      <div class="summary" id="lootSum">${summary()}</div>
      <div class="form-foot">
        ${data.id && !data.is_free ? h`<button type="button" class="btn ghost danger" id="delCase">${C.t('a.delete')}</button>` : ''}
        <button type="submit" class="btn primary">${C.t('a.save')}</button>
      </div>
    </form>`,
  );

  const form = body.querySelector('#caseForm');
  const refresh = () => {
    C.render(body.querySelector('#lootRows'), lootRows());
    C.render(body.querySelector('#lootSum'), summary());
  };
  form.addEventListener('input', (e) => {
    if (e.target.classList.contains('lr-chance')) {
      loot[Number(e.target.dataset.i)].chance = e.target.value;
      C.render(body.querySelector('#lootSum'), summary());
    }
    if (e.target.name === 'price') C.render(body.querySelector('#lootSum'), summary());
    if ((e.target.name === 'color' || e.target.name === 'emoji') && !data.image) {
      const f = new FormData(form);
      const color = /^#[0-9a-f]{6}$/i.test(f.get('color')) ? f.get('color') : data.color;
      C.render(body.querySelector('#cPreview'), C.chest(color, f.get('emoji') || data.emoji, 56));
    }
  });
  // picture: upload / remove without losing unsaved form edits
  const setCaseImage = (img) => {
    data.image = img;
    const f = new FormData(form);
    const color = /^#[0-9a-f]{6}$/i.test(f.get('color')) ? f.get('color') : data.color;
    C.render(body.querySelector('#cPreview'), C.caseArt({ ...data, color, emoji: f.get('emoji') || data.emoji }, 56));
    C.render(body.querySelector('#cImgRow'), caseImgRow());
  };
  body.querySelector('#cImgRow')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 512);
      const r = await C.API.post(`/admin/cases/${data.id}/image`, { dataUrl });
      await C.reloadCatalog();
      if (!body.isConnected) return;
      setCaseImage(r.case.image);
      C.toast(C.t('a.saved'), 'ok');
    } catch (err) {
      adminError(err);
    }
  });
  body.querySelector('#cImgRow')?.addEventListener('click', async (e) => {
    if (!e.target.closest('#cImgDel')) return;
    try {
      await C.API.del(`/admin/cases/${data.id}/image`);
      await C.reloadCatalog();
      if (!body.isConnected) return;
      setCaseImage(null);
    } catch (err) {
      adminError(err);
    }
  });
  form.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      loot.splice(Number(rm.dataset.rm), 1);
      refresh();
    }
  });
  body.querySelector('#normLoot').addEventListener('click', () => {
    const sum = loot.reduce((s, e) => s + (Number(e.chance) || 0), 0);
    if (!sum) return;
    for (const e of loot) e.chance = Math.max(0.0001, Math.round(((Number(e.chance) || 0) / sum) * 1000000) / 10000);
    const diff = Math.round((100 - loot.reduce((s, e) => s + e.chance, 0)) * 10000) / 10000;
    if (loot.length && diff) {
      const top = loot.reduce((a, b) => (b.chance > a.chance ? b : a));
      top.chance = Math.round((top.chance + diff) * 10000) / 10000;
    }
    refresh();
  });
  body.querySelector('#addLoot').addEventListener('click', () =>
    pickItem(
      [...items.values()].filter((i) => !loot.some((e) => e.itemId === i.id)),
      (it) => {
        loot.push({ itemId: it.id, chance: 1 });
        refresh();
      },
    ),
  );
  body.querySelector('#delCase')?.addEventListener('click', async () => {
    if (!(await C.confirmModal(C.t('a.deleteCase')))) return;
    try {
      await C.API.del(`/admin/cases/${data.id}`);
      await C.reloadCatalog();
      C.go('#/admin/cases');
    } catch (e) {
      adminError(e);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const payload = {
      name_ru: f.get('name_ru'),
      name_uk: f.get('name_uk'),
      name_en: f.get('name_en'),
      emoji: f.get('emoji'),
      color: f.get('color'),
      sort: Number(f.get('sort') || 0),
      enabled: f.get('enabled') === 'on',
      price: data.is_free ? 0 : Number(f.get('price')),
      ...(data.is_free ? {} : { category_id: f.get('category_id') ? Number(f.get('category_id')) : null }),
      items: loot.map((x) => ({ itemId: x.itemId, chance: Number(x.chance) })),
    };
    try {
      const r = data.id ? await C.API.put(`/admin/cases/${data.id}`, payload) : await C.API.post('/admin/cases', payload);
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
      if (!data.id) C.go(`#/admin/cases/${r.case.id}`);
      else caseEditor(body, data.id);
    } catch (err) {
      adminError(err);
    }
  });
}

function pickItem(list, onPick) {
  const sheet = C.openModal(
    h`<div class="picker">
      <input class="input" id="pickSearch" placeholder="${C.t('a.search')}" autocomplete="off">
      <div class="picker-list" id="pickList"></div>
    </div>`,
    { cls: 'tall' },
  );
  const draw = (q) => {
    const s = q.trim().toLowerCase();
    const f = list.filter((i) => !s || i.name.toLowerCase().includes(s)).sort((a, b) => a.value - b.value);
    C.render(
      sheet.querySelector('#pickList'),
      h`${f.map((i) => h`<button class="row r-${i.rarity}" data-pick="${i.id}"><span class="row-art">${C.art(i)}</span><span class="row-main"><b>${i.name}</b><small>${C.money(i.value, 11)}</small></span></button>`)}`,
    );
  };
  draw('');
  sheet.querySelector('#pickSearch').addEventListener('input', (e) => draw(e.target.value));
  sheet.querySelector('#pickList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const it = list.find((i) => i.id === Number(b.dataset.pick));
    C.closeModal();
    onPick(it);
  });
}

// ------------------------------------------------------------------ items
async function itemsList(body) {
  const { items } = await C.API.get('/admin/items');
  if (!body.isConnected) return;
  C.render(
    body,
    h`<div class="adm-actions"><input class="input" id="itSearch" placeholder="${C.t('a.search')}" autocomplete="off"><button class="btn small" id="itNew">+ ${C.t('a.newItem')}</button></div>
    <div class="list" id="itList"></div>`,
  );
  const draw = (q) => {
    const s = (q || '').trim().toLowerCase();
    const f = items.filter((i) => !s || i.name.toLowerCase().includes(s)).sort((a, b) => a.value - b.value);
    C.render(
      body.querySelector('#itList'),
      h`${f.map(
        (i) => h`<button class="row r-${i.rarity}" data-item="${i.id}">
          <span class="row-art">${C.art(i)}</span>
          <span class="row-main"><b>${i.name}</b><small>${C.money(i.value, 11)} · ${C.t('r.' + i.rarity)} · ${C.t('a.inCases', { n: i.inCases })}</small></span>
          ${i.enabled ? '' : h`<span class="badge off">${C.t('a.off')}</span>`}
        </button>`,
      )}`,
    );
  };
  draw('');
  body.querySelector('#itSearch').addEventListener('input', (e) => draw(e.target.value));
  body.querySelector('#itList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-item]');
    if (b) itemEditor(items.find((i) => i.id === Number(b.dataset.item)), () => itemsList(body));
  });
  body.querySelector('#itNew').addEventListener('click', () => itemEditor(null, () => itemsList(body)));
}

function resizeImage(file, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let out = c.toDataURL('image/webp', 0.9);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
      resolve(out);
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = url;
  });
}

function itemEditor(item, done) {
  const it = item || { id: null, name: '', value: 10, emoji: '🎁', rarityOverride: null, image_url: '', enabled: true, withdrawable: false, hasUpload: false };
  const sheet = C.openModal(
    h`<form class="form" id="itemForm" autocomplete="off">
      <div class="sheet-title">${it.id ? it.name : C.t('a.newItem')}</div>
      <label>${C.t('a.name')}<input class="input" name="name" maxlength="60" value="${it.name}" required></label>
      <div class="grid3">
        <label>${C.t('a.value')}<input class="input" name="value" type="number" min="0" step="1" value="${it.value}" required></label>
        <label>${C.t('a.emoji')}<input class="input" name="emoji" maxlength="16" value="${it.emoji}" required></label>
        <label>${C.t('a.rarity')}<select class="input" name="rarity"><option value="">${C.t('a.auto')}</option>${RARITIES.map(
          (r) => h`<option value="${r}" ${it.rarityOverride === r ? C.raw('selected') : ''}>${C.t('r.' + r)}</option>`,
        )}</select></label>
      </div>
      ${it.id
        ? h`<div class="img-row">
            <span class="img-prev r-${it.rarity || 'common'}">${C.art(it)}</span>
            <label class="btn small ghost file-btn">${C.t('a.upload')}<input type="file" accept="image/*" id="imgFile" hidden></label>
            ${it.hasUpload ? h`<button type="button" class="btn small ghost" id="imgDel">${C.t('a.removeImg')}</button>` : ''}
          </div>`
        : ''}
      <label>${C.t('a.imageUrl')}<input class="input" name="image_url" maxlength="500" value="${it.image_url || ''}" placeholder="https://…"></label>
      <label class="switch"><input type="checkbox" name="enabled" ${it.enabled ? C.raw('checked') : ''}><i></i>${C.t('a.enabled')}</label>
      <label class="switch"><input type="checkbox" name="withdrawable" ${it.withdrawable ? C.raw('checked') : ''}><i></i>${C.t('a.withdrawable')}</label>
      <div class="form-foot"><button type="submit" class="btn primary">${C.t('a.save')}</button></div>
    </form>`,
    { cls: 'tall' },
  );
  const form = sheet.querySelector('#itemForm');
  sheet.querySelector('#imgFile')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      await C.API.post(`/admin/items/${it.id}/image`, { dataUrl });
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
      C.closeModal();
      done();
    } catch (err) {
      adminError(err);
    }
  });
  sheet.querySelector('#imgDel')?.addEventListener('click', async () => {
    try {
      await C.API.del(`/admin/items/${it.id}/image`);
      await C.reloadCatalog();
      C.closeModal();
      done();
    } catch (err) {
      adminError(err);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const payload = {
      name: f.get('name'),
      value: Number(f.get('value')),
      emoji: f.get('emoji'),
      rarity: f.get('rarity') || null,
      image_url: f.get('image_url') || null,
      enabled: f.get('enabled') === 'on',
      withdrawable: f.get('withdrawable') === 'on',
    };
    try {
      if (it.id) await C.API.put(`/admin/items/${it.id}`, payload);
      else await C.API.post('/admin/items', payload);
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
      C.closeModal();
      done();
    } catch (err) {
      adminError(err);
    }
  });
}

// ------------------------------------------------------------------ users
function userRow(u) {
  return h`<a class="row" href="#/admin/users/${u.id}">
    <span class="avatar sm">${u.photo ? h`<img src="${u.photo}" alt="" referrerpolicy="no-referrer">` : (u.name || '?')[0].toUpperCase()}</span>
    <span class="row-main"><b>${u.name}</b><small>${u.username ? '@' + u.username + ' · ' : ''}ID ${u.id}</small></span>
    <span class="row-side">${C.money(u.balance, 12)}${u.isAdmin ? h`<span class="badge ok">${C.t('a.admin')}</span>` : ''}${u.isBanned ? h`<span class="badge bad">${C.t('a.banned')}</span>` : ''}</span>
  </a>`;
}

async function usersList(body) {
  C.render(
    body,
    h`<div class="adm-actions"><input class="input" id="uSearch" placeholder="${C.t('a.userSearch')}" autocomplete="off" inputmode="search"></div>
    <div class="list" id="uList"><div class="spinner"></div></div>`,
  );
  let timer = null;
  let seq = 0;
  const load = async (q) => {
    const my = ++seq;
    const r = await C.API.get('/admin/users?q=' + encodeURIComponent(q || ''));
    if (my !== seq || !body.isConnected) return;
    C.render(body.querySelector('#uList'), h`${r.users.map(userRow)}`);
  };
  await load('');
  if (!body.isConnected) return;
  body.querySelector('#uSearch').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => load(e.target.value).catch(adminError), 250);
  });
}

/** How a brainrot got into the player's inventory. */
function itemSource(f) {
  const lang = document.documentElement.lang || 'ru';
  const caseName = f.case ? f.case.name[lang] || f.case.name.ru : '';
  const saysCase = /кейс|case/i.test(caseName); // «Драгон кейс» needs no «Кейс» in front
  switch (f.type) {
    case 'case':
      return caseName ? (saysCase ? caseName : C.t('a.src.case', { name: caseName })) : C.t('a.src.caseAny');
    case 'free':
      return caseName ? (saysCase ? caseName : C.t('a.src.free', { name: caseName })) : C.t('a.src.freeAny');
    case 'upgrade':
      return f.upgrade
        ? h`${C.t('a.src.upgrade')} · ${C.t('a.src.chance', { c: C.fmt(f.upgrade.chance) })} · ${C.t('a.src.bet')} ${C.money(f.upgrade.bet, 11)}`
        : C.t('a.src.upgrade');
    case 'admin':
      return f.admin ? C.t('a.src.adminName', { name: f.admin.name }) : C.t('a.src.admin');
    case 'deposit':
      return f.requestId ? h`<a class="src-link" href="#/admin/deposits/${f.requestId}">${C.t('a.r.deposit', { id: f.requestId })}</a>` : C.t('a.src.deposit');
    case 'refund':
      return f.requestId ? h`<a class="src-link" href="#/admin/withdrawals/${f.requestId}">${C.t('a.src.refund', { id: f.requestId })}</a>` : C.t('a.src.refundAny');
    default:
      return f.type;
  }
}

async function userDetail(body, id) {
  const d = await C.API.get(`/admin/users/${id}`);
  if (!body.isConnected) return;
  const u = d.user;
  const st = d.stats;
  C.render(
    body,
    h`<div class="form">
      <div class="form-head"><a class="back" href="#/admin/users">‹</a>
        <span class="avatar sm">${u.photo ? h`<img src="${u.photo}" alt="" referrerpolicy="no-referrer">` : (u.name || '?')[0].toUpperCase()}</span>
        <b>${u.name}</b>
      </div>
      <div class="kv"><span>ID</span><b>${u.id}</b></div>
      ${u.username ? h`<div class="kv"><span>Username</span><b>@${u.username}</b></div>` : ''}
      <div class="kv"><span>${C.t('a.lastSeen')}</span><b>${new Date(u.lastSeen).toLocaleString()}</b></div>
      <div class="kv"><span>${C.t('a.balance')}</span><b id="uBal">${C.money(u.balance, 14)}</b></div>
      <div class="bal-row">
        <input class="input" id="uAmount" type="number" step="1" placeholder="${C.t('a.amount')}">
        <button class="btn small" data-bal="add">${C.t('a.add')}</button>
        <button class="btn small ghost" data-bal="set">${C.t('a.set')}</button>
      </div>
      <div class="adm-actions wrap">
        <button class="btn small ${u.isBanned ? '' : 'danger'} ghost" data-flag="is_banned" data-v="${u.isBanned ? 'false' : 'true'}">${u.isBanned ? C.t('a.unban') : C.t('a.ban')}</button>
        <button class="btn small ghost" data-flag="is_admin" data-v="${u.isAdmin ? 'false' : 'true'}">${u.isAdmin ? C.t('a.removeAdmin') : C.t('a.makeAdmin')}</button>
        <button class="btn small ghost" data-flag="revoke_web" data-v="true">${C.t('a.revokeWeb')}</button>
        <button class="btn small" id="uGive">${C.t('a.giveItem')}</button>
      </div>
      <h4 class="sec-title">${C.t('stats')}</h4>
      <div class="stats compact">
        <div class="stat"><div class="s-val">${C.fmt(st.casesOpened)}</div><div class="s-lbl">${C.t('casesOpened')}</div></div>
        <div class="stat"><div class="s-val">${C.money(st.totalSpent, 12)}</div><div class="s-lbl">${C.t('a.spent')}</div></div>
        <div class="stat"><div class="s-val">${C.money(st.totalWon, 12)}</div><div class="s-lbl">${C.t('totalWon')}</div></div>
        <div class="stat"><div class="s-val">${C.fmt(st.upgradesWon)} / ${C.fmt(st.upgradesTotal)}</div><div class="s-lbl">${C.t('upgrades')}</div></div>
      </div>
      <h4 class="sec-title">${C.t('inventory')} <span class="cnt">${d.inventory.length}</span></h4>
      <div class="list">${d.inventory.map(
        (inv) => h`<div class="row r-${inv.item.rarity}" data-src="${inv.from.type}"><span class="row-art">${C.art(inv.item)}</span><span class="row-main"><b>${inv.item.name}</b><small>${C.money(inv.item.value, 11)}</small><small class="inv-src">${itemSource(inv.from)} · ${C.fmtDateTime(inv.at)}</small></span><button class="icon-btn small" data-inv="${inv.invId}">×</button></div>`,
      )}</div>
      ${d.log.length
        ? h`<h4 class="sec-title">${C.t('a.log')}</h4><div class="list">${d.log.map(
            (l) => h`<div class="row"><span class="row-main"><b class="${l.delta >= 0 ? 'pos' : 'neg'}">${l.delta >= 0 ? '+' : ''}${C.fmt(l.delta)}</b><small>${l.reason} · ${new Date(l.created_at).toLocaleString()}</small></span></div>`,
          )}</div>`
        : ''}
    </div>`,
  );
  body.onclick = async (e) => {
      const bal = e.target.closest('[data-bal]');
      const flag = e.target.closest('[data-flag]');
      const inv = e.target.closest('[data-inv]');
      try {
        if (bal) {
          const amount = Number(body.querySelector('#uAmount').value);
          if (!Number.isFinite(amount) || body.querySelector('#uAmount').value === '') return;
          await C.API.post(`/admin/users/${id}/balance`, { mode: bal.dataset.bal, amount });
          C.toast(C.t('a.saved'), 'ok');
          if (id === C.S.me.id) await C.reloadMe();
          return userDetail(body, id);
        }
        if (flag) {
          await C.API.post(`/admin/users/${id}/flags`, { [flag.dataset.flag]: flag.dataset.v === 'true' });
          C.toast(C.t('a.saved'), 'ok');
          return userDetail(body, id);
        }
        if (inv) {
          await C.API.del(`/admin/users/${id}/inventory/${inv.dataset.inv}`);
          return userDetail(body, id);
        }
        if (e.target.closest('#uGive')) {
          pickItem(C.S.items, async (it) => {
            try {
              await C.API.post(`/admin/users/${id}/give`, { itemId: it.id });
              C.toast(C.t('a.saved'), 'ok');
              userDetail(body, id);
            } catch (err) {
              adminError(err);
            }
          });
        }
      } catch (err) {
        adminError(err);
      }
    };
}

// ------------------------------------------------------------------ promo codes
async function promos(body) {
  const { promos: list } = await C.API.get('/admin/promos');
  if (!body.isConnected) return;
  C.render(
    body,
    h`<form class="form" id="promoNew" autocomplete="off">
      <label>${C.t('a.code')}<input class="input" name="code" maxlength="40" autocapitalize="characters"></label>
      <div class="grid3">
        <label>${C.t('a.coins')}<input class="input" name="amount" type="number" min="1" step="1" required></label>
        <label>${C.t('a.uses')}<input class="input" name="maxUses" type="number" min="1" step="1" value="1" required></label>
        <label>${C.t('a.hours')}<input class="input" name="expiresHours" type="number" min="0.1" step="0.1"></label>
      </div>
      <div class="form-foot"><button class="btn primary" type="submit">${C.t('a.create')}</button></div>
    </form>
    <div class="list">${list.map((p) => {
      const expired = p.expires_at && new Date(p.expires_at) < new Date();
      return h`<div class="row promo-row ${p.active && !expired ? '' : 'dim'}">
        <span class="row-main"><b class="code" data-copy="${p.code}">${p.code}</b><small>+${C.fmt(p.amount)} · ${C.t('a.used')}: ${C.fmt(p.uses)}/${C.fmt(p.max_uses)}${p.expires_at ? ' · ' + C.t('a.expires') + ' ' + new Date(p.expires_at).toLocaleString() : ''}</small></span>
        <button class="btn small ghost" data-toggle="${p.code}" data-v="${p.active ? 'false' : 'true'}">${p.active ? C.t('a.disable') : C.t('a.enable')}</button>
        <button class="icon-btn small" data-del="${p.code}">×</button>
      </div>`;
    })}</div>`,
  );
  body.querySelector('#promoNew').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await C.API.post('/admin/promos', {
        code: f.get('code') || '',
        amount: Number(f.get('amount')),
        maxUses: Number(f.get('maxUses')),
        expiresHours: f.get('expiresHours') ? Number(f.get('expiresHours')) : null,
      });
      C.toast(r.promo.code, 'ok');
      promos(body);
    } catch (err) {
      adminError(err);
    }
  });
  body.querySelector('.list').addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    const tog = e.target.closest('[data-toggle]');
    const del = e.target.closest('[data-del]');
    try {
      if (copy) {
        await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
        C.toast(C.t('a.copied'), 'ok');
      } else if (tog) {
        await C.API.patch(`/admin/promos/${encodeURIComponent(tog.dataset.toggle)}`, { active: tog.dataset.v === 'true' });
        promos(body);
      } else if (del) {
        if (!(await C.confirmModal(`${C.t('a.delete')} ${del.dataset.del}?`))) return;
        await C.API.del(`/admin/promos/${encodeURIComponent(del.dataset.del)}`);
        promos(body);
      }
    } catch (err) {
      adminError(err);
    }
  });
}

// ------------------------------------------------------------------ settings
const SETTING_FIELDS = [
  ['channel', 'text'],
  ['channel_url', 'url'],
  ['news_url', 'url'],
  ['support_url', 'url'],
  ['free_cooldown_hours', 'number'],
  ['free_require_sub', 'bool'],
  ['free_require_share', 'bool'],
  ['upgrade_edge', 'number'],
  ['upgrade_min_chance', 'number'],
  ['upgrade_max_chance', 'number'],
  ['upgrade_luck', 'number'],
  ['start_balance', 'number'],
  ['stars_rate', 'number'],
  ['welcome_ru', 'textarea'],
  ['welcome_uk', 'textarea'],
  ['welcome_en', 'textarea'],
];

async function settingsForm(body) {
  const { settings: s } = await C.API.get('/admin/settings');
  if (!body.isConnected) return;
  const fields = SETTING_FIELDS.filter(([k]) => Object.hasOwn(s, k)); // some are for the main admin only
  C.render(
    body,
    h`<form class="form" id="setForm" autocomplete="off">
      ${fields.map(([k, type]) => {
        if (type === 'bool') return h`<label class="switch"><input type="checkbox" name="${k}" ${s[k] ? C.raw('checked') : ''}><i></i>${C.t('a.s.' + k)}</label>`;
        if (type === 'textarea') return h`<label>${C.t('a.s.' + k)}<textarea class="input" name="${k}" rows="4" maxlength="1000">${s[k]}</textarea></label>`;
        return h`<label>${C.t('a.s.' + k)}<input class="input" name="${k}" type="${type === 'number' ? 'number' : 'text'}" ${type === 'number' ? C.raw('step="any"') : ''} value="${s[k]}" ${type === 'url' ? C.raw('placeholder="https://t.me/…"') : ''}></label>`;
      })}
      <div class="form-foot">
        <button type="button" class="btn ghost" id="chkChannel">${C.t('a.checkChannel')}</button>
        <button type="submit" class="btn primary">${C.t('a.save')}</button>
      </div>
      <div id="chanStatus" class="note"></div>
    </form>`,
  );
  const form = body.querySelector('#setForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const patch = {};
    for (const [k, type] of fields) {
      if (type === 'bool') patch[k] = f.get(k) === 'on';
      else if (type === 'number') patch[k] = Number(f.get(k));
      else patch[k] = String(f.get(k) || '');
    }
    try {
      await C.API.put('/admin/settings', patch);
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
    } catch (err) {
      adminError(err);
    }
  });
  body.querySelector('#chkChannel').addEventListener('click', async () => {
    try {
      const r = await C.API.post('/admin/check-channel');
      body.querySelector('#chanStatus').textContent = C.t(r.botIsAdmin ? 'a.botAdminOk' : 'a.botAdminNo', { t: r.title });
      body.querySelector('#chanStatus').className = 'note ' + (r.botIsAdmin ? 'ok' : 'bad');
    } catch (err) {
      adminError(err);
    }
  });
}

// ------------------------------------------------------------------ broadcast
async function broadcast(body) {
  const { status } = await C.API.get('/admin/broadcast');
  if (!body.isConnected) return;
  C.render(
    body,
    h`<form class="form" id="bForm">
      <label>${C.t('a.bText')}<textarea class="input" name="text" rows="6" maxlength="4000" required></textarea></label>
      <label class="switch"><input type="checkbox" name="button" checked><i></i>${C.t('a.bButton')}</label>
      <div class="form-foot"><button class="btn primary" type="submit" ${status.running ? C.raw('disabled') : ''}>${C.t('a.bSend')}</button></div>
      <div class="note" id="bStatus"></div>
    </form>`,
  );
  const showStatus = (st) => {
    const el = body.querySelector('#bStatus');
    if (!el) return;
    if (!st.startedAt) {
      el.textContent = '';
      return;
    }
    el.textContent = (st.running ? C.t('a.bRunning') + ' ' : '') + C.t('a.bStatus', { s: st.sent, t: st.total, f: st.failed });
  };
  showStatus(status);
  const poll = () => {
    if (bcastTimer) clearInterval(bcastTimer);
    bcastTimer = setInterval(async () => {
      try {
        const r = await C.API.get('/admin/broadcast');
        showStatus(r.status);
        if (!r.status.running) {
          clearInterval(bcastTimer);
          bcastTimer = null;
          const btn = body.querySelector('#bForm button[type=submit]');
          if (btn) btn.disabled = false;
        }
      } catch {
        /* ignore */
      }
    }, 1000);
  };
  if (status.running) poll();
  body.querySelector('#bForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const text = String(f.get('text') || '').trim();
    if (!text) return;
    const btn = e.target.querySelector('button[type=submit]');
    if (btn.disabled || !(await C.confirmModal(C.t('a.bConfirm')))) return;
    btn.disabled = true;
    try {
      const r = await C.API.post('/admin/broadcast', { text, button: f.get('button') === 'on' });
      showStatus(r.status);
      poll();
    } catch (err) {
      btn.disabled = false;
      adminError(err);
    }
  });
}


// ------------------------------------------------------------------ deposits & withdrawals
const SECTION_OF = { deposit: 'deposits', withdraw: 'withdrawals' };
const REQ_SCOPES = ['active', 'done', 'rejected'];
const isOpen = (r) => r.method === 'brainrot' && (r.status === 'new' || r.status === 'active');

function refreshCounts() {
  C.API.get('/admin/requests/counts')
    .then(({ counts }) => {
      for (const el of C.$$('.chip-n')) el.textContent = counts[el.dataset.cnt] ? String(counts[el.dataset.cnt]) : '';
    })
    .catch(() => {});
}

function avatar(u) {
  return h`<span class="avatar sm">${u.photo ? h`<img src="${u.photo}" alt="" referrerpolicy="no-referrer">` : (u.name || '?')[0].toUpperCase()}</span>`;
}

const statusBadge = (r) => h`<span class="badge st-${r.status}">${C.t('a.r.st.' + r.status)}</span>`;

function reqRow(r) {
  let sub;
  if (r.method === 'stars') sub = h`<span class="emo">⭐</span>${C.fmt(r.stars)} → ${C.money(r.coins, 11)}`;
  else if (r.kind === 'withdraw') {
    sub = h`<span>${r.nick}</span><span class="req-minis">${r.items.slice(0, 4).map((i) => h`<span class="r-${i.rarity}">${C.art(i)}</span>`)}</span>${
      r.items.length > 4 ? h`<span>+${r.items.length - 4}</span>` : ''
    }${C.money(r.total, 11)}`;
  } else if (r.offer) {
    sub = h`<span>${r.nick}</span><span class="req-minis">${r.offer.slice(0, 4).map((i) => h`<span class="r-${i.rarity}">${C.art(i)}</span>`)}</span>${
      r.offer.length > 4 ? h`<span>+${r.offer.length - 4}</span>` : ''
    }${C.money(r.offerTotal, 11)}`;
  } else sub = h`<span>${r.nick}</span>`;
  const last = r.lastText || r.details;
  return h`<a class="row req-row ${r.waiting ? 'wait' : ''}" href="#/admin/${SECTION_OF[r.kind]}/${r.id}" data-req="${r.id}">
    ${avatar(r.user)}
    <span class="row-main"><b>#${r.id} · ${r.user.name}</b><small>${sub}</small>${last ? h`<small class="req-last">${last}</small>` : ''}</span>
    <span class="row-side">${statusBadge(r)}<small class="req-time">${C.fmtDateTime(r.updatedAt)}</small></span>
  </a>`;
}

async function reqList(body, kind) {
  stopReqTimer();
  const my = ++reqSeq;
  const load = () => C.API.get(`/admin/requests?kind=${kind}&scope=${reqScope}`);
  const { requests } = await load();
  if (!body.isConnected || my !== reqSeq) return;
  const listHtml = (list) => (list.length ? h`<div class="list">${list.map(reqRow)}</div>` : h`<div class="empty-box"><p>${C.t('a.r.empty')}</p></div>`);
  C.render(
    body,
    h`<div class="seg adm-seg">${REQ_SCOPES.map((s) => h`<button type="button" data-scope="${s}" class="${reqScope === s ? 'on' : ''}">${C.t('a.r.sc.' + s)}</button>`)}</div>
    <div id="reqList">${listHtml(requests)}</div>`,
  );
  body.querySelector('.adm-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope]');
    if (!b || b.dataset.scope === reqScope) return;
    reqScope = b.dataset.scope;
    reqList(body, kind).catch(adminError);
  });
  // new requests and answers show up without reloading
  let sig = JSON.stringify(requests);
  let busy = false;
  reqTimer = setInterval(async () => {
    if (!body.isConnected || !body.querySelector('#reqList') || my !== reqSeq) return stopReqTimer();
    if (busy) return;
    busy = true;
    try {
      const r = await load();
      const next = JSON.stringify(r.requests);
      if (next !== sig && body.querySelector('#reqList') && my === reqSeq) {
        sig = next;
        C.render(body.querySelector('#reqList'), listHtml(r.requests));
        refreshCounts();
      }
    } catch {
      /* try again later */
    } finally {
      busy = false;
    }
  }, 8000);
}

function sysText(m, r) {
  const i = m.text.indexOf(':');
  const k = i < 0 ? m.text : m.text.slice(0, i);
  const arg = i < 0 ? '' : m.text.slice(i + 1);
  if (k === 'created') return C.t('a.r.sys.created');
  if (k === 'credit') return C.t('a.r.sys.credit', { n: C.fmt(Number(arg)) });
  if (k === 'give') {
    const it = r.items.find((x) => x.id === Number(arg)) || C.S.itemsById.get(Number(arg));
    return C.t('a.r.sys.give', { name: it ? it.name : '#' + arg });
  }
  if (k === 'status') return C.t('a.r.sys.' + (arg === 'done' ? 'done' : 'rejected'));
  return m.text;
}

function msgView(m, r) {
  if (m.author === 'system') return h`<div class="msg sys">${sysText(m, r)} · ${C.fmtDateTime(m.at)}</div>`;
  const mine = m.author === 'admin';
  return h`<div class="msg ${mine ? 'admin' : 'user'}">${m.text}<small>${mine ? (m.adminName || C.t('a.admin')) + ' · ' : ''}${C.fmtDateTime(m.at)}${
    mine && m.delivered === false ? h` · <b class="nd">⚠ ${C.t('a.r.notDelivered')}</b>` : ''
  }</small></div>`;
}

const itemLine = (i) =>
  h`<div class="row r-${i.rarity}"><span class="row-art">${C.art(i)}</span><span class="row-main"><b>${i.name}</b><small>${C.money(i.value, 11)}</small></span></div>`;
// a brainrot the player picked for a deposit, with how many of it
const offerLine = (i) =>
  h`<div class="row r-${i.rarity}"><span class="row-art">${C.art(i)}</span><span class="row-main"><b>${i.name}</b><small>${C.money(i.value, 11)}</small></span><span class="row-side"><b class="offer-n">×${i.count}</b></span></div>`;

let reqSig = '';
let reqDrawn = 0; // bumps on every redraw of the card; a refresh that started before it is stale
const chatSig = (d) => `${d.messages.length}:${d.messages.at(-1)?.id || 0}`;
const cardSig = (d) => `${d.request.status}:${d.request.coins}:${d.request.items.length}:${d.request.user.balance}:${d.request.user.blockedBot}`;

function drawReq(body, d, { keep = false } = {}) {
  const r = d.request;
  const u = r.user;
  reqSig = cardSig(d) + '|' + chatSig(d);
  reqDrawn++;
  const draft = keep ? body.querySelector('#reqMsg')?.value || '' : '';
  const amount = keep ? body.querySelector('#reqAmount')?.value || '' : '';
  const active = keep ? document.activeElement : null;
  const focused = active && (active.id === 'reqMsg' || active.id === 'reqAmount') ? active.id : null;
  const caret = focused === 'reqMsg' ? [active.selectionStart, active.selectionEnd] : null;
  const open = isOpen(r);
  C.render(
    body,
    h`<div class="form req">
      <div class="form-head"><a class="back" href="#/admin/${SECTION_OF[r.kind]}">‹</a><b>${C.t('a.r.' + r.kind, { id: r.id })}</b>${statusBadge(r)}</div>
      <a class="row" href="#/admin/users/${u.id}">${avatar(u)}<span class="row-main"><b>${u.name}</b><small>${u.username ? '@' + u.username + ' · ' : ''}ID ${u.id}</small></span><span class="row-side">${C.money(u.balance, 12)}</span></a>
      ${u.username ? h`<button type="button" class="btn small ghost req-tg" data-tg="https://t.me/${u.username}">${C.t('a.r.writeTg')}</button>` : ''}
      ${u.blockedBot ? h`<div class="note bad">${C.t('a.r.blocked')}</div>` : ''}
      ${r.nick ? h`<div class="kv"><span>${C.t('a.r.nick')}</span><b class="code" data-copy="${r.nick}">${r.nick}</b></div>` : ''}
      ${r.method === 'stars' ? h`<div class="kv"><span>${C.t('a.r.stars')}</span><b class="money"><span class="emo">⭐</span>${C.fmt(r.stars)} → ${C.money(r.coins, 13)}</b></div>` : ''}
      ${r.kind === 'deposit' && r.offer
        ? h`<h4 class="sec-title">${C.t('a.r.details')} <span class="cnt">${r.offer.reduce((s, i) => s + i.count, 0)}</span></h4>
           <div class="list">${r.offer.map(offerLine)}</div>
           <div class="kv"><span>${C.t('a.r.total')}</span><b>${C.money(r.offerTotal, 13)}</b></div>`
        : r.kind === 'deposit' && r.details
          ? h`<div class="req-field"><span>${C.t('a.r.details')}</span><div class="req-box">${r.details}</div></div>`
          : ''}
      ${r.kind === 'withdraw'
        ? h`<h4 class="sec-title">${C.t('a.r.items')} <span class="cnt">${r.items.length}</span></h4>
           <div class="list">${r.items.map(itemLine)}</div>
           <div class="kv"><span>${C.t('a.r.total')}</span><b>${C.money(r.total, 13)}</b></div>`
        : ''}
      ${r.exchange
        ? h`<h4 class="sec-title">${C.t('a.r.swapped')} <span class="cnt">${r.exchange.from.length}</span></h4>
           <div class="list">${r.exchange.from.map(itemLine)}</div>
           <div class="kv"><span>${C.t('a.r.rest')}</span><b>+${C.money(r.exchange.rest, 13)}</b></div>`
        : ''}
      ${r.kind === 'deposit' && r.method === 'brainrot' && r.coins ? h`<div class="kv"><span>${C.t('a.r.credited')}</span><b>${C.money(r.coins, 13)}</b></div>` : ''}
      ${r.kind === 'deposit' && r.items.length ? h`<h4 class="sec-title">${C.t('a.r.given')} <span class="cnt">${r.items.length}</span></h4><div class="list">${r.items.map(itemLine)}</div>` : ''}
      ${open
        ? h`<div class="req-acts">
            ${r.kind === 'deposit'
              ? h`<div class="bal-row"><input class="input" id="reqAmount" type="number" min="1" step="1" inputmode="numeric" placeholder="${C.t('a.amount')}" value="${amount}"><button type="button" class="btn small" data-ra="credit">${C.t('a.r.credit')}</button><button type="button" class="btn small ghost" data-ra="give">${C.t('a.r.give')}</button></div>`
              : ''}
            <div class="row2"><button type="button" class="btn ghost danger" data-ra="rejected">${C.t('a.r.reject')}</button><button type="button" class="btn primary" data-ra="done">${C.t('a.r.done')}</button></div>
          </div>`
        : ''}
      <h4 class="sec-title">${C.t('a.r.chat')}</h4>
      <div class="chat" id="reqChat">${d.messages.map((m) => msgView(m, r))}</div>
      <form class="chat-form" id="reqForm" autocomplete="off">
        <textarea class="input" id="reqMsg" rows="2" maxlength="2000" placeholder="${C.t('a.r.msgPh')}">${draft}</textarea>
        <button class="btn primary" type="submit">${C.t('a.r.send')}</button>
      </form>
    </div>`,
  );
  if (focused) {
    const el = body.querySelector('#' + focused);
    el?.focus();
    if (caret && el) el.setSelectionRange(caret[0], caret[1]);
  }

  const after = async (res, { scroll = false } = {}) => {
    if (!body.isConnected) return;
    drawReq(body, res);
    refreshCounts();
    if (scroll) body.querySelector('#reqForm')?.scrollIntoView({ block: 'center' });
  };

  body.querySelector('#reqForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = body.querySelector('#reqMsg');
    const text = ta.value.trim();
    if (!text) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await C.API.post(`/admin/requests/${r.id}/messages`, { text });
      if (!res.delivered) C.toast(C.t('a.r.notDeliveredToast'), 'error');
      await after(res, { scroll: true });
    } catch (err) {
      btn.disabled = false;
      adminError(err);
    }
  });

  body.onclick = async (e) => {
    const tgBtn = e.target.closest('[data-tg]');
    if (tgBtn) return C.openTg(tgBtn.dataset.tg);
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
      return C.toast(C.t('a.copied'), 'ok');
    }
    const ra = e.target.closest('[data-ra]');
    if (!ra || ra.disabled) return;
    const act = ra.dataset.ra;
    try {
      if (act === 'credit') {
        const input = body.querySelector('#reqAmount');
        const n = Number(input.value);
        if (!Number.isInteger(n) || n < 1) {
          input.focus();
          return adminError({ code: 'bad_field', data: { field: C.t('a.amount') } });
        }
        if (!(await C.confirmModal(C.t('a.r.creditConfirm', { n: C.fmt(n), u: u.name })))) return;
        const res = await C.API.post(`/admin/requests/${r.id}/credit`, { amount: n });
        body.querySelector('#reqAmount').value = '';
        C.toast(C.t('a.saved'), 'ok');
        if (u.id === C.S.me.id) await C.reloadMe();
        return after(res);
      }
      if (act === 'give') {
        return pickItem(C.S.items, async (it) => {
          try {
            const res = await C.API.post(`/admin/requests/${r.id}/give`, { itemId: it.id });
            C.toast(C.t('a.saved'), 'ok');
            await after(res);
          } catch (err) {
            adminError(err);
          }
        });
      }
      if (act === 'done' || act === 'rejected') {
        const q = act === 'done' ? 'a.r.doneConfirm' : r.kind === 'withdraw' ? 'a.r.rejectConfirmW' : 'a.r.rejectConfirm';
        if (!(await C.confirmModal(C.t(q, { id: r.id })))) return;
        const res = await C.API.post(`/admin/requests/${r.id}/status`, { status: act });
        C.toast(C.t('a.saved'), 'ok');
        return after(res);
      }
    } catch (err) {
      adminError(err);
    }
  };
}

async function reqDetail(body, kind, id) {
  stopReqTimer();
  const my = ++reqSeq;
  if (!Number.isSafeInteger(id) || id <= 0) return C.go(`#/admin/${SECTION_OF[kind]}`);
  const d = await C.API.get(`/admin/requests/${id}`);
  if (!body.isConnected || my !== reqSeq) return;
  if (d.request.kind !== kind) return C.go(`#/admin/${SECTION_OF[d.request.kind]}/${id}`);
  drawReq(body, d);
  // the player's answers arrive through the bot — show them while the card is open
  let busy = false;
  reqTimer = setInterval(async () => {
    if (!body.isConnected || !body.querySelector('#reqChat') || my !== reqSeq) return stopReqTimer();
    if (busy) return;
    busy = true;
    const drawn = reqDrawn;
    try {
      const n = await C.API.get(`/admin/requests/${id}`);
      const chat = body.querySelector('#reqChat');
      // an action redrew the card while this refresh was on its way: its data is older
      if (!body.isConnected || !chat || n.request.id !== id || drawn !== reqDrawn || my !== reqSeq) return;
      const next = cardSig(n) + '|' + chatSig(n);
      if (next === reqSig) return;
      if (reqSig.split('|')[0] === cardSig(n)) {
        // only new messages: update the conversation, leave the inputs alone
        reqSig = next;
        C.render(chat, h`${n.messages.map((m) => msgView(m, n.request))}`);
      } else drawReq(body, n, { keep: true });
      refreshCounts();
    } catch {
      /* try again later */
    } finally {
      busy = false;
    }
  }, 5000);
}
