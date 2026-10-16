/*
 * 定点截图 + 实测坐标（开发用，需要 puppeteer-core + 本机 Chrome）
 * 覆盖：竖屏询问栏固定占位、按钮平铺/竖排、对手面板换行与单滚动条、
 *       横屏玩家区副露/牌河并排、竖屏↔横屏来回切后操作历史不被压没
 * 用法： NODE_PATH=<装了 puppeteer-core 的 node_modules> node tests/shots-review.js
 * 输出 dist/rv2-*.png
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(__dirname, '..');
const url = q => 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + q;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = n => path.join(ROOT, 'dist', 'rv2-' + n + '.png');

/* 把「对手满状态」塞进去：亮倒 + 听牌 + 副露 + 长牌河 */
const FILL_OPP = () => {
  const g = window.KWX_UI.getGame();
  g.stop(); g.playing = true;
  const p = g.players[1];
  p.liangdao = true;
  // 碰 中中中 + 杠 9条9条9条9条（7 张副露）→ 手牌 7 张（听 4筒）
  p.melds = [{ kind: 'pong', tile: 18 }, { kind: 'kong', tile: 9 }];
  p.hand = [0, 0, 0, 1, 2, 3, 4];
  p.discards = [];
  for (let i = 0; i < 24; i++) p.discards.push(i % 9);
  p.liangdaoReveal = null;
  const q = g.players[2];
  q.liangdao = false;
  q.melds = [];
  q.hand = [1, 2, 3, 10, 11, 12, 19, 19, 20, 20, 4, 5, 6];
  q.discards = [5, 6, 7, 8, 0, 1];
  // 自己：一副露 + 长牌河（横屏要能左右滑）
  const m = g.players[0];
  m.melds = [{ kind: 'pong', tile: 20 }];
  m.discards = [];
  for (let i = 0; i < 26; i++) m.discards.push((i * 2) % 9);
  g.emit('change', { evt: 'test' });
};

/* 冻结牌局：不动了才好前后对比（否则两次测量之间牌河还在长） */
const FREEZE = () => {
  const g = window.KWX_UI.getGame();
  g.stop(); g.playing = true;
  g.emit('change', { evt: 'freeze' });
};

