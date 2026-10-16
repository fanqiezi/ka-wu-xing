/*
 * 真实游戏在多种真机尺寸下的自检（开发用，需要 puppeteer-core + 本机 Chrome）
 * 用法： NODE_PATH=<装了 puppeteer-core 的 node_modules> node tests/shots-sizes.js
 * 检查：横向/纵向溢出 · 面板重叠 · 手牌几行 · 四个方框挂在哪 · 顶栏被挤爆/互相压住 · 底栏是否在视口内
 * 每个尺寸跑两遍：正常状态 +「对手亮倒」最坏情况
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(__dirname, '..');
const url = q => 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + q;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SIZES = [
  { n: 'iPhone SE1 竖', w: 320, h: 568 },
  { n: 'iPhone SE2 竖', w: 375, h: 667 },
  { n: 'iPhone 12 竖', w: 390, h: 844 },
  { n: 'Pro Max 竖', w: 430, h: 932 },
  { n: 'SE1 横', w: 568, h: 320 },
  { n: 'SE2 横', w: 667, h: 375 },
  { n: 'iPhone 12 横', w: 844, h: 390 },
  { n: 'Pro Max 横', w: 932, h: 430 },
  { n: 'iPad 竖', w: 768, h: 1024 }
];

const MEASURE = () => {
  const q = x => document.querySelector(x);
  const box = n => {
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
  };
  const hand = q('#seat-0 .hand-row');
  let rows = 0;
  if (hand) {
    const t = new Set();
    hand.querySelectorAll('.tile').forEach(x => t.add(x.offsetTop));
    rows = t.size;
  }
  const top = q('#topbar');
  let topOverflow = false, topOverlap = false;
  if (top) {
    const tb = top.getBoundingClientRect();
    const kids = Array.from(top.children).filter(k => k.getBoundingClientRect().width > 0);
    const boxes = kids.map(k => k.getBoundingClientRect());
    topOverflow = Math.max.apply(null, boxes.map(b => b.right)) > tb.right + 1;
    for (let i = 1; i < boxes.length; i++) {
      if (boxes[i].left < boxes[i - 1].right - 1) topOverlap = true;
    }
  }
  const opp = box(q('.opponents')), self = box(q('#seat-0'));
  const bar = q('#actionbar');
  return {
    layout: window.KWX_UI.getLayout(),
    hudParent: q('.hud') ? (q('.hud').parentNode.id || '') : '',
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    overflowY: document.documentElement.scrollHeight > window.innerHeight + 1,
    topOverflow: topOverflow, topOverlap: topOverlap, rows: rows,
    gap: (opp && self) ? self[1] - (opp[1] + opp[3]) : null,
    handH: hand ? Math.round(hand.getBoundingClientRect().height) : 0,
    panelH: opp ? opp[3] : 0,
    barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : null
  };
};

const WORST = () => {
  const q = x => document.querySelector(x);
  const box = n => {
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
  };
  const opp = box(q('.opponents')), self = box(q('#seat-0'));
  return {
    gap: (opp && self) ? self[1] - (opp[1] + opp[3]) : null,
    overflowY: document.documentElement.scrollHeight > window.innerHeight + 1
  };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: false,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });
  let bad = 0;
  for (const s of SIZES) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await page.goto(url(''), { waitUntil: 'load' });
    await page.waitForFunction('window.KWX_UI !== undefined', { timeout: 5000 });
    await page.click('#start-btn');
    await page.evaluate(() => { const g = window.KWX_UI.getGame(); if (g) g.speed = 0; });
    for (let i = 0; i < 60; i++) {
      const p = await page.evaluate(() => { const a = window.KWX_UI.getPending(); return a ? a.kind : null; });
      if (p) break;
      await sleep(120);
    }
    const r = await page.evaluate(MEASURE);

    // 最坏情况：对手亮倒（面板多一行亮倒牌 + 一行公开听牌）
    await page.evaluate(() => {
      const g = window.KWX_UI.getGame();
      const p = g.players[1];
      p.liangdao = true;
      p.melds = [{ kind: 'pong', tile: 18 }];
      p.liangdaoReveal = null;
      g.emit('change', { evt: 'test' });
    });
    await sleep(60);
    const r2 = await page.evaluate(WORST);

    const ok = !r.overflowX && !r.overflowY && r.gap !== null && r.gap >= 0 &&
      !r.topOverflow && !r.topOverlap && r.barBottom !== null && r.barBottom <= s.h + 1 &&
      !r2.overflowY && r2.gap !== null && r2.gap >= 0;
    if (!ok) bad++;
    console.log((ok ? 'OK ' : 'NG ') + s.n.padEnd(14) + s.w + 'x' + s.h +
      '  布局=' + String(r.layout).padEnd(9) + ' 方框=' + (r.hudParent || '-').padEnd(11) +
      ' 手牌' + r.rows + '行(' + r.handH + ') 面板' + r.panelH + ' 间距' + r.gap + '/亮倒' + r2.gap +
      '  横向溢出=' + r.overflowX + ' 纵向溢出=' + r.overflowY +
      ' 顶栏挤爆=' + r.topOverflow + ' 顶栏重叠=' + r.topOverlap);
    await page.close();
  }
  await browser.close();
  console.log('\n' + (bad ? '有 ' + bad + ' 个尺寸不合格' : '全部尺寸合格'));
  process.exit(bad ? 1 : 0);
})();
