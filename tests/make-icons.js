/*
 * 生成 PWA 图标（开发用，需要 puppeteer-core + 本机 Chrome）
 * 用法： NODE_PATH=<装了 puppeteer-core 的 node_modules> node tests/make-icons.js
 * 生成： icons/icon-192.png · icons/icon-512.png · icons/icon-maskable-512.png · icons/apple-touch-icon.png
 * 设计沿用游戏里的品牌块：毛毡绿底 + 红底白「中」+ 细金边
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(__dirname, '..');

function html(logoPct, radiusPct) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}' +
    'body{background:radial-gradient(circle at 50% 32%,#155a43,#0d3b2e 58%,#0a2c22 100%)}' +
    '.wrap{width:100%;height:100%;display:grid;place-items:center}' +
    '.logo{width:' + logoPct + '%;height:' + logoPct + '%;border-radius:' + radiusPct + '%;' +
    'display:grid;place-items:center;' +
    'background:linear-gradient(160deg,#b4342c 0%,#7d1f19 100%);' +
    'color:#fff;font-family:KaiTi,STKaiti,"Noto Serif SC",serif;font-weight:800;' +
    'font-size:' + Math.round(logoPct * 0.78) + 'vmin;line-height:1;' +
    'box-shadow:inset 0 0 0 .9vmin rgba(255,255,255,.22), 0 2.5vmin 6vmin rgba(0,0,0,.5);' +
    'border:.7vmin solid rgba(232,197,106,.5)}' +
    '.logo span{transform:translateY(-2%)}' +
    '</style></head><body><div class="wrap"><div class="logo"><span>中</span></div></div></body></html>';
}

const OUT = [
  { file: 'icon-192.png', size: 192, logo: 64, radius: 24 },
  { file: 'icon-512.png', size: 512, logo: 64, radius: 24 },
  { file: 'icon-maskable-512.png', size: 512, logo: 48, radius: 26 },   // 内容留在安全区内
  { file: 'apple-touch-icon.png', size: 180, logo: 64, radius: 24 }
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: false,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });
  for (const o of OUT) {
    const page = await browser.newPage();
    await page.setViewport({ width: o.size, height: o.size, deviceScaleFactor: 1 });
    await page.setContent(html(o.logo, o.radius), { waitUntil: 'load' });
    const out = path.join(ROOT, 'icons', o.file);
    await page.screenshot({ path: out, omitBackground: false });
    console.log('生成 ' + o.file + '  ' + o.size + 'x' + o.size);
    await page.close();
  }
  await browser.close();
})();
