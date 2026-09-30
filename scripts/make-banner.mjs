// Renders web/img/banner.jpg (the /start picture) from the BrainrotSpin logo.
// node scripts/make-banner.mjs
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chest, coin } from '../web/js/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const logo = 'data:image/png;base64,' + readFileSync(path.join(root, 'assets', 'logo-original.png')).toString('base64');
const W = 1280;
const H = 640;

// deterministic pseudo-random so the banner is reproducible
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const bubbles = Array.from({ length: 70 }, () => {
  const r = rnd() < 0.15 ? 10 + rnd() * 18 : 2 + rnd() * 8;
  const x = rnd() * W;
  const y = rnd() * H;
  const a = 0.25 + rnd() * 0.5;
  return `<g opacity="${a.toFixed(2)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#bub)" stroke="rgba(170,225,255,.7)" stroke-width="${Math.max(0.8, r * 0.08).toFixed(2)}"/><circle cx="${(x - r * 0.35).toFixed(1)}" cy="${(y - r * 0.4).toFixed(1)}" r="${(r * 0.22).toFixed(1)}" fill="rgba(255,255,255,.8)"/></g>`;
}).join('');

const coins = [
  [180, 520, 54, -18], [300, 575, 40, 12], [1090, 540, 58, 20], [985, 590, 38, -10], [120, 140, 34, 25],
  [1165, 130, 38, -22], [455, 95, 30, 8], [835, 88, 32, -14], [560, 590, 34, 16], [735, 600, 30, -6],
].map(([x, y, s, rot]) => `<div class="coin" style="left:${x - s / 2}px;top:${y - s / 2}px;transform:rotate(${rot}deg)">${coin(s).__html}</div>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: E; src: local('Noto Color Emoji'); }
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#021019}
  .bg{position:absolute;inset:0;background:
      radial-gradient(60% 75% at 50% 42%, rgba(255,196,60,.28), transparent 70%),
      radial-gradient(90% 70% at 50% -10%, #0b4b80 0%, transparent 70%),
      linear-gradient(180deg,#073461 0%,#03182c 70%,#020d18 100%)}
  .rays{position:absolute;inset:-20% -10% 30%;opacity:.35;
      background:repeating-linear-gradient(100deg,transparent 0 5%,rgba(255,255,255,.10) 6% 8%,transparent 9% 14%);
      -webkit-mask-image:linear-gradient(180deg,#000,transparent 90%)}
  svg.b{position:absolute;inset:0}
  .logo{position:absolute;left:50%;top:50%;width:400px;height:400px;margin:-200px 0 0 -200px;border-radius:50%;
      background:url(${logo}) center/cover;
      box-shadow:0 0 0 8px #ffcf3a,0 0 0 14px rgba(255,140,20,.55),0 0 90px 30px rgba(255,170,40,.45),0 30px 60px rgba(0,0,0,.6)}
  .ch{position:absolute;filter:drop-shadow(0 22px 26px rgba(0,0,0,.55))}
  .ch .emo{font-family:'Noto Color Emoji',sans-serif}
  .c1{left:70px;top:190px;transform:rotate(-8deg)}
  .c2{right:70px;top:190px;transform:rotate(8deg)}
  .c3{left:275px;top:360px;transform:rotate(-4deg) scale(.8)}
  .c4{right:275px;top:360px;transform:rotate(4deg) scale(.8)}
  .coin{position:absolute;filter:drop-shadow(0 6px 8px rgba(0,0,0,.45))}
  .coin svg{display:block}
</style></head><body>
<div class="bg"></div><div class="rays"></div>
<svg class="b" width="${W}" height="${H}"><defs>
  <radialGradient id="bub" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="rgba(255,255,255,.55)"/><stop offset=".5" stop-color="rgba(170,225,255,.10)"/><stop offset="1" stop-color="rgba(170,225,255,.35)"/></radialGradient>
  <linearGradient id="bs-coin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset=".55" stop-color="#ffc233"/><stop offset="1" stop-color="#e8940f"/></linearGradient>
  <linearGradient id="bs-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".5" stop-color="#f6c343"/><stop offset="1" stop-color="#c98912"/></linearGradient>
</defs>${bubbles}</svg>
<div class="ch c3">${chest('#8b5cf6', '🎮', 220).__html}</div>
<div class="ch c4">${chest('#06b6d4', '🐟', 220).__html}</div>
<div class="ch c1">${chest('#f59e0b', '🦅', 280).__html}</div>
<div class="ch c2">${chest('#ef4444', '🐉', 280).__html}</div>
${coins}
<div class="logo"></div>
</body></html>`;

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(300);
const out = path.join(root, 'web', 'img', 'banner.jpg');
await page.screenshot({ path: out, type: 'jpeg', quality: 90 });
await browser.close();
console.log('banner written to', out);
