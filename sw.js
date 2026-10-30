/* ============================================================
   离线缓存（PWA）：把整个游戏外壳预缓存下来，断网也能玩。
   发版时把 VERSION 改掉（同时会换缓存名，旧缓存自动清掉）。
   只在 http(s) 下注册（见 js/main.js），file:// 双击打开完全不受影响。
   ============================================================ */
'use strict';

var VERSION = 'v1.4.0';
var CACHE = 'ka-wu-xing-' + VERSION;

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './css/mobile.css',
  './js/tiles.js',
  './js/rules.js',
  './js/ai.js',
  './js/memory.js',
  './js/game.js',
  './js/stats.js',
  './js/ui.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // cache: 'reload' 保证不会拿到 http 缓存里的旧文件
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* 缺一两个不影响 */ });
      }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // 只处理自己的资源

  // 页面导航：永远给缓存里的 index.html（离线可开；?layout= 之类的参数由页面自己读）
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then(function (hit) {
        return hit || fetch(req).then(function (res) {
          return res;
        }).catch(function () {
          return caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 其它静态资源：缓存优先，命中就返回；没命中就联网并顺手缓存
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
