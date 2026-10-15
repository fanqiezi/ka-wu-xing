/*
 * 卡五星麻将 —— 启动入口
 * ui.js 已在 DOMContentLoaded 时完成初始化，这里只做环境提示与兜底错误处理。
 */
(function () {
  'use strict';

  if (!window.KWX || !window.KWX.Game) {
    document.body.innerHTML =
      '<pre style="color:#fff;font:14px/1.7 monospace;padding:24px">' +
      '脚本没有正确加载。\n请确认 js/ 目录下的 tiles.js / rules.js / ai.js / game.js / ui.js 都存在。</pre>';
    return;
  }

  window.addEventListener('error', function (e) {
    console.error('[卡五星] 运行错误', e.error || e.message);
  });

  console.log('%c卡五星麻将 · 单机版', 'color:#e8c56a;font-weight:700',
    '\n规则要点：84 张牌（筒/条/中发白），三人，只能碰杠不能吃。' +
    '\n本版按通行规则实现：屁胡（小胡）只能自摸，不能捉炮。');
})();
