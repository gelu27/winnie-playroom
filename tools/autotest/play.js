// 自動試玩：iPad 橫向、觸控事件（CDP touch），每款遊戲操作 N 次以上
const { chromium, devices } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || __dirname + '/out';
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:8765/index.html';
const N = +(process.env.N || 60);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const DEV = process.env.DEV || 'ipad';

const INIT = () => {
  // 標記每個元素綁了哪些事件，方便找出可以點／拖的東西
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) {
    try { if (this instanceof Element) { const s = new Set((this.dataset.ev || '').split(' ').filter(Boolean)); s.add(t); this.dataset.ev = [...s].join(' '); } } catch {}
    return orig.call(this, t, f, o);
  };
  window.__log = [];
  const L = (k, v) => window.__log.push({ k, v, t: performance.now() });
  window.__L = L;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const src = this.src || ''; L('audio', src.startsWith('blob:') ? 'blob' : src.replace(location.origin + '/', ''));
    const p = play.call(this); if (p && p.catch) p.catch(e => L('audioerr', String(e && e.name) + ' ' + src.slice(-40)));
    return p;
  };
  document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'AUDIO') L('audioerr', 'load ' + e.target.src); }, true);
  if (window.speechSynthesis) {
    const sp = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (u) => { L('tts', (u.lang || '') + '|' + u.text); try { sp(u); } catch {} };
  }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) L('longtask', Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
  } catch {}
  window.__mut = 0; window.__lastMut = 0;
  const mo = new MutationObserver((ms) => { window.__mut += ms.length; window.__lastMut = performance.now(); });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['class', 'hidden', 'style', 'd', 'transform', 'cx', 'cy', 'x', 'y'] }));
  ['pointercancel'].forEach(t => document.addEventListener(t, (e) => L('pcancel', e.target && (e.target.className && e.target.className.baseVal !== undefined ? e.target.className.baseVal : e.target.className)), true));
  window.addEventListener('error', (e) => L('jserr', e.message));
};

const GAMES = ['animals', 'colors', 'shapes', 'count', 'tidy', 'dots', 'learn', 'sound', 'size', 'shadow', 'sort', 'help', 'puzzle', 'weather', 'half', 'net', 'clock', 'abc', 'kana', 'zhuyin', 'mul', 'add', 'princess', 'fruit', 'keys', 'safe'];
const NAMES = ['動物回家', '顏色排排站', '形狀嵌板', '數一數', '整理房間', '數字連連看', '認識東西', '聲音配對', '大小排排站', '影子配對', '一樣的放一起', '生活小幫手', '拼圖', '四季與天氣', '猜猜另一半', '摺摺看立體', '認識時鐘', '英文字母', '日文五十音', '注音符號', '九九乘法', '看圖加法', '兔兔公主', '切水果', '打字練習', '身體小祕密'];

