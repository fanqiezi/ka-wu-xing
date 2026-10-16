/*
 * PWA 自检（开发用，需要 puppeteer-core + 本机 Chrome）
 * 起一个本地 http 服务，用真实浏览器验证：
 *   ① manifest 能解析、图标都在  ② Service Worker 注册并激活
 *   ③ 预缓存里确实有游戏外壳      ④ **断网后仍能打开并开局**（真离线）
 *   ⑤ file:// 打开时不应注册 SW（不干扰双击使用的老习惯）
 * 用法： NODE_PATH=<装了 puppeteer-core 的 node_modules> node tests/pwa-check.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(__dirname, '..');
const PORT = 8731;
const TYPE = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.md': 'text/plain; charset=utf-8'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': TYPE[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  OK  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  NG  ' + name + (extra ? '  ' + extra : '')); }
}

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: false,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const origin = 'http://127.0.0.1:' + PORT;

  console.log('① 首次打开（在线）');
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction('window.KWX_UI !== undefined', { timeout: 5000 });
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw-support';
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) return 'not-ready';
    // ready 只代表「有活动的 worker」，再等它真正 activated
    for (let i = 0; i < 60; i++) {
      if (reg.active && reg.active.state === 'activated') break;
      await new Promise(r => setTimeout(r, 50));
    }
    return reg.active ? reg.active.state : 'no-active';
  });
  await sleep(300);
  check('Service Worker 已激活', swState === 'activated', '状态=' + swState);

  const man = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]') && document.querySelector('link[rel=manifest]').href;
    if (!href) return { err: 'no-manifest-link' };
    const r = await fetch(href);
    const j = await r.json();
    return { name: j.name, display: j.display, orientation: j.orientation, icons: (j.icons || []).map(i => i.sizes + ':' + i.purpose) };
  });
  check('manifest 可解析', !!man.name && man.display === 'standalone',
    JSON.stringify(man));
  const iconOk = await page.evaluate(async (icons) => {
    const out = [];
    for (const src of icons) {
      const r = await fetch(src);
      out.push(src + '=' + r.status);
    }
    return out;
  }, ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']);
  check('四个图标都能取到', iconOk.every(s => s.endsWith('=200')), iconOk.join(' '));

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return { caches: [], count: 0, hasIndex: false };
    const c = await caches.open(keys[0]);
    const all = await c.keys();
    return {
      caches: keys, count: all.length,
      hasIndex: all.some(r => /index\.html$/.test(r.url)),
      hasMobile: all.some(r => /mobile\.css$/.test(r.url)),
      hasUi: all.some(r => /ui\.js$/.test(r.url))
    };
  });
  check('预缓存里有游戏外壳', cached.hasIndex && cached.hasMobile && cached.hasUi,
    '缓存 ' + cached.count + ' 个文件 ' + JSON.stringify(cached.caches));

  console.log('② 断网后重新打开（真离线）');
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'load' });
  const offlineOk = await page.evaluate(() => !!window.KWX_UI && !!window.KWX && !!window.KWX.Tiles);
  check('离线仍能加载脚本', offlineOk);
  await page.click('#start-btn');
  await page.evaluate(() => { const g = window.KWX_UI.getGame(); if (g) g.speed = 0; });
  await sleep(900);
  const offlinePlay = await page.evaluate(() => {
    const g = window.KWX_UI.getGame();
    const tiles = document.querySelectorAll('#seat-0 .hand-row .tile').length;
    return { playing: g && g.playing, roundNo: g && g.roundNo, tiles: tiles, layout: window.KWX_UI.getLayout() };
  });
  check('离线还能开局发牌', offlinePlay.playing && offlinePlay.tiles >= 13,
    JSON.stringify(offlinePlay));
  await page.screenshot({ path: path.join(ROOT, 'dist', 'pwa-offline.png') });
  await page.setOfflineMode(false);

  console.log('③ file:// 打开（老习惯：双击 index.html）');
  const p2 = await browser.newPage();
  const errs = [];
  p2.on('pageerror', e => errs.push(String(e)));
  await p2.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await p2.waitForFunction('window.KWX_UI !== undefined', { timeout: 5000 });
  const fileInfo = await p2.evaluate(() => ({
    ui: !!window.KWX_UI,
    sw: 'serviceWorker' in navigator ? !!navigator.serviceWorker.controller : false,
    layout: window.KWX_UI.getLayout()
  }));
  check('file:// 下游戏正常、且没有 SW 接管', fileInfo.ui && !fileInfo.sw && errs.length === 0,
    JSON.stringify(fileInfo) + (errs.length ? ' 错误=' + errs.join('|') : ''));

  await browser.close();
  srv.close();
  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
