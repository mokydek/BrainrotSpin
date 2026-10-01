import { tg, html, raw, render, $, $$, sleep, store, haptic, coin, chest, itemArt, initials, countdown, rgba } from './util.js';
import { t, setLang, lang, fmt, fmtDate, fmtDateTime, LANGS } from './i18n.js';
import * as API from './api.js';
import { startBubbles, setBubbleTint } from './bubbles.js';

// ------------------------------------------------------------------ themes
export const THEMES = {
  sunset: { a1: '#FFD23F', a2: '#FF7A1A', on: '#1d1300', bg1: '#03131f', bg2: '#0a2c4a', bubble: '170,225,255' },
  graphite: { a1: '#E9EBEF', a2: '#8E96A3', on: '#0b0c0e', bg1: '#08090b', bg2: '#1d2027', bubble: '225,230,240' },
  mint: { a1: '#34F5A4', a2: '#1E90FF', on: '#00140d', bg1: '#02151a', bg2: '#05364a', bubble: '140,255,225' },
  redblue: { a1: '#FF4D6D', a2: '#3B82F6', on: '#ffffff', bg1: '#070a1c', bg2: '#0e2257', bubble: '185,200,255' },
  violet: { a1: '#C084FC', a2: '#F472B6', on: '#1b0626', bg1: '#0c0519', bg2: '#2a0c44', bubble: '240,185,255' },
  ocean: { a1: '#22D3EE', a2: '#3B82F6', on: '#001219', bg1: '#010e1c', bg2: '#023b66', bubble: '160,235,255' },
};

const ICON = {
  cases: '<svg viewBox="0 0 24 24"><path d="M3.5 9.5h17v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 9.5 6 4h12l2.5 5.5"/><path d="M10 13.5h4"/></svg>',
  upgrade: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16.5v-9M8.3 11.2 12 7.5l3.7 3.7"/></svg>',
  profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.4-4 4.4-6 8-6s6.6 2 8 6"/></svg>',
  admin: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  palette:
    '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z"/><circle cx="7.5" cy="11.5" r="1.2" fill="currentColor"/><circle cx="10" cy="7.5" r="1.2" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.2" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

// ------------------------------------------------------------------ state
const S = {
  me: null,
  cases: [],
  items: [],
  itemsById: new Map(),
  upgrade: { edge: 10, minChance: 1, maxChance: 80 },
  free: null,
  feed: [],
  top24: null,
  online: 0,
  stats: null,
  inventory: [],
  bot: null,
  links: {},
  topup: { starsRate: 1 },
  mode: null, // 'tg' inside Telegram, 'web' on the website
  theme: 'sunset',
  busy: false,
  up: { sel: new Set(), target: null, tab: 'inv' },
  freeSub: null, // null unknown, true/false after a check
  timers: [],
};
window.__BS = S; // handy for debugging in the browser console

const api = (p) => API.apiUrl(p);
const art = (item) => itemArt(item, api);
/** Case art: picture uploaded in the admin panel, otherwise a chest in the case colour. */
const caseImg = (c, size = 96) => {
  if (c && c.image) {
    const src = c.image.startsWith('/') ? api(c.image) : c.image;
    return html`<img class="case-img" src="${src}" alt="" decoding="async" width="${size}" height="${Math.round(size * 0.85)}">`;
  }
  return chest(c ? c.color : '', c ? c.emoji : '📦', size);
};

// ------------------------------------------------------------------ theme & language
function applyTheme(name, { save = false } = {}) {
  const th = THEMES[name] || THEMES.sunset;
  S.theme = THEMES[name] ? name : 'sunset';
  const r = document.documentElement.style;
  r.setProperty('--a1', th.a1);
  r.setProperty('--a2', th.a2);
  r.setProperty('--on', th.on);
  r.setProperty('--bg1', th.bg1);
  r.setProperty('--bg2', th.bg2);
  r.setProperty('--a1-soft', rgba(th.a1, 0.18));
  r.setProperty('--a2-soft', rgba(th.a2, 0.18));
  r.setProperty('--a1-glow', rgba(th.a1, 0.45));
  r.setProperty('--glass', rgba(th.bg1, 0.74));
  document.documentElement.dataset.theme = S.theme;
  setBubbleTint(th.bubble);
  try {
    tg?.setHeaderColor?.(th.bg1);
    tg?.setBackgroundColor?.(th.bg1);
    tg?.setBottomBarColor?.(th.bg1);
  } catch {
    /* older clients */
  }
  if (save) store.setItem('bs_theme', S.theme);
}

function tgLang() {
  const c = tg?.initDataUnsafe?.user?.language_code || navigator.language || '';
  if (c.startsWith('uk')) return 'uk';
  if (c.startsWith('en')) return 'en';
  return 'ru';
}

// ------------------------------------------------------------------ small UI helpers
function toast(msg, type = 'info') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

function errorText(e) {
  const code = e && e.code ? e.code : 'default';
  const key = 'e.' + code;
  const s = t(key);
  return s === key ? t('e.default') : s;
}

function showError(e) {
  haptic.notify('error');
  toast(errorText(e), 'error');
}

let modalClose = null;
function openModal(tpl, { onClose, cls = '' } = {}) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal-backdrop" data-act="close-modal"></div><div class="sheet ${cls}" role="dialog" aria-modal="true"></div>`;
  root.appendChild(wrap);
  const sheet = wrap.querySelector('.sheet');
  render(sheet, tpl);
  requestAnimationFrame(() => wrap.classList.add('show'));
  modalClose = onClose || null;
  return sheet;
}
function closeModal() {
  const wrap = $('#modal-root .modal-wrap');
  if (!wrap) return;
  const cb = modalClose;
  modalClose = null;
  wrap.classList.remove('show');
  setTimeout(() => wrap.remove(), 220);
  if (cb) cb();
}

function confirmModal(text) {
  return new Promise((resolve) => {
    let answered = false;
    const sheet = openModal(
      html`<div class="confirm"><p>${text}</p><div class="row2"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary" id="confirmYes">${t('yes')}</button></div></div>`,
      { onClose: () => !answered && resolve(false) },
    );
    sheet.querySelector('#confirmYes').addEventListener('click', () => {
      answered = true;
      closeModal();
      resolve(true);
    });
  });
}