// 在頁面裡找出目前畫面上可以操作的東西
const SCAN = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null; if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return null; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) return null; if (el.closest('[hidden]')) return null; return r; };
  const sheetOpen = !document.getElementById('sheet').hidden;
  const root = sheetOpen ? document.getElementById('sheet') : document.querySelector('.screen:not([hidden])');
  const screen = document.querySelector('.screen:not([hidden])')?.id;
  const out = []; let i = 0;
  for (const el of root.querySelectorAll('[data-ev]')) {
    const ev = el.dataset.ev; if (!/click|pointerdown/.test(ev)) continue;
    if (el.closest('.home') || el.id && /^homeBtn/.test(el.id) || el.id === 'toMenu' || el.id === 'toMenu2') continue;
    const r = vis(el); if (!r) continue;
    // 確認點下去真的會打到它（沒被蓋住）
    const cx = Math.min(innerWidth - 2, Math.max(2, r.left + r.width / 2)), cy = Math.min(innerHeight - 2, Math.max(2, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    const covered = !(top && (top === el || el.contains(top)));
    el.dataset.pw = 'c' + (i++);
    const tag = el.tagName.toLowerCase();
    out.push({ id: el.dataset.pw, tag, cls: (el.getAttribute('class') || '').slice(0, 40), ev, x: cx, y: cy, w: r.width, h: r.height, drag: /pointerdown/.test(ev) && !/click/.test(ev), covered, txt: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12) });
  }
  // 可能的放置目標：可見、夠大、沒有綁點擊的格子
  const drops = []; let j = 0;
  for (const el of root.querySelectorAll('div,span,section,svg,g,rect,circle,path,ellipse,polygon,li,button')) {
    if (el.dataset.ev && /pointerdown/.test(el.dataset.ev)) continue;
    const r = vis(el); if (!r) continue;
    if (r.width < 30 || r.height < 30 || r.width > innerWidth * .7 || r.height > innerHeight * .7) continue;
    if (el.querySelector('[data-ev*="pointerdown"]') || (el.parentElement && [...el.parentElement.children].some(c => c !== el && /pointerdown/.test(c.dataset.ev || '') && c.tagName !== 'BUTTON'))) continue;
    el.dataset.pd = 'd' + (j++);
    drops.push({ id: el.dataset.pd, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, cls: (el.getAttribute('class') && el.getAttribute('class').baseVal === undefined ? el.getAttribute('class') : '') });
  }
  const sig = root.innerHTML.length + ':' + root.querySelectorAll('*').length + ':' + (document.querySelector('.cheer') ? 'C' : '');
  return { screen, sheetOpen, cands: out, drops: drops.slice(0, 120), sig, done: !!document.querySelector('#again, #again2, .done-row button'), vw: innerWidth, vh: innerHeight };
};

