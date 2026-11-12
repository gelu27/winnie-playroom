// 情境測試：計時休息、家長鎖、亂按、手機版面、護眼量測
const { chromium, devices } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || __dirname + '/scen'; fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:8765/index.html';
const GAMES = ['animals', 'colors', 'shapes', 'count', 'tidy', 'dots', 'learn', 'sound', 'size', 'shadow', 'sort', 'help', 'puzzle', 'weather', 'half', 'net', 'clock', 'abc', 'kana', 'zhuyin', 'mul', 'add', 'princess', 'fruit', 'keys', 'safe'];
const R = {};
(async () => {
  const browser = await chromium.launch();
  const mk = async (dev) => {
    const ctx = await browser.newContext({ ...dev, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) })) });
    const tap = async (x, y, hold = 60) => { await touch('touchStart', [[x, y]]); await page.waitForTimeout(hold); await touch('touchEnd', []); };
    const tapSel = async (sel, hold) => { const b = await page.locator(sel).first().boundingBox().catch(() => null); if (!b) { console.error('no box', sel, await page.evaluate(() => document.querySelector('.screen:not([hidden])').id)); return; } await tap(b.x + b.width / 2, b.y + b.height / 2, hold); };
    const scr = () => page.evaluate(() => document.querySelector('.screen:not([hidden])').id + (document.getElementById('sheet').hidden ? '' : '+sheet'));
    const prep = async (sess, extra = {}) => {
      await page.goto(BASE);
      await page.evaluate(([sess, extra, GAMES]) => { localStorage.setItem('wt_settings', JSON.stringify(Object.assign({ rec: 'C', enRec: 'K', play: 10, rest: 10, music: 'off', v3: true, tiles: GAMES }, extra))); if (sess) localStorage.setItem('wt_session', JSON.stringify(sess)); else localStorage.removeItem('wt_session'); }, [sess, extra, GAMES]);
      await page.reload(); await page.waitForTimeout(800);
    };
    const enter = async (gi) => { const t = page.locator('#menuTiles .tile').nth(gi); await t.scrollIntoViewIfNeeded(); const b = await t.boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(700); await tap(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(1500); };
    return { ctx, page, tap, tapSel, scr, prep, enter, touch };
  };
  const ipad = await mk(devices['iPad Pro 11 landscape']);
  const { page, tap, tapSel, scr, prep, enter } = ipad;

  // 1. 時間到：遊戲中途的寬限、休息畫面、休息結束後小孩能不能自己再開
  {
    const now = await page.evaluate(() => Date.now()).catch(() => Date.now());
    await prep({ end: Date.now() + 8000, warned: false, restEnd: null });
    await tapSel('#startBtn'); await page.waitForTimeout(500);
    await enter(0); // 動物回家
    const log = [];
    for (let k = 0; k < 16; k++) { await page.waitForTimeout(5000); log.push(`${(k + 1) * 5}s:${await scr()}`); }
    R.timerMidRound = log;
    await page.screenshot({ path: OUT + '/rest.png' });
    // 重新整理後還在休息嗎
    await page.reload(); await page.waitForTimeout(800); await tapSel('#startBtn'); await page.waitForTimeout(600);
    R.reloadDuringRest = await scr();
    // 休息結束 → 開場 → 點太陽
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('wt_session')); s.restEnd = Date.now() + 2000; localStorage.setItem('wt_session', JSON.stringify(s)); });
    await page.reload(); await page.waitForTimeout(600); await tapSel('#startBtn'); await page.waitForTimeout(3500);
    R.afterRestScreen = await scr();
    await tapSel('#startBtn'); await page.waitForTimeout(600);
    R.afterRestTapSun = await scr();
    R.afterRestGate = await page.locator('#sheet h2').first().textContent().catch(() => null);
    if (R.afterRestTapSun === 'setup') { await tapSel('#setupChoices .choice:last-child'); await page.waitForTimeout(600); R.childPicks20 = await scr(); }
    await page.screenshot({ path: OUT + '/after-rest.png' });
  }
  // 2. 家長鍵：小孩長按 3 秒 + 亂點答案，平均幾次會打開
  {
    let opened = 0, trials = 40, tapsNeeded = [];
    for (let t = 0; t < trials; t++) {
      await prep({ end: Date.now() + 3600e3, warned: true, restEnd: null });
      await tapSel('#startBtn'); await page.waitForTimeout(300);
      await page.evaluate(() => localStorage.removeItem('wt_gate')); await page.reload(); await page.waitForTimeout(500); await tapSel('#startBtn'); await page.waitForTimeout(300);
      await tapSel('#parentBtn', 3200); await page.waitForTimeout(300);
      let n = 0;
      while (n < 8) {
        const btns = await page.locator('#sheet .answers button').all(); if (!btns.length) break;
        const b = await btns[Math.floor(Math.random() * btns.length)].boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); n++; await page.waitForTimeout(2200);
        if (await page.locator('#sheet .answers').count() === 0 && !(await page.locator('#sheet h2', { hasText: '家長設定' }).count())) { await tapSel('#parentBtn', 3200); await page.waitForTimeout(300); }
        if (await page.locator('#sheet h2', { hasText: '家長設定' }).count()) { opened++; tapsNeeded.push(n); break; }
      }
    }
    R.gate = { trials, opened, avgTaps: tapsNeeded.reduce((a, b) => a + b, 0) / (tapsNeeded.length || 1) };
  }
  // 3. 選單亂按：連續快速點 20 下（同一格／不同格）
  {
    const res = [];
    for (let t = 0; t < 10; t++) {
      await prep({ end: Date.now() + 3600e3, warned: true, restEnd: null });
      await tapSel('#startBtn'); await page.waitForTimeout(400);
      for (let k = 0; k < 20; k++) { await tap(100 + Math.random() * 1000, 120 + Math.random() * 650); await page.waitForTimeout(90); }
      await page.waitForTimeout(800); res.push(await scr());
    }
    R.menuMash = res;
  }
  // 4. 回家鍵：遊戲中點一下左上角就離開（沒有確認）
  {
    await prep({ end: Date.now() + 3600e3, warned: true, restEnd: null });
    await tapSel('#startBtn'); await page.waitForTimeout(400); await enter(1);
    await tap(48, 48); await page.waitForTimeout(500); R.homeOneTap = await scr();
    await tap(48, 48, 1000); await page.waitForTimeout(500); R.homeHold = await scr();
  }
  // 5. 護眼：每款遊戲畫面的高彩度像素比例、無限循環動畫數、閃動
  {
    const eye = {};
    for (let gi = 0; gi < GAMES.length; gi++) {
      await prep({ end: Date.now() + 3600e3, warned: true, restEnd: null });
      await tapSel('#startBtn'); await page.waitForTimeout(400); await enter(gi); await page.waitForTimeout(1200);
      const buf = await page.screenshot();
      const st = await page.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data; let hi = 0, n = 0, lum = 0;
        for (let i = 0; i < d.length; i += 16) { const r = d[i] / 255, g = d[i + 1] / 255, bb = d[i + 2] / 255, mx = Math.max(r, g, bb), mn = Math.min(r, g, bb), l = (mx + mn) / 2, s = mx === mn ? 0 : (l > .5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn)); if (s > .6 && l > .25 && l < .8) hi++; lum += l; n++; }
        const anims = document.getAnimations().filter(a => a.effect && a.effect.getTiming().iterations === Infinity && a.playState === 'running').length;
        const minFont = Math.min(...[...document.querySelectorAll('.screen:not([hidden]) *')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => parseFloat(getComputedStyle(e).fontSize)).filter(Boolean));
        return { hiSat: +(hi / n * 100).toFixed(1), lum: +(lum / n).toFixed(2), infAnims: anims, minFont };
      }, buf.toString('base64'));
      eye[GAMES[gi]] = st;
    }
    R.eye = eye;
  }
  // 6. 手機版面（Pixel 7 橫向）：有沒有按鈕跑出畫面、被蓋住
  {
    const ph = await mk(devices['Pixel 7 landscape']);
    const lay = {};
    for (let gi = 0; gi < GAMES.length; gi++) {
      await ph.prep({ end: Date.now() + 3600e3, warned: true, restEnd: null });
      await ph.tapSel('#startBtn'); await ph.page.waitForTimeout(400); await ph.enter(gi); await ph.page.waitForTimeout(1000);
      await ph.page.screenshot({ path: `${OUT}/phone-${GAMES[gi]}.png` });
      lay[GAMES[gi]] = await ph.page.evaluate(() => {
        const root = document.querySelector('.screen:not([hidden])'); const out = [], small = [], covered = [];
        for (const el of root.querySelectorAll('button, .item, .chip, .piece, .sz, .ppiece, .animal, .key, .qopt')) {
          const r = el.getBoundingClientRect(); if (r.width < 2) continue;
          if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) out.push((el.className || el.tagName) + '');
          if (Math.min(r.width, r.height) < 44) small.push((el.className || el.tagName) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
          const t = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
          if (t && !(t === el || el.contains(t))) covered.push((el.className || el.tagName) + '');
        }
        return { screen: root.id, vw: innerWidth, vh: innerHeight, offscreen: out.length, offEx: [...new Set(out)].slice(0, 4), small: small.length, smallEx: [...new Set(small)].slice(0, 4), covered: covered.length, covEx: [...new Set(covered)].slice(0, 4), scrollH: document.documentElement.scrollHeight > innerHeight + 2 };
      });
    }
    R.phone = lay;
  }
  fs.writeFileSync(OUT + '/scen.json', JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1).slice(0, 3000));
  await browser.close();
})();