let popClose = null;
function openPop(anchor, tpl) {
  closePop();
  const pop = document.createElement('div');
  pop.className = 'pop';
  render(pop, tpl);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pw - 8, r.right - pw))}px`;
  requestAnimationFrame(() => pop.classList.add('show'));
  const onDoc = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePop();
  };
  setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  popClose = () => {
    document.removeEventListener('click', onDoc, true);
    pop.remove();
  };
  return pop;
}
function closePop() {
  if (popClose) popClose();
  popClose = null;
}

function fmtChance(c) {
  return new Intl.NumberFormat(lang() === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: c < 0.01 ? 4 : 3 }).format(c);
}
const money = (n, size = 14) => html`<span class="money">${coin(size)}<b>${fmt(n)}</b></span>`;
const caseName = (c) => (c ? c.name[lang()] || c.name.ru : '');

// ------------------------------------------------------------------ shell
function shell() {
  render(
    $('#app'),
    html`
    <header class="top">
      <div class="brand">
        <img class="logo" src="img/logo.jpg" alt="" width="38" height="38">
        <div class="brand-text">
          <div class="brand-name">BrainrotSpin</div>
          <div class="online"><i class="dot"></i><span id="online"></span></div>
        </div>
      </div>
      <div class="top-actions">
        <button class="bal" data-act="topup" aria-label="${t('topup')}">${coin(18)}<b id="bal"></b><span class="plus">+</span></button>
        <button class="icon-btn lang-btn" data-act="lang" id="langBtn" aria-label="${t('language')}"></button>
        <button class="icon-btn" data-act="theme" id="themeBtn" aria-label="${t('theme')}">${raw(ICON.palette)}</button>
      </div>
    </header>
    <section class="live" id="live">
      <div class="live-title"><i class="dot pulse"></i><span>${t('liveDrops')}</span></div>
      <div class="live-row">
        <div class="top24" id="top24"></div>
        <div class="feed" id="feed"></div>
      </div>
    </section>
    <main id="view" class="view"></main>
    <nav class="tabbar" id="tabbar"></nav>`,
  );
  updateHeader();
  renderTop24();
  renderFeed();
  renderTabbar();
}

function updateHeader() {
  const bal = $('#bal');
  if (bal && S.me) bal.textContent = fmt(S.me.balance);
  const on = $('#online');
  if (on) on.textContent = t('online', { n: fmt(S.online) });
  const lb = $('#langBtn');
  if (lb) lb.textContent = (LANGS.find((l) => l.code === lang()) || LANGS[0]).label;
}

function setBalance(n) {
  if (!S.me || typeof n !== 'number') return;
  S.me.balance = n;
  const bal = $('#bal');
  if (bal) {
    bal.textContent = fmt(n);
    bal.parentElement.classList.remove('bump');
    void bal.parentElement.offsetWidth;
    bal.parentElement.classList.add('bump');
  }
}

function renderTabbar() {
  const cur = route().tab;
  const tabs = ['cases', 'upgrade', 'profile'].concat(S.me && S.me.isAdmin ? ['admin'] : []);
  render(
    $('#tabbar'),
    html`${tabs.map((k) => html`<button class="${cur === k ? 'on' : ''}" data-tab="${k}">${raw(ICON[k])}<span>${t('tab.' + k)}</span></button>`)}`,
  );
}

// ------------------------------------------------------------------ live drops
function dropTile(d, enter = false) {
  return html`<div class="drop r-${d.item.rarity}${enter ? ' enter' : ''}" title="${d.item.name}">
    <div class="drop-art">${art(d.item)}</div>
    <div class="drop-val">${coin(10)}${fmt(d.value)}</div>
    <div class="drop-user">${d.user.name}</div>
  </div>`;
}

function renderFeed() {
  const el = $('#feed');
  if (!el) return;
  if (!S.feed.length) return render(el, html`<div class="feed-empty">${t('empty')}</div>`);
  render(el, html`${S.feed.slice(0, 20).map((d) => dropTile(d))}`);
}

function renderTop24() {
  const el = $('#top24');
  if (!el) return;
  const d = S.top24;
  el.className = `top24${d ? ' r-' + d.item.rarity : ''}`;
  render(
    el,
    html`<div class="top24-label">${t('top24')}</div>
    ${d
      ? html`<div class="top24-body"><div class="top24-art">${art(d.item)}</div><div class="top24-info"><div class="top24-val">${coin(12)}${fmt(d.value)}</div><div class="top24-user">${d.user.name}</div></div></div>`
      : html`<div class="top24-empty">${t('empty')}</div>`}`,
  );
}

function onDrop(d) {
  if (!d || !d.item || S.feed.some((x) => x.id === d.id)) return;
  S.feed.unshift(d);
  S.feed.length = Math.min(S.feed.length, 30);
  const el = $('#feed');
  if (!el) return;
  if (el.querySelector('.feed-empty')) el.innerHTML = '';
  el.insertAdjacentHTML('afterbegin', dropTile(d, true).__html);
  while (el.children.length > 20) el.lastElementChild.remove();
}

// ------------------------------------------------------------------ routing
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [tab, arg, arg2] = h.split('/');
  if (tab === 'case' && arg) return { tab: 'cases', view: 'case', id: Number(arg) };
  if (tab === 'upgrade') return { tab: 'upgrade', view: 'upgrade' };
  if (tab === 'profile') return { tab: 'profile', view: 'profile' };
  if (tab === 'admin' && S.me && S.me.isAdmin) return { tab: 'admin', view: 'admin', sub: arg || 'overview', id: arg2 };
  return { tab: 'cases', view: 'cases' };
}
function go(hash) {
  if (location.hash === hash) renderView();
  else location.hash = hash;
}

function clearTimers() {
  for (const x of S.timers) clearInterval(x);
  S.timers = [];
}

let adminModule = null;
async function renderView() {
  closePop();
  clearTimers();
  const r = route();
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === r.tab));
  $('#live')?.classList.toggle('hidden', r.tab === 'admin');
  const back = r.view === 'case' || (r.view === 'admin' && r.id);
  try {
    if (back) {
      tg?.BackButton?.show();
    } else tg?.BackButton?.hide();
  } catch {
    /* older clients */
  }
  const view = $('#view');
  view.dataset.view = r.view;
  if (r.view === 'cases') viewCases(view);
  else if (r.view === 'case') viewCase(view, r.id);
  else if (r.view === 'upgrade') viewUpgrade(view);
  else if (r.view === 'profile') viewProfile(view);
  else if (r.view === 'admin') {
    if (!adminModule) adminModule = await import('./admin.js');
    adminModule.renderAdmin(view, r, adminCtx());
  }
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ cases
function freeCase() {
  return S.cases.find((c) => c.isFree);
}

function freeStatusText() {
  const f = S.free;
  if (!f) return '';
  return f.nextAt && new Date(f.nextAt) > new Date() ? t('freeIn', { t: countdown(f.nextAt) }) : t('freeReady');
}

function viewCases(view) {
  const fc = freeCase();
  const paid = S.cases.filter((c) => !c.isFree);
  render(
    view,
    html`
    ${fc
      ? html`<button class="free-card" data-case="${fc.id}">
          <div class="free-chest${fc.image ? ' has-img' : ''}">${caseImg(fc, 86)}</div>
          <div class="free-info">
            <div class="free-title">${caseName(fc)}</div>
            <div class="free-sub">${t('freeHint')}</div>
          </div>
          <div class="free-state ${S.free && S.free.nextAt && new Date(S.free.nextAt) > new Date() ? '' : 'ready'}" id="freeState">${freeStatusText()}</div>
        </button>`
      : ''}
    <div class="case-grid">
      ${paid.map(
        (c) => html`<button class="case-card" data-case="${c.id}" style="--cc:${c.color};--cca:${rgba(c.color, 0.34)}">
          <div class="case-glow"></div>
          <div class="case-art${c.image ? ' has-img' : ''}">${caseImg(c, 96)}</div>
          <div class="case-name">${caseName(c)}</div>
          <div class="case-price">${money(c.price, 15)}</div>
        </button>`,
      )}
    </div>`,
  );
  if (fc) {
    S.timers.push(
      setInterval(() => {
        const el = $('#freeState');
        if (!el) return;
        el.textContent = freeStatusText();
        el.classList.toggle('ready', !(S.free && S.free.nextAt && new Date(S.free.nextAt) > new Date()));
      }, 1000),
    );
  }
}

// weighted random for the decorative roulette strip
function randomFromCase(c) {
  let r = Math.random() * 100;
  for (const e of c.items) {
    if ((r -= e.chance) <= 0) return e.item;
  }
  return c.items[c.items.length - 1].item;
}

const STRIP = 60;
const WIN_INDEX = 52;

function rouletteTile(item) {
  return html`<div class="r-tile r-${item.rarity}"><div class="item-art">${art(item)}</div><div class="r-name">${item.name}</div></div>`;
}

function buildStrip(c, winner) {
  const list = [];
  for (let i = 0; i < STRIP; i++) {
    if (i === WIN_INDEX && winner) {
      list.push(winner);
      continue;
    }
    let it = randomFromCase(c);
    // avoid the same item twice in a row (purely cosmetic)
    for (let k = 0; k < 4 && c.items.length > 2 && (it.id === list[i - 1]?.id || (i + 1 === WIN_INDEX && winner && it.id === winner.id)); k++) {
      it = randomFromCase(c);
    }
    list.push(it);
  }
  return list;
}

function itemTile(item, { chance, extra } = {}) {
  return html`<div class="item r-${item.rarity}">
    ${chance !== undefined ? html`<div class="item-chance">${fmtChance(chance)}%</div>` : ''}
    <div class="item-art">${art(item)}</div>
    <div class="item-name">${item.name}</div>
    <div class="item-val">${coin(12)}${fmt(item.value)}</div>
    ${extra || ''}
  </div>`;
}

function freeTasks() {
  const f = S.free || {};
  const rows = [];
  if (f.requireSub) {
    const ok = S.freeSub === true;
    rows.push(html`<div class="task ${ok ? 'done' : ''}">
      <div class="task-num">${ok ? raw(ICON.check) : '1'}</div>
      <div class="task-text">${t('task1')}</div>
      ${ok
        ? ''
        : html`<div class="task-btns">
            ${f.channelUrl ? html`<button class="btn small ghost" data-act="subscribe">${t('subscribe')}</button>` : ''}
            <button class="btn small" data-act="check-sub">${t('check')}</button>
          </div>`}
    </div>`);
  }
  if (f.requireShare) {
    const ok = !!f.shared;
    rows.push(html`<div class="task ${ok ? 'done' : ''}">
      <div class="task-num">${ok ? raw(ICON.check) : f.requireSub ? '2' : '1'}</div>
      <div class="task-text">${t('task2')}</div>
      ${ok ? '' : html`<div class="task-btns"><button class="btn small" data-act="share">${t('share')}</button></div>`}
    </div>`);
  }
  return rows.length ? html`<div class="tasks">${rows}</div>` : '';
}

function openButton(c) {
  if (c.isFree) {
    const f = S.free || {};
    if (f.nextAt && new Date(f.nextAt) > new Date()) {
      return html`<div class="cooldown" id="cooldown">${t('nextFree', { t: countdown(f.nextAt) })}</div>`;
    }
    const ready = (!f.requireShare || f.shared) && (!f.requireSub || S.freeSub !== false);
    return html`<button class="btn primary big" data-act="open" data-id="${c.id}" ${ready ? '' : raw('disabled')}>${t('openFree')}</button>`;
  }
  const enough = S.me.balance >= c.price;
  return enough
    ? html`<button class="btn primary big" data-act="open" data-id="${c.id}">${t('open')} ${money(c.price, 18)}</button>`
    : html`<button class="btn primary big" disabled>${t('notEnough')}</button>`;
}

function viewCase(view, id) {
  const c = S.cases.find((x) => x.id === id);
  if (!c) return go('#/cases');
  render(
    view,
    html`
    <div class="view-head">
      <button class="back" data-act="back" aria-label="${t('back')}">${raw(ICON.back)}</button>
      <div class="vh-title">${caseName(c)}</div>
      <div class="vh-price">${c.isFree ? 'FREE' : money(c.price, 15)}</div>
    </div>
    <div class="roulette" id="roulette" style="--cc:${c.color}">
      <div class="r-track" id="track">${buildStrip(c).map(rouletteTile)}</div>
      <div class="r-marker"></div>
    </div>
    <div id="freeTasks">${c.isFree ? freeTasks() : ''}</div>
    <div class="open-row" id="openRow">${openButton(c)}</div>
    <h3 class="sec-title">${t('contents')}</h3>
    <div class="grid items">${c.items.map((e) => itemTile(e.item, { chance: e.chance }))}</div>`,
  );
  positionIdle();
  if (c.isFree) {
    S.timers.push(
      setInterval(() => {
        const cd = $('#cooldown');
        if (!cd) return;
        if (S.free.nextAt && new Date(S.free.nextAt) > new Date()) cd.textContent = t('nextFree', { t: countdown(S.free.nextAt) });
        else refreshOpenRow(c);
      }, 1000),
    );
    if (S.free && S.free.requireSub && S.freeSub !== true) checkSub(true);
  }
}

function refreshOpenRow(c) {
  const row = $('#openRow');
  if (row) render(row, openButton(c));
  const tasks = $('#freeTasks');
  if (tasks && c.isFree) render(tasks, freeTasks());
}

function tileStep() {
  const tile = $('#track .r-tile');
  if (!tile) return 110;
  const gap = parseFloat(getComputedStyle($('#track')).columnGap || getComputedStyle($('#track')).gap) || 8;
  return tile.offsetWidth + gap;
}

function offsetFor(index, jitter = 0) {
  const box = $('#roulette');
  const step = tileStep();
  const tileW = step - 8;
  return -(index * step - (box.clientWidth / 2 - tileW / 2) + jitter);
}

function positionIdle() {
  const track = $('#track');
  if (!track) return;
  track.style.transition = 'none';
  track.style.transform = `translateX(${offsetFor(6)}px)`;
}

async function spinTo(c, winner) {
  const track = $('#track');
  const items = buildStrip(c, winner);
  render(track, html`${items.map(rouletteTile)}`);
  track.style.transition = 'none';
  track.style.transform = `translateX(${offsetFor(4)}px)`;
  void track.offsetWidth;
  const step = tileStep();
  const jitter = (Math.random() - 0.5) * (step - 30);
  const target = offsetFor(WIN_INDEX, jitter);
  const duration = 5600;
  track.style.transition = `transform ${duration}ms cubic-bezier(0.1, 0.72, 0.12, 1)`;
  track.style.transform = `translateX(${target}px)`;
  // haptic tick each time a tile passes the marker
  const start = performance.now();
  let lastIdx = -1;
  let lastTick = 0;
  const box = $('#roulette');
  await new Promise((resolve) => {
    const tick = (now) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(track).transform);
      const idx = Math.floor((-m.m41 + box.clientWidth / 2) / step);
      if (idx !== lastIdx && now - lastTick > 45) {
        lastIdx = idx;
        lastTick = now;
        haptic.tick();
      }
      if (now - start < duration + 60) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  track.children[WIN_INDEX]?.classList.add('win');
  await sleep(350);
}

async function openCase(id) {
  const c = S.cases.find((x) => x.id === id);
  if (!c || S.busy) return;
  S.busy = true;
  const btn = $('[data-act="open"]');
  if (btn) btn.disabled = true;
  haptic.impact('medium');
  try {
    const res = c.isFree ? await API.post('/free/open') : await API.post(`/case/${c.id}/open`);
    if (!c.isFree) setBalance(res.balance);
    await spinTo(c, res.item);
    S.inventory.unshift({ invId: res.invId, item: res.item, at: new Date().toISOString() });
    if (S.stats) {
      S.stats.casesOpened++;
      S.stats.totalWon += res.item.value;
      if (!c.isFree) S.stats.totalSpent += c.price;
      if (!S.stats.bestDrop || res.item.value > S.stats.bestDrop.value) S.stats.bestDrop = res.item;
    }
    if (c.isFree) {
      S.free.nextAt = res.nextAt;
      S.free.shared = false;
    }
    showResult(res.item, res.invId);
  } catch (e) {
    showError(e);
    if (e.code === 'need_sub') S.freeSub = false;
    if (e.code === 'cooldown' && e.data.nextAt) S.free.nextAt = e.data.nextAt;
    if (e.code === 'not_enough' && typeof e.data.balance === 'number') setBalance(e.data.balance);
  } finally {
    S.busy = false;
    if (!afterBusy() && route().view === 'case' && route().id === id) refreshOpenRow(c);
  }
}

function showResult(item, invId) {
  const big = ['legendary', 'mythic', 'secret'].includes(item.rarity);
  haptic.notify(big ? 'success' : 'warning');
  haptic.impact('heavy');
  openModal(
    html`<div class="result r-${item.rarity}">
      <div class="result-title">${t('youWon')}</div>
      <div class="result-stage"><div class="rays"></div><div class="result-art">${art(item)}</div></div>
      <div class="result-rarity">${t('r.' + item.rarity)}</div>
      <div class="result-name">${item.name}</div>
      <div class="result-val">${money(item.value, 20)}</div>
      <div class="row2">
        <button class="btn ghost" data-act="sell-won" data-inv="${invId}">${t('sellFor')} ${money(item.value, 14)}</button>
        <button class="btn primary" data-act="close-modal">${t('keep')}</button>
      </div>
    </div>`,
    { cls: 'result-sheet' },
  );
}

async function sellItems(ids) {
  const res = await API.post('/sell', { ids });
  setBalance(res.balance);
  const set = new Set(ids.map(Number));
  S.inventory = S.inventory.filter((i) => !set.has(i.invId));
  for (const id of set) S.up.sel.delete(id);
  if (S.stats) S.stats.soldValue += res.amount;
  haptic.notify('success');
  toast(t('sold', { n: fmt(res.amount) }), 'ok');
  return res;
}

// ------------------------------------------------------------------ free case actions
async function checkSub(silent = false) {
  try {
    const r = await API.post('/free/check');
    S.freeSub = r.subscribed;
    Object.assign(S.free, { requireSub: r.requireSub, requireShare: r.requireShare, shared: r.shared, nextAt: r.nextAt, channelUrl: r.channelUrl });
    if (!silent) {
      if (r.subscribed) haptic.notify('success');
      else showError({ code: 'need_sub' });
    }
  } catch (e) {
    if (!silent) showError(e);
  }
  const c = freeCase();
  if (c && route().view === 'case' && route().id === c.id) refreshOpenRow(c);
}

async function doShare() {
  const c = freeCase();
  try {
    const r = await API.post('/free/share');
    const done = async () => {
      const st = await API.post('/free/shared');
      Object.assign(S.free, st);
      haptic.notify('success');
      if (c && route().view === 'case') refreshOpenRow(c);
    };
    if (r.preparedId && tg && tg.shareMessage && tg.isVersionAtLeast && tg.isVersionAtLeast('8.0')) {
      tg.shareMessage(r.preparedId, (sent) => {
        if (sent) done().catch(showError);
        else toast(t('e.share_failed'), 'error');
      });
    } else {
      if (tg && tg.openTelegramLink) tg.openTelegramLink(r.url);
      else window.open(r.url, '_blank', 'noopener');
      await done();
    }
  } catch (e) {
    showError(e);
  }
}

// ------------------------------------------------------------------ upgrader
function upChance(bet, target) {
  if (!(bet > 0) || !(target > 0)) return 0;
  const raw = (bet / target) * (100 - S.upgrade.edge);
  return Math.min(S.upgrade.maxChance, Math.floor(raw * 100) / 100);
}

function upBet() {
  let sum = 0;
  for (const inv of S.inventory) if (S.up.sel.has(inv.invId)) sum += inv.item.value;
  return sum;
}

function upTargets(bet) {
  return S.items.filter((i) => i.value > bet && upChance(bet, i.value) >= S.upgrade.minChance).sort((a, b) => a.value - b.value);
}

const GAUGE_R = 84;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

function viewUpgrade(view) {
  // drop selections that are no longer in the inventory
  const have = new Set(S.inventory.map((i) => i.invId));
  for (const id of [...S.up.sel]) if (!have.has(id)) S.up.sel.delete(id);
  const bet = upBet();
  const target = S.up.target ? S.itemsById.get(S.up.target) : null;
  if (target && target.value <= bet) S.up.target = null;
  render(
    view,
    html`
    <div class="gauge-wrap">
      <svg class="gauge" viewBox="0 0 200 200" aria-hidden="true">
        <defs><linearGradient id="gGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--a1)"/><stop offset="1" style="stop-color:var(--a2)"/></linearGradient></defs>
        <circle class="g-bg" cx="100" cy="100" r="${GAUGE_R}"/>
        <circle class="g-win" id="gWin" cx="100" cy="100" r="${GAUGE_R}" stroke-dasharray="0 ${GAUGE_C}"/>
        <g class="g-ptr" id="gPtr"><path d="M100 4l8 15h-16z"/></g>
      </svg>
      <div class="g-center"><div class="g-pct" id="gPct">0%</div><div class="g-lbl">${t('chance')}</div></div>
    </div>
    <div class="up-slots" id="upSlots"></div>
    <div class="open-row"><button class="btn primary big" data-act="do-upgrade" id="upBtn">${t('upgrade')}</button></div>
    <div class="seg" id="upSeg"></div>
    <div id="upGrid"></div>`,
  );
  updateUpgrade();
}

function updateUpgrade() {
  const bet = upBet();
  let target = S.up.target ? S.itemsById.get(S.up.target) : null;
  if (target && (target.value <= bet || upChance(bet, target.value) < S.upgrade.minChance)) {
    S.up.target = null;
    target = null;
  }
  const chance = target ? upChance(bet, target.value) : 0;
  const win = $('#gWin');
  if (win) win.setAttribute('stroke-dasharray', `${(GAUGE_C * chance) / 100} ${GAUGE_C}`);
  const pct = $('#gPct');
  if (pct) pct.textContent = `${fmt(chance)}%`;
  const selItems = S.inventory.filter((i) => S.up.sel.has(i.invId)).map((i) => i.item);
  render(
    $('#upSlots'),
    html`
    <div class="slot">
      <div class="slot-lbl">${t('bet')}</div>
      <div class="slot-art">${selItems.length ? selItems.slice(0, 3).map((i) => html`<span class="mini r-${i.rarity}">${art(i)}</span>`) : html`<span class="slot-ph">${t('pickItems')}</span>`}</div>
      <div class="slot-val">${bet ? money(bet, 13) : ''}</div>
    </div>
    <div class="slot-arrow">${raw(ICON.arrow)}</div>
    <div class="slot ${target ? 'r-' + target.rarity : ''}">
      <div class="slot-lbl">${t('target')}</div>
      <div class="slot-art">${target ? html`<span class="mini r-${target.rarity}">${art(target)}</span>` : html`<span class="slot-ph">${t('pickTarget')}</span>`}</div>
      <div class="slot-val">${target ? money(target.value, 13) : ''}</div>
    </div>`,
  );
  const btn = $('#upBtn');
  if (btn) btn.disabled = !(bet > 0 && target) || S.busy;
  render(
    $('#upSeg'),
    html`<button data-act="up-tab" data-v="inv" class="${S.up.tab === 'inv' ? 'on' : ''}">${t('myItems')} <span class="cnt">${S.inventory.length}</span></button>
    <button data-act="up-tab" data-v="targets" class="${S.up.tab === 'targets' ? 'on' : ''}">${t('targets')}</button>`,
  );
  const grid = $('#upGrid');
  if (!grid) return;
  if (S.up.tab === 'inv') {
    if (!S.inventory.length) {
      render(grid, html`<div class="empty-box"><p>${t('emptyInv')}</p><button class="btn small" data-act="to-cases">${t('toCases')}</button></div>`);
      return;
    }
    render(
      grid,
      html`<div class="grid items">${S.inventory.map(
        (inv) => html`<button class="item pick r-${inv.item.rarity} ${S.up.sel.has(inv.invId) ? 'sel' : ''}" data-act="up-pick" data-inv="${inv.invId}">
          <div class="pick-mark">${raw(ICON.check)}</div>
          <div class="item-art">${art(inv.item)}</div>
          <div class="item-name">${inv.item.name}</div>
          <div class="item-val">${coin(12)}${fmt(inv.item.value)}</div>
        </button>`,
      )}</div>`,
    );
  } else {
    const list = bet > 0 ? upTargets(bet) : [];
    if (!bet) {
      render(grid, html`<div class="empty-box"><p>${t('pickItems')}</p></div>`);
      return;
    }
    if (!list.length) {
      render(grid, html`<div class="empty-box"><p>${t('noTargets')}</p></div>`);
      return;
    }
    render(
      grid,
      html`<div class="grid items">${list.map(
        (it) => html`<button class="item pick r-${it.rarity} ${S.up.target === it.id ? 'sel' : ''}" data-act="up-target" data-id="${it.id}">
          <div class="item-chance">${fmt(upChance(bet, it.value))}%</div>
          <div class="pick-mark">${raw(ICON.check)}</div>
          <div class="item-art">${art(it)}</div>
          <div class="item-name">${it.name}</div>
          <div class="item-val">${coin(12)}${fmt(it.value)}</div>
        </button>`,
      )}</div>`,
    );
  }
}

async function doUpgrade() {
  const ids = [...S.up.sel];
  const target = S.up.target;
  if (!ids.length || !target || S.busy) return;
  S.busy = true;
  $('#upBtn').disabled = true;
  haptic.impact('medium');
  try {
    const res = await API.post('/upgrade', { ids, target });
    const ptr = $('#gPtr');
    const angle = 360 * 6 + (res.roll / 100) * 360;
    ptr.style.transition = 'none';
    ptr.style.transform = 'rotate(0deg)';
    void ptr.getBoundingClientRect();
    ptr.style.transition = 'transform 4.6s cubic-bezier(0.12, 0.75, 0.18, 1)';
    ptr.style.transform = `rotate(${angle}deg)`;
    await sleep(4750);
    const set = new Set(ids);
    S.inventory = S.inventory.filter((i) => !set.has(i.invId));
    S.up.sel.clear();
    S.up.tab = 'inv';
    if (res.won) S.inventory.unshift({ invId: res.invId, item: res.item, at: new Date().toISOString() });
    if (S.stats) {
      S.stats.upgradesTotal++;
      if (res.won) {
        S.stats.upgradesWon++;
        if (!S.stats.bestDrop || res.item.value > S.stats.bestDrop.value) S.stats.bestDrop = res.item;
      }
    }
    $('.gauge-wrap')?.classList.add(res.won ? 'won' : 'lost');
    haptic.notify(res.won ? 'success' : 'error');
    openModal(
      html`<div class="result ${res.won ? 'r-' + res.item.rarity : 'lost'}">
        <div class="result-title">${res.won ? t('upWin') : t('upLose')}</div>
        <div class="result-stage">${res.won ? html`<div class="rays"></div>` : ''}<div class="result-art">${res.won ? art(res.item) : raw('<span class="emo">💨</span>')}</div></div>
        ${res.won ? html`<div class="result-name">${res.item.name}</div><div class="result-val">${money(res.item.value, 20)}</div>` : ''}
        <div class="row2 one"><button class="btn primary" data-act="close-modal">OK</button></div>
      </div>`,
      {
        cls: 'result-sheet',
        onClose: () => {
          S.up.target = null;
          if (route().view === 'upgrade') viewUpgrade($('#view'));
        },
      },
    );
  } catch (e) {
    showError(e);
    if (e.code === 'items_missing') await refreshInventory();
  } finally {
    S.busy = false;
    if (!afterBusy()) {
      const btn = $('#upBtn');
      if (btn) btn.disabled = !(S.up.sel.size && S.up.target);
    }
  }
}

// ------------------------------------------------------------------ profile
function viewProfile(view) {
  const me = S.me;
  const st = S.stats || {};
  const invValue = S.inventory.reduce((s, i) => s + i.item.value, 0);
  render(
    view,
    html`
    <div class="p-card">
      <div class="avatar">${me.photo ? html`<img src="${me.photo}" alt="" referrerpolicy="no-referrer">` : initials(me.name)}</div>
      <div class="p-info">
        <div class="p-name">${me.name}</div>
        <div class="p-sub">${me.username ? '@' + me.username + ' · ' : ''}ID ${me.id}</div>
      </div>
      <div class="p-bal">${money(me.balance, 18)}</div>
    </div>
    <h3 class="sec-title">${t('stats')}</h3>
    <div class="stats">
      <div class="stat"><div class="s-val">${fmt(st.casesOpened || 0)}</div><div class="s-lbl">${t('casesOpened')}</div></div>
      <div class="stat"><div class="s-val">${money(st.totalWon || 0, 15)}</div><div class="s-lbl">${t('totalWon')}</div></div>
      <div class="stat best ${st.bestDrop ? 'r-' + st.bestDrop.rarity : ''}">
        <div class="s-val">${st.bestDrop ? html`<span class="best-art">${art(st.bestDrop)}</span><span class="best-name">${st.bestDrop.name}</span>` : '—'}</div>
        <div class="s-lbl">${t('bestDrop')}</div>
      </div>
      <div class="stat"><div class="s-val">${fmt(st.upgradesWon || 0)} / ${fmt(st.upgradesTotal || 0)}</div><div class="s-lbl">${t('upgrades')}</div></div>
      <div class="stat"><div class="s-val">${money(st.soldValue || 0, 15)}</div><div class="s-lbl">${t('soldFor')}</div></div>
      <div class="stat"><div class="s-val">${st.since ? fmtDate(st.since) : '—'}</div><div class="s-lbl">${t('since')}</div></div>
    </div>
    <div class="inv-head">
      <h3 class="sec-title">${t('inventory')} <span class="cnt">${S.inventory.length}</span>${S.inventory.length ? html` <span class="inv-sum">${money(invValue, 13)}</span>` : ''}</h3>
      ${S.inventory.length
        ? html`<div class="inv-btns"><button class="btn small" data-act="withdraw">${t('withdraw')}</button><button class="btn small ghost" data-act="sell-all">${t('sellAll')}</button></div>`
        : ''}
    </div>
    ${S.inventory.length
      ? html`<div class="grid items">${S.inventory.map(
          (inv) => html`<div class="item r-${inv.item.rarity}">
            <div class="item-art">${art(inv.item)}</div>
            <div class="item-name">${inv.item.name}</div>
            <button class="sell-btn" data-act="sell" data-inv="${inv.invId}">${t('sell')} ${coin(11)}${fmt(inv.item.value)}</button>
          </div>`,
        )}</div>`
      : html`<div class="empty-box"><p>${t('emptyInv')}</p><button class="btn small" data-act="to-cases">${t('toCases')}</button></div>`}`,
  );
}

async function refreshInventory() {
  try {
    const r = await API.get('/inventory');
    S.inventory = r.inventory;
  } catch {
    /* keep the old list */
  }
}

async function refreshMe() {
  try {
    const r = await API.get('/me');
    S.me = r.me;
    S.stats = r.stats;
    S.free = { ...S.free, ...r.free };
    updateHeader();
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ popovers & modals
function openLang(anchor) {
  const pop = openPop(
    anchor,
    html`<div class="pop-title">${t('language')}</div>${LANGS.map(
      (l) => html`<button class="pop-item ${l.code === lang() ? 'on' : ''}" data-lang="${l.code}"><b>${l.label}</b><span>${l.name}</span></button>`,
    )}`,
  );
  pop.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    closePop();
    const l = b.dataset.lang;
    setLang(l);
    store.setItem('bs_lang', l);
    haptic.tick();
    shell();
    renderView();
    API.post('/prefs', { lang: l }).catch(() => {});
    if (S.me) S.me.lang = l;
  });
}

function openTheme(anchor) {
  const pop = openPop(
    anchor,
    html`<div class="pop-title">${t('theme')}</div><div class="swatches">${Object.entries(THEMES).map(
      ([k, v]) => html`<button class="swatch ${k === S.theme ? 'on' : ''}" data-theme="${k}">
        <i style="background:linear-gradient(135deg, ${v.a1}, ${v.a2});box-shadow:0 0 0 3px ${v.bg2}"></i><span>${t('theme.' + k)}</span>
      </button>`,
    )}</div>`,
  );
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (!b) return;
    applyTheme(b.dataset.theme, { save: true });
    haptic.tick();
    $$('.swatch', pop).forEach((s) => s.classList.toggle('on', s.dataset.theme === S.theme));
    API.post('/prefs', { theme: S.theme }).catch(() => {});
  });
}

function openPromo() {
  const sheet = openModal(
    html`<div class="promo">
      <div class="sheet-title">${t('promo')}</div>
      <form id="promoForm" autocomplete="off">
        <input class="input" id="promoInput" maxlength="40" placeholder="${t('promoPh')}" autocapitalize="characters" spellcheck="false">
        <button class="btn primary big" type="submit">${t('activate')}</button>
      </form>
    </div>`,
  );
  const input = sheet.querySelector('#promoInput');
  setTimeout(() => input.focus(), 250);
  sheet.querySelector('#promoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    try {
      const r = await API.post('/promo', { code });
      setBalance(r.balance);
      haptic.notify('success');
      closeModal();
      toast(t('promoOk', { n: fmt(r.amount) }), 'ok');
      if (route().view === 'case' || route().view === 'profile') renderView();
    } catch (err) {
      showError(err);
    }
  });
}

// ------------------------------------------------------------------ top-up & withdrawal
const STARS_MAX = 10000;
const starsCoins = (n) => Math.floor(n * (S.topup.starsRate || 0) + 1e-9);
const tuHead = (title) =>
  html`<div class="tu-head"><button type="button" class="back" data-act="tu-menu" aria-label="${t('back')}">${raw(ICON.back)}</button><div class="sheet-title">${title}</div><span></span></div>`;

let tuSheet = null;
function tuBox() {
  return tuSheet && tuSheet.isConnected ? tuSheet.querySelector('#topup') : null;
}

function openTopup() {
  tuSheet = openModal(html`<div class="topup" id="topup"></div>`, { onClose: () => (tuSheet = null) });
  topupMenu();
}

function topupMenu() {
  const box = tuBox();
  if (!box) return;
  render(
    box,
    html`<div class="sheet-title">${t('topup')}</div>
    <div class="tu-opts">
      <button type="button" class="tu-opt stars" data-act="tu-stars"><span class="tu-ico emo">⭐</span><b>${t('tu.stars')}</b></button>
      <button type="button" class="tu-opt brainrots" data-act="tu-brainrots"><span class="tu-ico emo">🧠</span><b>${t('tu.brainrots')}</b></button>
    </div>
    <button type="button" class="btn ghost tu-promo" data-act="promo">${t('promo')}</button>`,
  );
}

function topupStars() {
  const box = tuBox();
  if (!box) return;
  const def = 100;
  render(
    box,
    html`${tuHead(t('tu.stars'))}
    <form class="form tu-form" id="starsForm" autocomplete="off">
      <label>${t('starsAmount')}<span class="stars-in"><span class="emo">⭐</span><input class="input" id="starsInput" type="number" inputmode="numeric" min="1" max="${STARS_MAX}" step="1" value="${def}"></span></label>
      <div class="tu-get"><span>=</span><span id="starsGet">${money(starsCoins(def), 20)}</span></div>
      <div id="starsPayRow"><button class="btn primary big" type="submit" id="starsPay">${t('pay')} <span class="emo">⭐</span><b id="starsN">${fmt(def)}</b></button></div>
    </form>`,
  );
  const input = box.querySelector('#starsInput');
  const value = () => {
    const n = Number(input.value);
    return Number.isInteger(n) && n >= 1 && n <= STARS_MAX && starsCoins(n) >= 1 ? n : 0;
  };
  const payBtn = () =>
    html`<button class="btn primary big" type="submit" id="starsPay">${t('pay')} <span class="emo">⭐</span><b id="starsN">${fmt(def)}</b></button>`;
  input.addEventListener('input', () => {
    const n = value();
    render(box.querySelector('#starsGet'), money(n ? starsCoins(n) : 0, 20));
    // the amount changed after the invoice link was made: that link is for the old amount
    if (box.querySelector('#starsLink')) render(box.querySelector('#starsPayRow'), payBtn());
    box.querySelector('#starsN').textContent = n ? fmt(n) : '—';
    box.querySelector('#starsPay').disabled = !n;
  });
  box.querySelector('#starsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = value();
    if (!n) return showError({ code: 'bad_stars' });
    payStars(n, box);
  });
}

async function payStars(stars, box) {
  const btn = box.querySelector('#starsPay');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  haptic.impact('light');
  let r;
  try {
    r = await API.post('/topup/stars', { stars });
  } catch (e) {
    btn.disabled = false;
    return showError(e);
  }
  if (S.mode === 'tg' && tg && typeof tg.openInvoice === 'function') {
    tg.openInvoice(r.link, (status) => {
      if (btn.isConnected) btn.disabled = false;
      if (status === 'paid') {
        closeModal();
        awaitCredit(r.invoice, 30);
      } else if (status === 'failed') showError({ code: 'pay_failed' });
    });
    return;
  }
  // Website: the invoice opens in Telegram; a real link avoids popup blockers.
  render(
    box.querySelector('#starsPayRow'),
    html`<a class="btn primary big" id="starsLink" href="${r.link}" target="_blank" rel="noopener">${t('pay')} <span class="emo">⭐</span><b>${fmt(stars)}</b></a>`,
  );
  box.querySelector('#starsLink').addEventListener('click', () => {
    closeModal();
    awaitCredit(r.invoice, 300);
  });
}

/** Polls the invoice until the bot has credited the Stars payment. */
let creditWatch = 0;
async function awaitCredit(invoice, seconds) {
  const my = ++creditWatch;
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until && my === creditWatch) {
    await sleep(1500);
    try {
      const r = await API.get('/topup/stars/' + encodeURIComponent(invoice));
      if (r.paid) {
        setBalance(r.balance);
        haptic.notify('success');
        toast(t('starsOk', { n: fmt(r.coins) }), 'ok');
        const v = route().view;
        if (!S.busy && (v === 'case' || v === 'profile')) renderView();
        return;
      }
    } catch {
      /* try again */
    }
  }
}

function topupBrainrots() {
  const box = tuBox();
  if (!box) return;
  render(
    box,
    html`${tuHead(t('tu.brainrots'))}
    <form class="form tu-form" id="depForm" autocomplete="off">
      <label>${t('nick')}<input class="input" name="nick" maxlength="32" value="${S.me.nick || ''}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label>${t('depWhat')}<textarea class="input" name="details" rows="3" maxlength="500"></textarea></label>
      <button class="btn primary big" type="submit">${t('sendReq')}</button>
    </form>`,
  );
  const form = box.querySelector('#depForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const nick = String(f.get('nick') || '').trim();
    const details = String(f.get('details') || '').trim();
    if (nick.replace(/^@+/, '').length < 3) return showError({ code: 'bad_nick' });
    if (details.length < 2) return showError({ code: 'bad_details' });
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await API.post('/requests/deposit', { nick, details });
      S.me.nick = r.request.nick;
      closeModal();
      haptic.notify('success');
      toast(t('reqSent', { id: r.request.id }), 'ok');
    } catch (err) {
      btn.disabled = false;
      showError(err);
    }
  });
}

function openWithdraw() {
  if (!S.inventory.length) return;
  const sel = new Set();
  const sheet = openModal(
    html`<div class="wd">
      <div class="sheet-title">${t('wdTitle')}</div>
      <form class="form tu-form" id="wdForm" autocomplete="off">
        <label>${t('nick')}<input class="input" name="nick" maxlength="32" value="${S.me.nick || ''}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <div class="fld-lbl">${t('wdPick')}</div>
        <div class="grid items" id="wdGrid">${S.inventory.map(
          (inv) => html`<button type="button" class="item pick r-${inv.item.rarity}" data-wd="${inv.invId}">
            <div class="pick-mark">${raw(ICON.check)}</div>
            <div class="item-art">${art(inv.item)}</div>
            <div class="item-name">${inv.item.name}</div>
            <div class="item-val">${coin(12)}${fmt(inv.item.value)}</div>
          </button>`,
        )}</div>
        <div class="wd-foot"><button class="btn primary big" type="submit" id="wdBtn" disabled>${t('withdraw')}</button></div>
      </form>
    </div>`,
    { cls: 'tall' },
  );
  const btn = sheet.querySelector('#wdBtn');
  const update = () => {
    const total = S.inventory.filter((i) => sel.has(i.invId)).reduce((s, i) => s + i.item.value, 0);
    render(btn, sel.size ? html`${t('withdraw')} ${money(total, 18)}` : html`${t('withdraw')}`);
    btn.disabled = !sel.size;
  };
  sheet.querySelector('#wdGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wd]');
    if (!b) return;
    const id = Number(b.dataset.wd);
    if (sel.has(id)) sel.delete(id);
    else if (sel.size >= 100) return;
    else sel.add(id);
    b.classList.toggle('sel', sel.has(id));
    haptic.tick();
    update();
  });
  const form = sheet.querySelector('#wdForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nick = String(new FormData(form).get('nick') || '').trim();
    if (nick.replace(/^@+/, '').length < 3) return showError({ code: 'bad_nick' });
    if (!sel.size) return;
    btn.disabled = true;
    try {
      const r = await API.post('/requests/withdraw', { nick, ids: [...sel] });
      const gone = new Set(r.removed);
      S.inventory = S.inventory.filter((i) => !gone.has(i.invId));
      for (const id of gone) S.up.sel.delete(id);
      S.me.nick = r.request.nick;
      closeModal();
      haptic.notify('success');
      toast(t('reqSent', { id: r.request.id }), 'ok');
      if (route().view === 'profile') viewProfile($('#view'));
    } catch (err) {
      btn.disabled = false;
      showError(err);
      if (err.code === 'items_missing') {
        await refreshInventory();
        closeModal();
        if (route().view === 'profile') viewProfile($('#view'));
      }
    }
  });
}

// ------------------------------------------------------------------ admin context
function adminCtx() {
  return {
    S,
    API,
    t,
    fmt,
    fmtDateTime,
    html,
    raw,
    render,
    $,
    $$,
    coin,
    chest,
    caseArt: caseImg,
    art,
    money,
    toast,
    showError,
    openModal,
    closeModal,
    confirmModal,
    go,
    fmtChance,
    openTg(url) {
      if (tg && tg.openTelegramLink && S.mode === 'tg' && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
      else window.open(url, '_blank', 'noopener');
    },
    async reloadCatalog() {
      const r = await API.get('/catalog');
      S.cases = r.cases;
      S.items = r.items;
      S.itemsById = new Map(r.items.map((i) => [i.id, i]));
      S.upgrade = r.upgrade;
      if (r.topup) S.topup = r.topup;
    },
    async reloadMe() {
      await refreshMe();
    },
  };
}

// ------------------------------------------------------------------ events
const actions = {
  'close-modal': () => closeModal(),
  back: () => {
    if (S.busy) return;
    if (history.length > 1) history.back();
    else go('#/cases');
  },
  promo: () => openPromo(),
  topup: () => openTopup(),
  'tu-menu': () => topupMenu(),
  'tu-stars': () => topupStars(),
  'tu-brainrots': () => topupBrainrots(),
  withdraw: () => openWithdraw(),
  lang: (el) => openLang(el),
  theme: (el) => openTheme(el),
  open: (el) => openCase(Number(el.dataset.id)),
  subscribe: () => {
    const url = S.free && S.free.channelUrl;
    if (!url) return;
    if (tg && tg.openTelegramLink && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
    else window.open(url, '_blank', 'noopener');
  },
  'check-sub': () => checkSub(false),
  share: () => doShare(),
  'sell-won': async (el) => {
    el.disabled = true;
    try {
      await sellItems([Number(el.dataset.inv)]);
      closeModal();
      const r = route();
      if (r.view === 'case') {
        const c = S.cases.find((x) => x.id === r.id);
        if (c) refreshOpenRow(c);
      }
    } catch (e) {
      el.disabled = false;
      showError(e);
    }
  },
  sell: async (el) => {
    el.disabled = true;
    try {
      await sellItems([Number(el.dataset.inv)]);
      if (route().view === 'profile') viewProfile($('#view'));
    } catch (e) {
      el.disabled = false;
      showError(e);
    }
  },
  'sell-all': async () => {
    const total = S.inventory.reduce((s, i) => s + i.item.value, 0);
    if (!(await confirmModal(t('confirmSellAll', { c: S.inventory.length, n: fmt(total) })))) return;
    try {
      const res = await API.post('/sell', { all: true });
      setBalance(res.balance);
      S.inventory = [];
      S.up.sel.clear();
      if (S.stats) S.stats.soldValue += res.amount;
      toast(t('sold', { n: fmt(res.amount) }), 'ok');
      haptic.notify('success');
      if (route().view === 'profile') viewProfile($('#view'));
    } catch (e) {
      showError(e);
    }
  },
  'to-cases': () => go('#/cases'),
  'up-tab': (el) => {
    S.up.tab = el.dataset.v;
    haptic.tick();
    updateUpgrade();
  },
  'up-pick': (el) => {
    if (S.busy) return;
    const id = Number(el.dataset.inv);
    if (S.up.sel.has(id)) S.up.sel.delete(id);
    else if (S.up.sel.size >= 6) return toast(t('maxItems'));
    else S.up.sel.add(id);
    haptic.tick();
    updateUpgrade();
  },
  'up-target': (el) => {
    if (S.busy) return;
    const id = Number(el.dataset.id);
    S.up.target = S.up.target === id ? null : id;
    haptic.tick();
    updateUpgrade();
  },
  'do-upgrade': () => doUpgrade(),
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab && !S.busy) {
    haptic.tick();
    const k = tab.dataset.tab;
    go(k === 'cases' ? '#/cases' : `#/${k}`);
    return;
  }
  const card = e.target.closest('[data-case]');
  if (card) {
    haptic.tick();
    go(`#/case/${card.dataset.case}`);
    return;
  }
  const a = e.target.closest('[data-act]');
  if (a && actions[a.dataset.act] && !a.disabled) {
    actions[a.dataset.act](a, e);
  }
});