const MEASURE_PORTRAIT = () => {
  const R = n => { if (!n) return null; const b = n.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)]; };
  const bar = document.getElementById('actionbar');
  const side = document.getElementById('sidebar');
  const seat1 = document.getElementById('seat-1');
  const scrolls = seat1 ? seat1.querySelectorAll('.seat-scroll') : [];
  const rowInfo = (sel) => {
    const row = seat1 ? seat1.querySelector(sel) : null;
    if (!row) return null;
    const lab = row.querySelector('.row-label');
    const tiles = row.querySelectorAll('.tile');
    const rb = row.getBoundingClientRect();
    // 一排几张：按第一排的 top 统计（容差 3px）
    const firstTop = tiles.length ? tiles[0].getBoundingClientRect().top : 0;
    let perRow = 0;
    for (const t of tiles) if (Math.abs(t.getBoundingClientRect().top - firstTop) < 3) perRow++;
    return {
      labelOwnLine: lab ? (lab.getBoundingClientRect().width >= rb.width - 6) : null,
      tiles: tiles.length, perRow: perRow,
      overflowRight: tiles.length ? Math.round(tiles[tiles.length - 1].getBoundingClientRect().right - rb.right) : 0,
      scrollable: row.scrollHeight > row.clientHeight + 1
    };
  };
  return {
    who: document.querySelector('#seat-0 .seat-head .who').textContent,
    body: document.body.className,
    bar: R(bar), barEmpty: bar.children.length === 0,
    barKids: bar.children.length,
    side: R(side), self: R(document.querySelector('#seat-0')),
    opp: R(seat1),
    blocks: (() => {
      const list = [['topbar', document.querySelector('.topbar')], ['opponents', document.querySelector('.opponents')],
        ['seat1', document.getElementById('seat-1')], ['seat2', document.getElementById('seat-2')],
        ['centerCol', document.getElementById('center-col')], ['hud', document.getElementById('hud')],
        ['sidebar', side], ['actionbar', bar], ['self', document.querySelector('#seat-0')]];
      const out = {};
      list.forEach(([k, n]) => {
        const b = n ? n.getBoundingClientRect() : null;
        out[k] = b ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null;
      });
      // 竖屏只有 对手栏 / 询问栏 / 自己 三行，操作历史在中间那一竖条里
      const seq = ['opponents', 'actionbar', 'self'];
      const bad = [];
      for (let i = 1; i < seq.length; i++) {
        const a = out[seq[i - 1]], b = out[seq[i]];
        if (a && b && b[1] < a[3] - 1) bad.push(seq[i - 1] + '↔' + seq[i]);
      }
      if (out.sidebar && out.actionbar && out.sidebar[3] > out.actionbar[1] + 1) bad.push('sidebar↔actionbar');
      out.overlap = bad;
      out.sidebarParent = side.parentNode ? (side.parentNode.id || side.parentNode.className) : null;
      out.sidebarWidthPct = Math.round((out.sidebar ? out.sidebar[2] - out.sidebar[0] : 0) / window.innerWidth * 100);
      return out;
    })(),
    scrollCount: scrolls.length,
    scrollable: scrolls.length ? scrolls[0].scrollHeight > scrolls[0].clientHeight + 1 : null,
    innerScrolls: seat1 ? Array.prototype.filter.call(seat1.querySelectorAll('.row, .discards-list'),
      n => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1).map(n => n.className) : [],
    discards: rowInfo('.row.discards'), melds: rowInfo('.row.melds'), waits: rowInfo('.row.waits'),
    docOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1,
    docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1
  };
};