(async () => {
  const browser = await chromium.launch();
  const dev = DEV === 'ipad' ? devices['iPad Pro 11 landscape'] : devices['Pixel 7 landscape'];
  const ctx = await browser.newContext({ ...dev, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const net = [];
  page.on('response', (r) => { if (r.status() >= 400) net.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', (e) => net.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') net.push('CONSOLE ' + m.text().slice(0, 200)); });

  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) })) });
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await page.waitForTimeout(60); await touch('touchEnd', []); };
  const drag = async (path, stepMs = 16) => {
    await touch('touchStart', [path[0]]);
    for (let k = 1; k < path.length; k++) { await touch('touchMove', [path[k]]); await page.waitForTimeout(stepMs); }
    await touch('touchEnd', []);
  };
  const line = (a, b, n = 12) => Array.from({ length: n + 1 }, (_, k) => [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);

  const results = {};
  const list = ONLY || GAMES;
  for (const g of list) {
    const gi = GAMES.indexOf(g);
    const R = { game: g, name: NAMES[gi], actions: 0, taps: 0, drags: 0, swipes: 0, rounds: 0, noReact: 0, stuck: [], latency: [], audioLat: [], small: new Set(), covered: new Set(), tts: {}, audio: 0, audioErr: [], longtask: [], pcancel: 0, jserr: [], screens: new Set(), net: [] };
    net.length = 0; console.error('start', g);
    await page.goto('about:blank');
    await page.goto(BASE);
    await page.evaluate((GAMES) => {
      localStorage.setItem('wt_settings', JSON.stringify({ rec: 'C', enRec: 'K', play: 20, rest: 20, music: 'off', v3: true, tiles: GAMES }));
      localStorage.setItem('wt_session', JSON.stringify({ end: Date.now() + 3 * 3600e3, warned: true, restEnd: null }));
    }, GAMES);
    await page.reload(); await page.waitForTimeout(1500);
    const sb = await page.locator('#startBtn').boundingBox();
    await tap(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.waitForTimeout(600);
    const tile = page.locator('#menuTiles .tile').nth(gi); await tile.scrollIntoViewIfNeeded();
    const tb = await tile.boundingBox();
    const t0 = Date.now();
    await tap(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.waitForTimeout(700);
    await tap(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/${g}-0.png` }); console.error('in', g);
    const tried = {}; let sameCount = 0, lastSig = '', shots = 1;
    const doneT = Date.now() + 240000;
    while (R.actions < N && Date.now() < doneT) {
      const s = await page.evaluate(SCAN);
      R.screens.add(s.screen + (s.sheetOpen ? '+sheet' : ''));
      if (s.screen === 'menu' || s.screen === 'start') { R.stuck.push(`第 ${R.actions} 步意外回到 ${s.screen}`); break; }
      for (const c of s.cands) { const m = Math.min(c.w, c.h); if (m < 60) R.small.add(`${c.tag}.${c.cls.split(' ')[0]}「${c.txt}」${Math.round(c.w)}×${Math.round(c.h)}`); if (c.covered) R.covered.add(`${c.tag}.${c.cls.split(' ')[0]}「${c.txt}」`); }
      if (s.done) {
        const again = s.cands.find(c => /🔁|再玩/.test(c.txt) || /again/.test(c.cls));
        R.rounds++;
        if (shots < 3) { await page.screenshot({ path: `${OUT}/${g}-done${shots}.png` }); shots++; }
        const b = await page.locator('#again, #again2, .done-row button').first().boundingBox().catch(() => null);
        if (b) { await tap(b.x + b.width / 2, b.y + b.height / 2); R.actions++; R.taps++; await page.waitForTimeout(1500); continue; }
      }
      if (!s.cands.length) { await page.waitForTimeout(800); sameCount++; if (sameCount > 6) { R.stuck.push(`第 ${R.actions} 步：畫面上沒有可以操作的東西（${s.screen}）`); break; } continue; }
      // 選擇動作：可拖的優先嘗試不同目標，否則點沒點過的
      const drags = s.cands.filter(c => c.drag && !/svg/.test(c.tag) && !/area|slice|dots|clockbox|kb/.test(c.cls));
      const draws = s.cands.filter(c => c.drag && (/svg/.test(c.tag) || /area|slice|dots|clockbox/.test(c.cls)));
      const taps = s.cands.filter(c => !c.drag || /parent/.test(c.cls));
      const before = await page.evaluate(() => [window.__mut, window.__log.length, performance.now()]);
      let kind;
      const r = Math.random();
      if (drags.length && (r < .8 || !taps.length)) {
        const d = drags[Math.floor(Math.random() * drags.length)];
        const key = d.cls + d.txt; tried[key] = tried[key] || new Set();
        let ts = s.drops.filter(z => Math.hypot(z.x - d.x, z.y - d.y) > 60 && !tried[key].has(Math.round(z.x / 40) + ',' + Math.round(z.y / 40)));
        if (!ts.length) { tried[key].clear(); ts = s.drops; }
        // 偏好較大的格子
        const sim = (z) => Math.abs(Math.log((z.w * z.h) / (d.w * d.h)));
        ts.sort((a, b) => sim(a) - sim(b));
        const z = ts[Math.floor(Math.random() * Math.min(ts.length, 6))] || { x: s.vw / 2, y: s.vh / 3 };
        tried[key].add(Math.round(z.x / 40) + ',' + Math.round(z.y / 40));
        // 小孩拖曳：抖動、速度不均
        const path = line([d.x, d.y], [z.x, z.y], 14).map(([x, y], k) => [x + (k ? (Math.random() - .5) * 10 : 0), y + (k ? (Math.random() - .5) * 10 : 0)]);
        await drag(path, 14 + Math.random() * 20); kind = 'drag'; R.drags++;
      } else if (draws.length && (Math.random() < .6 || !taps.length)) {
        const d = draws[Math.floor(Math.random() * draws.length)];
        let path;
        if (g === 'dots') {
          const pts = await page.evaluate(() => [...document.querySelectorAll('.screen:not([hidden]) svg text, .screen:not([hidden]) .dot, .screen:not([hidden]) circle')].map(e => { const r = e.getBoundingClientRect(); return { n: parseInt(e.textContent), x: r.left + r.width / 2, y: r.top + r.height / 2 }; }).filter(p => !isNaN(p.n)).sort((a, b) => a.n - b.n));
          path = []; for (let k = 0; k + 1 < pts.length; k++) path.push(...line([pts[k].x, pts[k].y], [pts[k + 1].x, pts[k + 1].y], 6));
          if (!path.length) path = line([d.x - d.w / 3, d.y], [d.x + d.w / 3, d.y]);
        } else {
          const a = [d.x + (Math.random() - .5) * d.w * .8, d.y + (Math.random() - .5) * d.h * .8], b = [d.x + (Math.random() - .5) * d.w * .8, d.y + (Math.random() - .5) * d.h * .8];
          path = line(a, b, 16);
        }
        await drag(path, 10); kind = 'swipe'; R.swipes++;
      } else {
        const pool = taps.length ? taps : s.cands;
        const fresh = pool.filter(c => !(tried['tap'] || new Set()).has(c.cls + c.txt));
        const c = (fresh.length && Math.random() < .7 ? fresh : pool)[Math.floor(Math.random() * (fresh.length && Math.random() < .7 ? fresh : pool).length)] || pool[0];
        tried['tap'] = tried['tap'] || new Set(); tried['tap'].add(c.cls + c.txt);
        if (/parent/.test(c.cls)) { await tap(c.x, c.y); } // 小孩誤觸家長鍵（短按）
        else await tap(c.x + (Math.random() - .5) * Math.min(20, c.w / 3), c.y + (Math.random() - .5) * Math.min(20, c.h / 3));
        kind = 'tap'; R.taps++;
      }
      R.actions++;
      await page.waitForTimeout(900 + Math.random() * 500);
      const after = await page.evaluate(([m, l, t]) => { const logs = window.__log.slice(l); const firstAudio = logs.find(x => x.k === 'audio' || x.k === 'tts'); return { mut: window.__mut - m, lastMut: window.__lastMut, firstMutLat: null, logs, audioLat: firstAudio ? firstAudio.t - t : null }; }, before);
      if (after.mut === 0 && !after.logs.some(x => x.k === 'audio' || x.k === 'tts')) R.noReact++;
      if (after.audioLat !== null) R.audioLat.push(Math.round(after.audioLat));
      for (const x of after.logs) {
        if (x.k === 'tts') R.tts[x.v] = (R.tts[x.v] || 0) + 1;
        if (x.k === 'audio') R.audio++;
        if (x.k === 'audioerr') R.audioErr.push(x.v);
        if (x.k === 'longtask') R.longtask.push(x.v);
        if (x.k === 'pcancel') R.pcancel++;
        if (x.k === 'jserr') R.jserr.push(x.v);
      }
      const s2 = await page.evaluate(() => { const root = document.querySelector('.screen:not([hidden])'); return root.innerHTML.length + ':' + root.querySelectorAll('*').length; });
      if (s2 === lastSig) sameCount++; else sameCount = 0; lastSig = s2;
      if (sameCount === 15) { R.stuck.push(`第 ${R.actions} 步：連續 15 次操作畫面都沒有變化`); await page.screenshot({ path: `${OUT}/${g}-stuck.png` }); }
    }
    // 測量：從點按到畫面反應（用一次乾淨的點按）
    await page.screenshot({ path: `${OUT}/${g}-end.png` });
    R.secs = Math.round((Date.now() - t0) / 1000);
    R.net = [...new Set(net)];
    for (const k of ['small', 'covered', 'screens']) R[k] = [...R[k]];
    const lt = R.longtask; R.longtaskMax = lt.length ? Math.max(...lt) : 0; R.longtaskN = lt.length; delete R.longtask;
    const al = R.audioLat.sort((a, b) => a - b); R.audioLatMed = al[Math.floor(al.length / 2)] || null; R.audioLatP90 = al[Math.floor(al.length * .9)] || null; delete R.audioLat; delete R.latency;
    results[g] = R;
    console.log(g, JSON.stringify({ a: R.actions, rounds: R.rounds, noReact: R.noReact, stuck: R.stuck.length, tts: Object.keys(R.tts).length, err: R.jserr.length + R.net.length, pc: R.pcancel, secs: R.secs }));
    fs.writeFileSync(`${OUT}/results-${DEV}-${(ONLY||["all"]).join("_")}.json`, JSON.stringify(results, null, 1));
  }
  await browser.close();
})();