window.addEventListener('hashchange', () => {
  if (S.busy) {
    S.routeChanged = true;
    return;
  }
  closeModal();
  renderView();
});

/** Re-render if the URL changed while an animation was running. */
function afterBusy() {
  if (S.routeChanged) {
    S.routeChanged = false;
    renderView();
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ boot
/** ?go=admin/deposits/12 (buttons in bot notifications) opens that screen. */
function openFromLink() {
  try {
    const u = new URL(location.href);
    const go = u.searchParams.get('go');
    if (go === null) return;
    u.searchParams.delete('go');
    const hash = /^[a-z0-9/_-]{1,80}$/i.test(go) ? '#/' + go : u.hash;
    history.replaceState(null, '', u.pathname + u.search + hash);
  } catch {
    /* ignore malformed URLs */
  }
}
function splash(noteKey) {
  render(
    $('#app'),
    html`<div class="splash">
      <img class="splash-logo" src="img/logo.jpg" alt="" width="120" height="120">
      <div class="splash-name">BrainrotSpin</div>
      <div class="splash-note" id="splashNote">${t(noteKey || 'loading')}</div>
    </div>`,
  );
}

async function showNoAuth() {
  let bot = null;
  try {
    bot = (await API.get('/public')).bot;
  } catch {
    /* offline */
  }
  render(
    $('#app'),
    html`<div class="splash">
      <img class="splash-logo" src="img/logo.jpg" alt="" width="120" height="120">
      <div class="splash-name">BrainrotSpin</div>
      <div class="splash-note">${t('openInTg')}</div>
      ${bot ? html`<a class="btn primary big" href="https://t.me/${bot}">${t('openBot')}</a>` : ''}
    </div>`,
  );
}

function applyBootstrap(b) {
  S.me = b.me;
  S.cases = b.cases;
  S.items = b.items;
  S.itemsById = new Map(b.items.map((i) => [i.id, i]));
  S.upgrade = b.upgrade;
  S.free = b.free;
  S.feed = b.live.feed;
  S.top24 = b.live.top24;
  S.online = b.live.online;
  S.stats = b.stats;
  S.inventory = b.inventory;
  S.bot = b.bot;
  S.links = b.links || {};
  if (b.topup) S.topup = b.topup;
  if (b.me.lang && b.me.lang !== lang() && !store.getItem('bs_lang')) setLang(b.me.lang);
  if (b.me.theme && !store.getItem('bs_theme')) applyTheme(b.me.theme);
}

async function boot() {
  const storedLang = store.getItem('bs_lang');
  setLang(storedLang || tgLang());
  applyTheme(store.getItem('bs_theme') || 'sunset');
  startBubbles($('#bubbles'));
  try {
    tg?.ready();
    tg?.expand();
    tg?.disableVerticalSwipes?.();
    tg?.BackButton?.onClick(() => actions.back());
  } catch {
    /* not in Telegram */
  }
  splash();
  const mode = API.initAuth();
  S.mode = mode;
  if (!mode) return showNoAuth();
  const wakeTimer = setTimeout(() => {
    const n = $('#splashNote');
    if (n) n.textContent = t('waking');
  }, 4000);
  try {
    const b = await API.post('/bootstrap');
    clearTimeout(wakeTimer);
    // Server-side language wins unless the user picked one on this device.
    if (!storedLang && b.me.lang) setLang(b.me.lang);
    applyBootstrap(b);
  } catch (e) {
    clearTimeout(wakeTimer);
    if (e.code === 'unauthorized' && mode === 'web') {
      API.clearWebAuth();
      return showNoAuth();
    }
    render(
      $('#app'),
      html`<div class="splash">
        <img class="splash-logo" src="img/logo.jpg" alt="" width="120" height="120">
        <div class="splash-name">BrainrotSpin</div>
        <div class="splash-note">${errorText(e)}</div>
        ${e.code !== 'banned' && e.code !== 'unauthorized' ? html`<button class="btn primary big" onclick="location.reload()">${t('retry')}</button>` : ''}
      </div>`,
    );
    return;
  }
  openFromLink();
  shell();
  renderView();
  const live = API.stream({
    drop: onDrop,
    online: (n) => {
      S.online = n;
      updateHeader();
    },
    top24: (d) => {
      S.top24 = d;
      renderTop24();
    },
  });
  live.start(S.feed.length ? S.feed[0].id : 0);
  const ping = () => {
    if (document.hidden) return;
    API.post('/ping')
      .then((r) => {
        S.online = r.online;
        updateHeader();
      })
      .catch(() => {});
  };
  setInterval(ping, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      ping();
      refreshMe();
    }
  });
}

boot();
