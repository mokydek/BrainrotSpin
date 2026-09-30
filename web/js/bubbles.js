// Ocean background: rising bubbles on a canvas.

let tint = '170,225,255';

export function setBubbleTint(rgb) {
  tint = rgb;
}

export function startBubbles(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let bubbles = [];
  let raf = 0;
  let last = performance.now();

  function spawn(initial) {
    const r = Math.random() < 0.12 ? 8 + Math.random() * 10 : 1.5 + Math.random() * 6;
    return {
      x: Math.random() * w,
      y: initial ? Math.random() * h : h + r + Math.random() * 40,
      r,
      speed: 14 + r * 4.5 + Math.random() * 18, // px per second
      phase: Math.random() * Math.PI * 2,
      wobble: 6 + Math.random() * 14,
      freq: 0.6 + Math.random() * 1.1,
      alpha: 0.25 + Math.random() * 0.45,
    };
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = Math.round(Math.min(70, Math.max(22, (w * h) / 14000)));
    while (bubbles.length < target) bubbles.push(spawn(true));
    bubbles.length = target;
  }

  function drawBubble(b, x) {
    const g = ctx.createRadialGradient(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, x, b.y, b.r);
    g.addColorStop(0, `rgba(255,255,255,${0.55 * b.alpha})`);
    g.addColorStop(0.45, `rgba(${tint},${0.12 * b.alpha})`);
    g.addColorStop(1, `rgba(${tint},${0.32 * b.alpha})`);
    ctx.beginPath();
    ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(0.6, b.r * 0.08);
    ctx.strokeStyle = `rgba(${tint},${0.55 * b.alpha})`;
    ctx.stroke();
    if (b.r > 4) {
      ctx.beginPath();
      ctx.arc(x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.7 * b.alpha})`;
      ctx.fill();
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      if (!reduce) {
        b.y -= b.speed * dt;
        b.phase += b.freq * dt;
      }
      if (b.y < -b.r * 2) bubbles[i] = spawn(false);
      drawBubble(b, b.x + Math.sin(b.phase) * b.wobble);
    }
    if (!reduce) raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });
  start();
  return { redraw: () => (reduce ? frame(performance.now()) : null) };
}
