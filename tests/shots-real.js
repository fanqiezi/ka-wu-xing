/*
 * 真实游戏在手机尺寸下的截图 + 自检（开发用，需要 puppeteer-core + 本机 Chrome）
 * 用法： NODE_PATH=<装了 puppeteer-core 的 node_modules> node tests/shots-real.js
 * 输出： dist/real-{portrait,landscape,desktop}.png + 控制台自检
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(__dirname, '..');
const url = q => 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + q;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: false,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });

  const cases = [
    { name: 'desktop', q: '?layout=desktop', w: 1280, h: 800, touch: false },
    { name: 'portrait', q: '?layout=portrait', w: 390, h: 844, touch: true },
    { name: 'landscape', q: '?layout=landscape', w: 844, h: 390, touch: true }
  ];

  for (const c of cases) {
    const page = await browser.newPage();
    await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: 2, hasTouch: c.touch, isMobile: c.touch });
    await page.goto(url(c.q), { waitUntil: 'load' });
    await page.waitForFunction('window.KWX_UI !== undefined', { timeout: 5000 });
    await page.click('#start-btn');                 // 开局
    await sleep(400);
    // 把 AI 调快一点，让它多走几步，画面更真实
    await page.evaluate(() => { const g = window.KWX_UI.getGame(); if (g) g.speed = 0; });
    // 等到轮到自己出牌（这样操作栏有按钮、手牌可点）
    for (let i = 0; i < 60; i++) {
      const p = await page.evaluate(() => {
        const a = window.KWX_UI.getPending();
        return a ? a.kind : null;
      });
      if (p === 'discard' || p === 'self') break;
      await sleep(120);
    }
    // 竖屏顺手点一张手牌，展示「二次点击出牌」的确认条
    if (c.name === 'portrait') {
      await page.evaluate(() => {
        const t = document.querySelectorAll('#seat-0 .hand-row .tile.clickable');
        if (t.length) t[t.length - 1].click();
      });
      await sleep(200);
    }

    const info = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const rect = n => { if (!n) return null; const b = n.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      const hand = q('#seat-0 .hand-row');
      let rows = 0;
      if (hand) {
        const tops = new Set();
        // 用 offsetTop（不受 .picked 的位移影响）
        hand.querySelectorAll('.tile').forEach(t => tops.add(t.offsetTop));
        rows = tops.size;
      }
      return {
        body: document.body.className,
        layout: window.KWX_UI.getLayout(),
        hudParent: q('.hud') ? (q('.hud').parentNode.id || q('.hud').parentNode.className) : null,
        app: rect(q('#app')), topbar: rect(q('#topbar')), table: rect(q('#table')),
        opponents: rect(q('.opponents')), seatOpp: rect(q('#seat-2')),
        centerCol: rect(q('#center-col')), seatSelf: rect(q('#seat-0')),
        hand: rect(hand), handRows: rows, handTiles: hand ? hand.querySelectorAll('.tile').length : 0,
        actionbar: rect(q('#actionbar')), sidebar: rect(q('.sidebar')),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        win: [window.innerWidth, window.innerHeight]
      };
    });
    console.log('\n== ' + c.name + ' ' + c.w + 'x' + c.h + ' 视口=' + info.win.join('x') +
      ' body="' + info.body + '" 判定=' + info.layout + ' 横向溢出=' + info.overflowX);
    console.log('   四个方框挂在: ' + info.hudParent);
    [['#app', info.app], ['#topbar', info.topbar], ['.opponents', info.opponents], ['#seat-2(上家)', info.seatOpp],
      ['#center-col', info.centerCol], ['#seat-0(你)', info.seatSelf], ['手牌行', info.hand],
      ['#actionbar', info.actionbar], ['.sidebar', info.sidebar]].forEach(([k, v]) => {
      console.log('   ' + String(k).padEnd(16) + (v ? v[2] + 'x' + v[3] + ' @' + v[0] + ',' + v[1] : '（无）'));
    });
    console.log('   手牌 ' + info.handTiles + ' 张，排成 ' + info.handRows + ' 行');
    if (info.seatOpp && info.seatSelf) {
      const gap = info.seatSelf[1] - (info.seatOpp[1] + info.seatOpp[3]);
      console.log('   >>> 上家底 ' + (info.seatOpp[1] + info.seatOpp[3]) + ' / 你顶 ' + info.seatSelf[1] +
        ' → 间距 ' + gap + (gap < 0 ? '  ❌ 重叠' : '  ✓'));
    }
    await page.screenshot({ path: path.join(ROOT, 'dist', 'real-' + c.name + '.png') });
    // 再看一眼弹窗（手机版应变成底部抽屉）
    if (c.name !== 'desktop') {
      await page.click('#btn-history');
      await sleep(250);
      const sheet = await page.evaluate(() => {
        const m = document.querySelector('#modal-host .modal');
        if (!m) return null;
        const b = m.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top),
          bottom: Math.round(b.bottom), winH: window.innerHeight };
      });
      console.log('   对局记录弹窗: ' + JSON.stringify(sheet));
      await page.screenshot({ path: path.join(ROOT, 'dist', 'real-' + c.name + '-sheet.png') });
    }
    await page.close();
  }
  await browser.close();
})();
