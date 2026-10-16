/*
 * 用 puppeteer 精确视口截图 + 量尺寸（开发用，不进仓库依赖）
 * 用法： NODE_PATH=<装了 puppeteer-core 的 node_modules> node tests/shots.js
 * 输出： preview/shots/*.png  +  控制台打印关键区块的真实尺寸
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(__dirname, '..');
const url = f => 'file:///' + path.join(ROOT, 'preview', f).replace(/\\/g, '/');

const SHOTS = [
  { name: 'portrait', file: 'portrait.html', w: 390, h: 844, q: '' },
  { name: 'landscape', file: 'landscape.html', w: 844, h: 390, q: '' },
  { name: 'self-liangdao', file: 'portrait.html', w: 390, h: 844, q: '?state=selfLd' },
  { name: 'danger', file: 'landscape.html', w: 844, h: 390, q: '?state=danger' }
];

const SEL = ['#app', '.topbar', '.table', '.opponents', '.seat-opp', '.center-col', '.center-info',
  '.seat-self', '#mHand', '.actionbar', '.sidebar', '.seat-opp .row.discards .discards-list',
  '.seat-self .row.discards .discards-list'];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    pipe: false,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files']
  });
  for (const s of SHOTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 2 });
    await page.goto(url(s.file) + s.q, { waitUntil: 'load' });
    await page.waitForFunction('window.PREVIEW !== undefined', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 120));
    const out = path.join(ROOT, 'preview', 'shots', s.name + '.png');
    await page.screenshot({ path: out });
    const info = await page.evaluate((sels) => {
      const r = { win: [window.innerWidth, window.innerHeight], bodyW: document.body.scrollWidth };
      sels.forEach(sel => {
        const n = document.querySelector(sel);
        if (!n) { r[sel] = null; return; }
        const b = n.getBoundingClientRect();
        r[sel] = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
      });
      // 有没有内容溢出可视宽度
      r.overflowX = document.documentElement.scrollWidth > window.innerWidth;
      return r;
    }, SEL);
    console.log('\n== ' + s.name + ' (' + s.w + 'x' + s.h + ') 视口=' + info.win.join('x') +
      ' body宽=' + info.bodyW + ' 横向溢出=' + info.overflowX);
    SEL.forEach(sel => {
      const v = info[sel];
      console.log('   ' + sel.padEnd(42) + (v ? (v[2] + 'x' + v[3] + ' @' + v[0] + ',' + v[1]) : '（无）'));
    });
    // 自己那块有没有向上盖住对手栏（差值为负就是重叠）
    const opp = info['.opponents'], self = info['.seat-self'];
    if (opp && self) {
      const gap = self[1] - (opp[1] + opp[3]);
      console.log('   >>> 对手栏底 ' + (opp[1] + opp[3]) + ' / 自己顶 ' + self[1] +
        ' → 间距 ' + gap + (gap < 0 ? '  ❌ 重叠了！' : '  ✓'));
    }
    const allOverflow = info.overflowX;
    if (allOverflow) console.log('   >>> ❌ 有横向溢出（右边会被切）');
    await page.close();
  }
  await browser.close();
})();