const MEASURE_LANDSCAPE = () => {
  const R = n => { if (!n) return null; const b = n.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const bar = document.getElementById('actionbar');
  const acts = Array.prototype.map.call(bar.querySelectorAll('.act'), n => R(n));
  const self = document.getElementById('seat-0');
  const sc = self.querySelector('.seat-scroll');
  const melds = self.querySelector('.row.melds');
  const disc = self.querySelector('.row.discards');
  return {
    barParent: bar.parentNode.id || bar.parentNode.className,
    bar: R(bar), acts: acts,
    // 竖排：x 相同、y 递增
    vertical: acts.length >= 2 ? (acts[0][0] === acts[1][0] && acts[1][1] > acts[0][1]) : null,
    hand: R(self.querySelector('.hand-row')),
    melds: R(melds), discards: R(disc),
    // 并排：副露在左、牌河在右
    sideBySide: (melds && disc) ? (melds.getBoundingClientRect().right <= disc.getBoundingClientRect().left + 2) : null,
    scrollBox: R(sc), scrollX: sc ? [Math.round(sc.scrollWidth), Math.round(sc.clientWidth)] : null,
    docOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1
  };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: false, protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });

  async function open(q, w, h) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await page.goto(url(q), { waitUntil: 'load' });
    await page.waitForFunction('window.KWX_UI !== undefined');
    await page.click('#start-btn');
    await page.evaluate(() => { const g = window.KWX_UI.getGame(); if (g) g.speed = 0; });
    await sleep(250);
    return page;
  }

  async function waitAsk(page, kinds) {
    for (let i = 0; i < 90; i++) {
      const k = await page.evaluate(() => { const a = window.KWX_UI.getPending(); return a ? a.kind : null; });
      if (k && (!kinds || kinds.indexOf(k) >= 0)) return k;
      await sleep(120);
    }
    return null;
  }

  // ① 竖屏：出牌询问（询问栏空着但要占 54px）
  let page = await open('?layout=portrait', 390, 844);
  await waitAsk(page, ['discard']);
  await sleep(200);
  await page.screenshot({ path: OUT('portrait-ask') });
  let m = await page.evaluate(MEASURE_PORTRAIT);
  console.log('① 竖屏出牌询问：玩家框标题="' + m.who + '"');
  console.log('   询问栏 top/h=' + m.bar + ' 空的=' + m.barEmpty + '（应仍是 54 高）；操作历史 top/h=' + m.side + ' 挂在 ' +
    m.blocks.sidebarParent + '，宽度占屏 ' + m.blocks.sidebarWidthPct + '%；自己=' + m.self);
  console.log('   纵向溢出=' + m.docOverflowY + ' 横向溢出=' + m.docOverflowX);
  await page.close();

  // ①b 竖屏：亮倒询问（两个按钮）——一行平铺、等分，询问栏高度不变
  page = await open('?layout=portrait', 390, 844);
  await page.evaluate(() => {
    const g = window.KWX_UI.getGame();
    g.stop();   // 不要把 playing 打开，否则牌局那一拍会接着跑，把询问换成出牌询问
    g.ask({ kind: 'self', seat: 0, actions: [{ type: 'liangdao' }, { type: 'pass' }] });
  });
  await sleep(350);
  await page.screenshot({ path: OUT('portrait-buttons') });
  const pb = await page.evaluate(() => {
    const b = document.getElementById('actionbar');
    const r = b.getBoundingClientRect();
    const acts = Array.prototype.map.call(b.querySelectorAll('.act'), n => {
      const q = n.getBoundingClientRect();
      return [Math.round(q.left), Math.round(q.width), Math.round(q.height)];
    });
    return { bar: [Math.round(r.top), Math.round(r.height)], acts: acts };
  });
  console.log('①b 竖屏两个按钮：询问栏 top/h=' + pb.bar + ' 按钮[左,宽,高]=' + JSON.stringify(pb.acts) +
    ' 等宽=' + (pb.acts.length === 2 ? pb.acts[0][1] === pb.acts[1][1] : '-'));
  await page.close();

  // ①c 横屏：四个按钮（胡/杠/碰/过）——竖向一列，且不把牌桌挤爆
  page = await open('?layout=landscape', 844, 390);
  await page.evaluate(() => {
    const g = window.KWX_UI.getGame();
    g.stop();
    g.ask({ kind: 'claim', seat: 0, tile: 5, canHu: true, canZhiGang: true, canPong: true });
  });
  await sleep(350);
  await page.screenshot({ path: OUT('landscape-buttons') });
  const lb = await page.evaluate(() => {
    const b = document.getElementById('actionbar');
    const r = b.getBoundingClientRect();
    const acts = Array.prototype.map.call(b.querySelectorAll('.act'), n => {
      const q = n.getBoundingClientRect();
      return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)];
    });
    return {
      bar: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      acts: acts, docOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1
    };
  });
  console.log('①c 横屏四个按钮：询问栏[l,t,w,h]=' + lb.bar + ' 按钮=' + JSON.stringify(lb.acts) +
    ' 纵向溢出=' + lb.docOverflowY);
  await page.close();

  // ② 竖屏：对手满状态（亮倒 + 听牌 + 副露 + 长牌河）
  page = await open('?layout=portrait', 390, 844);
  await page.evaluate(FILL_OPP);
  await sleep(200);
  await page.screenshot({ path: OUT('portrait-opps') });
  m = await page.evaluate(MEASURE_PORTRAIT);
  console.log('② 竖屏对手满状态：面板 top/h=' + m.opp + ' 滚动区数=' + m.scrollCount + ' 可滚=' + m.scrollable);
  console.log('   操作历史 top/h=' + m.side + ' 挂 ' + m.blocks.sidebarParent + ' 宽 ' +
    (m.blocks.sidebar[2] - m.blocks.sidebar[0]) + 'px（中间那一竖条）');
  console.log('   面板内还有别的滚动条：' + (m.innerScrolls.length ? m.innerScrolls.join(' , ') : '没有'));
  ['discards', 'melds', 'waits'].forEach(k => {
    const r = m[k];
    console.log('   ' + k + '：牌 ' + (r ? r.tiles : '-') + ' 张 一排 ' + (r ? r.perRow : '-') + ' 张，标签独占一行=' +
      (r ? r.labelOwnLine : '-') + '，越出右边 ' + (r ? r.overflowRight : '-') + 'px，自身可滚=' + (r ? r.scrollable : '-'));
  });
  console.log('   各块=' + JSON.stringify(m.blocks));
  console.log('   纵向溢出=' + m.docOverflowY + ' 横向溢出=' + m.docOverflowX);
  await page.close();

  // ③ 横屏：真实询问时按钮竖排 + 玩家区副露/牌河并排
  page = await open('?layout=landscape', 844, 390);
  await waitAsk(page, ['claim', 'self', 'discard']);
  await sleep(300);
  await page.screenshot({ path: OUT('landscape-ask') });
  let l = await page.evaluate(MEASURE_LANDSCAPE);
  console.log('③ 横屏（有按钮时）：询问栏=' + l.bar + ' 挂 ' + l.barParent + '，按钮=' + JSON.stringify(l.acts) + '，竖排=' + l.vertical);
  await page.evaluate(FILL_OPP);
  await sleep(200);
  await page.screenshot({ path: OUT('landscape') });
  l = await page.evaluate(MEASURE_LANDSCAPE);
  console.log('   手牌=' + l.hand + '；副露=' + l.melds + '；牌河=' + l.discards + '，并排=' + l.sideBySide +
    '，滚动区=' + l.scrollBox + ' 内容/可视=' + l.scrollX + ' 纵向溢出=' + l.docOverflowY);
  await page.close();

  // ④ 竖屏 → 横屏 → 再切回竖屏：操作历史不能被压没
  page = await open('?layout=portrait', 390, 844);
  await page.evaluate(FREEZE);
  await sleep(600);                       // 等排在队列里的那一拍跑完，免得两次测量之间牌局还在动
  const before = await page.evaluate(MEASURE_PORTRAIT);
  await page.evaluate(() => window.KWX_UI.setLayout('landscape'));
  await sleep(250);
  await page.evaluate(() => window.KWX_UI.setLayout('portrait'));
  await page.evaluate(FREEZE);
  await sleep(600);
  await page.screenshot({ path: OUT('back-portrait') });
  const after = await page.evaluate(MEASURE_PORTRAIT);
  console.log('④ 来回切：操作历史 前 top/h=' + before.side + ' 后=' + after.side +
    '；询问栏 前=' + before.bar + ' 后=' + after.bar +
    '；自己 前=' + before.self + ' 后=' + after.self + '；重叠=' + JSON.stringify(after.blocks.overlap));
  console.log('   纵向溢出=' + after.docOverflowY);
  await page.close();

  // ⑤ 小屏竖屏（320×568）也要放得下、四块不重叠
  page = await open('?layout=portrait', 320, 568);
  await page.evaluate(FILL_OPP);
  await sleep(200);
  await page.screenshot({ path: OUT('small-portrait') });
  m = await page.evaluate(MEASURE_PORTRAIT);
  console.log('⑤ 320×568 满状态：操作历史 top/h=' + m.side + ' 对手面板=' + m.opp + ' 自己=' + m.self +
    ' 重叠=' + JSON.stringify(m.blocks.overlap));
  console.log('   各块=' + JSON.stringify(m.blocks));
  const kids = await page.evaluate(() => Array.prototype.map.call(
    document.querySelector('#seat-0').children,
    n => (n.className || n.tagName) + '=' + Math.round(n.getBoundingClientRect().height)));
  console.log('   自己那块里面：' + kids.join(' | '));
  console.log('   纵向溢出=' + m.docOverflowY + ' 横向溢出=' + m.docOverflowX);
  await page.close();

  await browser.close();
})();
