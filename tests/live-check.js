/*
 * 线上站点自检（开发用，需要 puppeteer-core + 本机 Chrome）
 * 用法： NODE_PATH=<装了 puppeteer-core 的 node_modules> node tests/live-check.js [url]
 * 默认检查 https://fanqiezi.github.io/ka-wu-xing/
 * ① 首页 200、手机版布局生效  ② Service Worker 激活、manifest/图标在线
 * ③ 预缓存里有游戏外壳        ④ **断网重开后竖屏/横屏都还能玩**
 */
'use strict';

const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE = process.argv[2] || 'https://fanqiezi.github.io/ka-wu-xing/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  OK  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  NG  ' + name + (extra ? '  ' + extra : '')); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: false, protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  console.log('站点：' + SITE);
  const resp = await page.goto(SITE, { waitUntil: 'load', timeout: 90000 });
  check('首页可访问', resp && resp.status() === 200, 'HTTP ' + (resp && resp.status()));

  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw-support';
    const timeout = new Promise(r => setTimeout(() => r('timeout'), 10000));
    const ready = navigator.serviceWorker.ready.then(reg => new Promise(res => {
      const tick = () => {
        if (reg.active && reg.active.state === 'activated') res('activated');
        else setTimeout(tick, 100);
      };
      tick();
    })).catch(e => 'error:' + (e && e.message));
    return Promise.race([ready, timeout]);
  });
  check('Service Worker 激活', sw === 'activated', '状态=' + sw);

  const info = await page.evaluate(async () => {
    const m = document.querySelector('link[rel=manifest]');
    const j = m ? await (await fetch(m.href)).json().catch(() => null) : null;
    const keys = await caches.keys();
    const c = keys.length ? await caches.open(keys[0]) : null;
    const all = c ? await c.keys() : [];
    return {
      layout: window.KWX_UI ? window.KWX_UI.getLayout() : '?',
      name: j && j.name, display: j && j.display, orientation: j && j.orientation,
      icons: (j && j.icons || []).length,
      cache: keys[0], cached: all.length,
      hasIndex: all.some(r => /index\.html$/.test(r.url)),
      hasJs: all.some(r => /game\.js$/.test(r.url)) && all.some(r => /ui\.js$/.test(r.url)),
      hasIcons: all.some(r => /icon-512\.png$/.test(r.url)),
      hasMobileCss: all.some(r => /mobile\.css$/.test(r.url))
    };
  });
  check('manifest 在线可解析', !!info.name && info.display === 'standalone',
    JSON.stringify({ name: info.name, display: info.display, orientation: info.orientation, icons: info.icons }));
  check('手机版布局生效（竖屏）', info.layout === 'portrait', 'layout=' + info.layout);
  check('预缓存里有游戏外壳', info.hasIndex && info.hasJs && info.hasIcons && info.hasMobileCss,
    info.cache + ' 共 ' + info.cached + ' 个文件');

  console.log('断网重开（竖屏）');
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  const off = await page.evaluate(() => ({
    ui: !!window.KWX_UI, layout: window.KWX_UI ? window.KWX_UI.getLayout() : '?'
  }));
  await page.click('#start-btn').catch(() => {});
  await page.evaluate(() => { const g = window.KWX_UI && window.KWX_UI.getGame(); if (g) g.speed = 0; });
  await sleep(900);
  const play = await page.evaluate(() => {
    const g = window.KWX_UI.getGame();
    return { playing: g && g.playing, tiles: document.querySelectorAll('#seat-0 .hand-row .tile').length };
  });
  check('断网仍能打开并开局（竖屏）', off.ui && off.layout === 'portrait' && play.playing && play.tiles >= 13,
    JSON.stringify(off) + ' ' + JSON.stringify(play));
  await page.screenshot({ path: 'dist/live-portrait.png' });
  await page.setOfflineMode(false);

  console.log('断网重开（横屏）');
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await sleep(400);
  const land = await page.evaluate(() => window.KWX_UI.getLayout());
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await sleep(300);
  const landOff = await page.evaluate(() => ({
    ui: !!window.KWX_UI, layout: window.KWX_UI ? window.KWX_UI.getLayout() : '?'
  }));
  check('断网仍能打开（横屏）', landOff.ui && land === 'landscape' && landOff.layout === 'landscape',
    '在线=' + land + ' 离线=' + JSON.stringify(landOff));
  await page.screenshot({ path: 'dist/live-landscape.png' });
  await page.setOfflineMode(false);

  await browser.close();
  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
