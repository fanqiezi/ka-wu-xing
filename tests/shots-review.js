/*
 * 针对一次改动做定点截图（开发用，需要 puppeteer-core + 本机 Chrome）
 * 用法： NODE_PATH=<装了 puppeteer-core 的 node_modules> node tests/shots-review.js
 * 输出 dist/rv-*.png
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
    executablePath: CHROME, headless: true, pipe: false, protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });

  // ① 竖屏：轮到自己出牌（询问栏那一排）
  let page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(url('?layout=portrait'), { waitUntil: 'load' });
  await page.waitForFunction('window.KWX_UI !== undefined');
  await page.click('#start-btn');
  await page.evaluate(() => { const g = window.KWX_UI.getGame(); if (g) g.speed = 0; });
  for (let i = 0; i < 80; i++) {
    const k = await page.evaluate(() => { const a = window.KWX_UI.getPending(); return a ? a.kind : null; });
    if (k) break;
    await sleep(120);
  }
  await page.screenshot({ path: path.join(ROOT, 'dist', 'rv-portrait-ask.png') });
  const pt = await page.evaluate(() => {
    const r = n => { if (!n) return null; const b = n.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)]; };
    return {
      bar: r(document.querySelector('#actionbar')),
      self: r(document.querySelector('#seat-0')),
      log: r(document.querySelector('.sidebar')),
      logParent: document.querySelector('.sidebar').parentNode.id || document.querySelector('.sidebar').parentNode.className,
      barParent: document.querySelector('#actionbar').parentNode.id || document.querySelector('#actionbar').parentNode.className
    };
  });
  console.log('竖屏：询问栏 top/h=' + pt.bar + ' 自己 top/h=' + pt.self + ' 操作历史 top/h=' + pt.log);
  console.log('      操作历史挂在 ' + pt.logParent + '，询问栏挂在 ' + pt.barParent);
  await page.close();

  // ② 横屏：询问按钮应在手牌右侧
  page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(url('?layout=landscape'), { waitUntil: 'load' });
  await page.waitForFunction('window.KWX_UI !== undefined');
  await page.click('#start-btn');
  await page.evaluate(() => { const g = window.KWX_UI.getGame(); if (g) g.speed = 0; });
  for (let i = 0; i < 80; i++) {
    const k = await page.evaluate(() => { const a = window.KWX_UI.getPending(); return a ? a.kind : null; });
    if (k) break;
    await sleep(120);
  }
  await page.screenshot({ path: path.join(ROOT, 'dist', 'rv-landscape-ask.png') });
  const lt = await page.evaluate(() => {
    const r = n => { if (!n) return null; const b = n.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width)]; };
    return {
      hand: r(document.querySelector('#seat-0 .hand-row')),
      bar: r(document.querySelector('#actionbar')),
      sidebar: r(document.querySelector('.sidebar'))
    };
  });
  console.log('横屏：手牌 left/top/w=' + lt.hand + ' 询问栏=' + lt.bar + ' 侧栏=' + lt.sidebar);
  await page.close();

  // ③ 竖屏：攒几局记录后打开「对局记录」看折线图与宽表
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(url('?layout=portrait'), { waitUntil: 'load' });
  await page.waitForFunction('window.KWX_UI !== undefined');
  await page.click('#start-btn');
  await page.evaluate(async () => {
    const g = window.KWX_UI.getGame();
    g.speed = 0;
    g.stop();
    g.players.forEach(p => { p.isAI = true; });
    for (let i = 0; i < 4; i++) await g.startRound();
  });
  await sleep(300);
  const histLen = await page.evaluate(() => {
    const g = window.KWX_UI.getGame();
    return { rounds: g.roundNo, history: g.history.length };
  });
  // 结算窗是延迟弹的：先等它们全部弹完，再直接把弹窗 DOM 清空
  //（点「下一局」会再开一局、又弹一个结算窗，所以不能点按钮）
  await page.evaluate(() => { const g = window.KWX_UI.getGame(); g.stop(); });
  await sleep(900);
  await page.evaluate(() => {
    const h = document.getElementById('modal-host');
    if (h) { h.hidden = true; h.innerHTML = ''; }
  });
  await sleep(120);
  await page.click('#btn-history');
  await sleep(500);
  await page.screenshot({ path: path.join(ROOT, 'dist', 'rv-history-portrait.png') });
  const ht = await page.evaluate(() => {
    const m = document.querySelector('#modal-host .modal');
    const c = document.querySelector('#history-chart');
    const w = document.querySelector('.chart-wrap');
    const b = n => { if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    return {
      modal: b(m), chart: b(c), wrap: b(w),
      chartCss: c ? [c.clientWidth, c.clientHeight] : null,
      modalText: m ? m.textContent.slice(0, 40) : '(没有弹窗)',
      overflowY: document.documentElement.scrollHeight > window.innerHeight + 1
    };
  });
  console.log('竖屏记录：局数=' + histLen.rounds + ' 记录条数=' + histLen.history);
  console.log('竖屏记录弹窗: 弹窗=' + ht.modal + ' 图框=' + ht.wrap + ' canvas=' + ht.chart + ' canvas 内部=' + ht.chartCss);
  console.log('      弹窗开头文字: ' + ht.modalText);
  // 滚到底：看按钮条有没有盖住内容、学习表列是否齐全
  const bt = await page.evaluate(() => {
    const m = document.querySelector('#modal-host .modal');
    m.scrollTop = m.scrollHeight;
    const bar = m.querySelector('.modal-actions');
    const tables = Array.from(m.querySelectorAll('table'));
    const last = tables.length ? tables[tables.length - 1] : null;
    const head = last ? Array.from(last.querySelectorAll('th')).map(t => t.textContent).join('|') : '(无表)';
    const firstRow = last ? Array.from(last.querySelectorAll('tbody tr')).slice(0, 1)
      .map(tr => Array.from(tr.children).map(td => td.textContent).join('|'))[0] : '';
    const rb = bar.getBoundingClientRect(), lb = last ? last.getBoundingClientRect() : null;
    return {
      scrollTop: Math.round(m.scrollTop), scrollH: m.scrollHeight, clientH: m.clientHeight,
      bar: [Math.round(rb.top), Math.round(rb.bottom)], tableBottom: lb ? Math.round(lb.bottom) : null,
      head: head, firstRow: firstRow || '(表里还没数据)'
    };
  });
  await sleep(200);
  await page.screenshot({ path: path.join(ROOT, 'dist', 'rv-history-bottom.png') });
  console.log('      滚动到底: ' + bt.scrollTop + '/' + (bt.scrollH - bt.clientH) + '，按钮条=' + bt.bar + '，最末表底=' + bt.tableBottom);
  console.log('      学习/明细表头: ' + bt.head);
  console.log('      首行数据: ' + bt.firstRow);
  await page.close();

  // ④ 竖屏：对手亮倒（手牌张数要减掉亮出的牌、听牌行不暴露番数）
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(url('?layout=portrait'), { waitUntil: 'load' });
  await page.waitForFunction('window.KWX_UI !== undefined');
  await page.click('#start-btn');
  await page.evaluate(() => {
    const g = window.KWX_UI.getGame();
    g.stop(); g.playing = true;
    const p = g.players[1];
    p.liangdao = true;
    p.melds = [];
    // 11134567999筒 + 中中 → 听 2/5/8 筒，亮倒只该亮 34567筒（5 张）
    p.hand = [0, 0, 0, 2, 3, 4, 5, 6, 8, 8, 8, 17, 17];
    p.discards = [3, 12, 20, 7, 15, 2];
    p.liangdaoReveal = null;
    g.emit('change', { evt: 'test' });
  });
  await sleep(200);
  await page.screenshot({ path: path.join(ROOT, 'dist', 'rv-portrait-reveal.png') });
  const rt = await page.evaluate(() => {
    const seat = document.querySelector('#seat-1');   // players[1] 是下家
    const rows = seat.querySelectorAll('.hand-row .tile.back').length;
    const rev = seat.querySelectorAll('.row.reveal-row .tile').length;
    const waits = seat.querySelector('.row.waits');
    const hand = window.KWX_UI.getGame().players[1].hand.length;
    return { hand: hand, backs: rows, reveal: rev, waitText: waits ? waits.textContent.replace(/\s+/g, '') : '(无)' };
  });
  console.log('亮倒对手：手里 ' + rt.hand + ' 张 → 牌背 ' + rt.backs + ' 张、亮出 ' + rt.reveal +
    ' 张（' + rt.hand + '-' + rt.reveal + '=' + (rt.hand - rt.reveal) + '）、听牌行「' + rt.waitText + '」');
  await page.close();

  // ⑤ 竖屏：亮倒奖惩记忆——按「情况」分桶复盘的表格
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(url('?layout=portrait'), { waitUntil: 'load' });
  await page.waitForFunction('window.KWX_UI !== undefined');
  await page.click('#start-btn');
  const injected = await page.evaluate(async () => {
    const g = window.KWX_UI.getGame();
    g.speed = 0;
    g.stop();
    // 记录表要先有一局才打得开
    g.players.forEach(p => { p.isAI = true; });
    await g.startRound();
    g.stop();
    const AI = window.KWX.AI;
    const t = g.liangdaoLearn[1];
    // 三种情况各记几次：赢的倾向 >1、输的 <1
    const cases = [
      [{ fan: 1, width: 5, wall: 40, remainWin: 6, threat: 0 }, true, true, '平胡', 3],
      [{ fan: 1, width: 5, wall: 40, remainWin: 6, threat: 0 }, false, false, '平胡', 2],
      [{ fan: 6, width: 2, wall: 10, remainWin: 2, threat: 2 }, true, true, '清一色', 2],
      [{ fan: 6, width: 2, wall: 10, remainWin: 2, threat: 2 }, false, false, '清一色', 1]
    ];
    const keys = [];
    cases.forEach(c => {
      const key = AI.situationKey(c[0]);
      keys.push(key);
      for (let i = 0; i < c[4]; i++) AI.noteLiangdaoResult(t, key, c[2], c[3]);
    });
    // 也给自己塞一条，验证「只列电脑」的行为
    AI.noteLiangdaoResult(g.liangdaoLearn[0], AI.situationKey({ fan: 2, width: 4, wall: 30, remainWin: 5, threat: 0 }), true, '混一色');
    return keys;
  });
  // 结算窗可能盖上来，先清掉再开记录
  await sleep(600);
  await page.evaluate(() => {
    const h = document.getElementById('modal-host');
    if (h) { h.hidden = true; h.innerHTML = ''; }
  });
  await page.click('#btn-history');
  await sleep(400);
  const lt2 = await page.evaluate(() => {
    const m = document.querySelector('#modal-host .modal');
    m.scrollTop = m.scrollHeight;
    const tables = Array.from(m.querySelectorAll('table'));
    const t = tables[tables.length - 1];
    return {
      rows: Array.from(t.querySelectorAll('tr')).map(tr =>
        Array.from(tr.children).map(td => td.textContent.trim()).join(' | '))
    };
  });
  await sleep(150);
  await page.screenshot({ path: path.join(ROOT, 'dist', 'rv-history-learn.png') });
  console.log('亮倒记忆：注入情况 ' + injected.join(' / '));
  lt2.rows.forEach(r => console.log('      ' + r));
  await page.close();

  await browser.close();
})();
