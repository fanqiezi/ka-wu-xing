/*
 * 卡五星麻将 —— 牌定义与牌面渲染
 *
 * 牌张构成（共 84 张）：
 *   筒 1-9   各 4 张 = 36
 *   条 1-9   各 4 张 = 36
 *   中 发 白 各 4 张 = 12
 * 编码：0..8 筒一~筒九，9..17 条一~条九，18 中，19 发，20 白
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.KWX = root.KWX || {}; root.KWX.Tiles = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TONG = 0, TIAO = 1, ZI = 2;
  var TILE_TYPES = 21;
  var HONOR_START = 18;
  var CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var HONOR_NAME = ['红中', '发财', '白板'];
  var HONOR_SHORT = ['中', '发', '白'];

  function isHonor(t) { return t >= HONOR_START; }
  function isNumber(t) { return t < HONOR_START; }
  function suitOf(t) { return t >= HONOR_START ? ZI : (t >= 9 ? TIAO : TONG); }
  function rankOf(t) { return t >= HONOR_START ? 0 : (t % 9) + 1; }
  function suitStart(suit) { return suit === TONG ? 0 : (suit === TIAO ? 9 : 18); }
  function suitName(suit) { return suit === TONG ? '筒' : (suit === TIAO ? '条' : '字'); }

  function nameOf(t) {
    if (isHonor(t)) return HONOR_NAME[t - HONOR_START];
    return CN[rankOf(t)] + suitName(suitOf(t));
  }
  function shortOf(t) {
    if (isHonor(t)) return HONOR_SHORT[t - HONOR_START];
    return rankOf(t) + suitName(suitOf(t));
  }

  /** 生成一副 84 张的牌墙（未洗） */
  function makeWall() {
    var wall = [];
    for (var t = 0; t < TILE_TYPES; t++) {
      for (var k = 0; k < 4; k++) wall.push(t);
    }
    return wall;
  }

  /** Fisher-Yates 洗牌，可传入随机函数（便于测试复现） */
  function riffle(arr, rng) {
    var r = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /** 牌数组 -> 计数数组(21) */
  function countsOf(tiles) {
    var c = new Array(TILE_TYPES);
    for (var i = 0; i < TILE_TYPES; i++) c[i] = 0;
    for (var k = 0; k < tiles.length; k++) c[tiles[k]]++;
    return c;
  }

  function cloneCounts(c) { return c.slice(); }

  /** 计数数组 -> 牌数组（升序） */
  function tilesOfCounts(c) {
    var out = [];
    for (var t = 0; t < TILE_TYPES; t++) {
      for (var k = 0; k < c[t]; k++) out.push(t);
    }
    return out;
  }

  function sorted(tiles) { return tiles.slice().sort(function (a, b) { return a - b; }); }

  function totalCount(c) {
    var s = 0;
    for (var i = 0; i < TILE_TYPES; i++) s += c[i];
    return s;
  }

  /* ------------------------------------------------------------------ *
   * 牌面渲染：返回一段 <svg> 字符串
   * 视口 100 x 140
   * ------------------------------------------------------------------ */

  var GREEN = '#2e7d32', RED = '#c62828', BLUE = '#1565c0', INK = '#1f2328';

  var DOT_LAYOUT = {
    1: [[0.5, 0.5]],
    2: [[0.5, 0.29], [0.5, 0.71]],
    3: [[0.27, 0.28], [0.5, 0.5], [0.73, 0.72]],
    4: [[0.32, 0.31], [0.68, 0.31], [0.32, 0.69], [0.68, 0.69]],
    5: [[0.29, 0.29], [0.71, 0.29], [0.5, 0.5], [0.29, 0.71], [0.71, 0.71]],
    6: [[0.32, 0.22], [0.68, 0.22], [0.32, 0.5], [0.68, 0.5], [0.32, 0.78], [0.68, 0.78]],
    7: [[0.26, 0.21], [0.5, 0.21], [0.74, 0.21], [0.32, 0.58], [0.68, 0.58], [0.32, 0.83], [0.68, 0.83]],
    8: [[0.32, 0.17], [0.68, 0.17], [0.32, 0.39], [0.68, 0.39], [0.32, 0.61], [0.68, 0.61], [0.32, 0.83], [0.68, 0.83]],
    9: [[0.24, 0.21], [0.5, 0.21], [0.76, 0.21], [0.24, 0.5], [0.5, 0.5], [0.76, 0.5], [0.24, 0.79], [0.5, 0.79], [0.76, 0.79]]
  };

  var STICK_LAYOUT = {
    2: [[0.34, 0.5], [0.66, 0.5]],
    3: [[0.5, 0.25], [0.3, 0.72], [0.7, 0.72]],
    4: [[0.33, 0.31], [0.67, 0.31], [0.33, 0.69], [0.67, 0.69]],
    5: [[0.29, 0.29], [0.71, 0.29], [0.5, 0.5], [0.29, 0.71], [0.71, 0.71]],
    6: [[0.33, 0.22], [0.67, 0.22], [0.33, 0.5], [0.67, 0.5], [0.33, 0.78], [0.67, 0.78]],
    7: [[0.5, 0.19], [0.26, 0.51], [0.5, 0.51], [0.74, 0.51], [0.26, 0.82], [0.5, 0.82], [0.74, 0.82]],
    8: [[0.3, 0.17], [0.7, 0.17], [0.3, 0.39], [0.7, 0.39], [0.3, 0.61], [0.7, 0.61], [0.3, 0.83], [0.7, 0.83]],
    9: [[0.24, 0.21], [0.5, 0.21], [0.76, 0.21], [0.24, 0.5], [0.5, 0.5], [0.76, 0.5], [0.24, 0.79], [0.5, 0.79], [0.76, 0.79]]
  };

  var RED_STICKS = { 1: [0], 5: [2], 7: [0], 9: [3, 4, 5] };

  /** 筒子每一张的配色（贴近实物牌：蓝绿为主、部分红心） */
  var DOT_COLORS = {
    1: [RED],
    2: [GREEN, BLUE],
    3: [BLUE, GREEN, RED],
    4: [BLUE, GREEN, GREEN, BLUE],
    5: [BLUE, BLUE, RED, BLUE, BLUE],
    6: [GREEN, GREEN, RED, RED, GREEN, GREEN],
    7: [GREEN, GREEN, GREEN, BLUE, BLUE, BLUE, BLUE],
    8: [BLUE, BLUE, BLUE, BLUE, BLUE, BLUE, BLUE, BLUE],
    9: [BLUE, BLUE, BLUE, GREEN, GREEN, GREEN, BLUE, BLUE, BLUE]
  };

  function px(fx) { return (fx * 100).toFixed(2); }
  function py(fy) { return (fy * 140).toFixed(2); }

  /** 筒子：外圈 + 内圈 + 实心点，模仿真牌的同心圆 */
  function dotSvg(cx, cy, r, color) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#fdfbf3" stroke="' + color +
      '" stroke-width="' + (r * 0.30).toFixed(2) + '"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.52).toFixed(2) + '" fill="none" stroke="' + color +
      '" stroke-width="' + (r * 0.17).toFixed(2) + '"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.24).toFixed(2) + '" fill="' + color + '"/>';
  }

  /** 条子：带竹节和两端箍的竹条 */
  function stickSvg(cx, cy, color) {
    var w = 9, h = 30;
    var x = cx - w / 2, y = cy - h / 2;
    return '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + w + '" height="' + h +
      '" rx="4" fill="' + color + '"/>' +
      '<rect x="' + (x + 2).toFixed(2) + '" y="' + (y + 3).toFixed(2) + '" width="2.2" height="' + (h - 6) +
      '" rx="1.1" fill="#ffffff" opacity="0.4"/>' +
      '<rect x="' + x.toFixed(2) + '" y="' + (cy - 1.3).toFixed(2) + '" width="' + w +
      '" height="2.6" rx="1.3" fill="#ffffff" opacity="0.28"/>' +
      '<rect x="' + (x - 2).toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + (w + 4) +
      '" height="4" rx="2" fill="' + color + '"/>' +
      '<rect x="' + (x - 2).toFixed(2) + '" y="' + (y + h - 4).toFixed(2) + '" width="' + (w + 4) +
      '" height="4" rx="2" fill="' + color + '"/>' +
      '<rect x="' + (x - 2).toFixed(2) + '" y="' + (y + 0.8).toFixed(2) + '" width="' + (w + 4) +
      '" height="1.4" rx="0.7" fill="#ffffff" opacity="0.35"/>';
  }

  /** 一条：一只麻雀 */
  function birdSvg() {
    return '' +
      '<path d="M36 88 L6 124 L34 116 Z" fill="#1565c0"/>' +
      '<path d="M40 92 L14 126 L44 118 Z" fill="#42a5f5"/>' +
      '<ellipse cx="56" cy="88" rx="21" ry="26" fill="#2e7d32"/>' +
      '<ellipse cx="61" cy="92" rx="12" ry="16" fill="#dcedc8"/>' +
      '<path d="M41 74 q16 -8 31 4 q-4 12 -31 -4 z" fill="#1b5e20"/>' +
      '<path d="M46 78 q12 -4 21 3" stroke="#a5d6a7" stroke-width="1.6" fill="none"/>' +
      '<circle cx="55" cy="44" r="16" fill="#2e7d32"/>' +
      '<path d="M55 28 L50 6 L67 23 Z" fill="#c62828"/>' +
      '<path d="M62 26 L66 12 L71 26 Z" fill="#e53935"/>' +
      '<circle cx="48" cy="41" r="4.6" fill="#ffffff"/>' +
      '<circle cx="48" cy="41" r="2.4" fill="#1f2328"/>' +
      '<circle cx="49.4" cy="40" r="0.9" fill="#ffffff"/>' +
      '<path d="M70 40 L92 47 L70 55 Z" fill="#f9a825"/>' +
      '<path d="M70 47 L90 47" stroke="#e08b00" stroke-width="1.2"/>' +
      '<path d="M49 112 l-7 12 M63 112 l7 12" stroke="#f9a825" stroke-width="3.4" stroke-linecap="round" fill="none"/>' +
      '<path d="M42 124 l-4 2 M56 124 l-4 2 M70 124 l4 2" stroke="#f9a825" stroke-width="2.4" stroke-linecap="round" fill="none"/>';
  }

  function honorSvg(t) {
    if (t === 18) {
      return '<text x="50" y="104" font-size="82" text-anchor="middle" fill="' + RED + '" ' +
        'font-family="KaiTi,STKaiti,SimSun,serif" font-weight="700">中</text>';
    }
    if (t === 19) {
      return '<text x="50" y="104" font-size="82" text-anchor="middle" fill="' + GREEN + '" ' +
        'font-family="KaiTi,STKaiti,SimSun,serif" font-weight="700">发</text>';
    }
    // 白板：真牌就是一个蓝框
    return '<rect x="15" y="24" width="70" height="92" rx="7" fill="none" stroke="' + BLUE + '" stroke-width="5.5"/>' +
      '<rect x="26" y="36" width="48" height="68" rx="4" fill="none" stroke="' + BLUE + '" stroke-width="2.4" opacity="0.8"/>';
  }

  /**
   * 生成牌面 SVG
   * @param {number} t 牌编码
   * @param {object} [opt] {numeral:boolean} 是否在角落显示数字
   */
  function faceSvg(t, opt) {
    opt = opt || {};
    var body = '';
    if (isHonor(t)) {
      body = honorSvg(t);
    } else if (suitOf(t) === TONG) {
      var n = rankOf(t);
      var pos = DOT_LAYOUT[n];
      var cols = DOT_COLORS[n] || [];
      var r = n === 1 ? 25 : (n <= 3 ? 15 : (n <= 6 ? 12 : 10.5));
      for (var i = 0; i < pos.length; i++) {
        body += dotSvg(px(pos[i][0]), py(pos[i][1]), r, cols[i] || BLUE);
      }
    } else {
      var m = rankOf(t);
      if (m === 1) {
        body = birdSvg();
      } else {
        var sp = STICK_LAYOUT[m];
        var reds = RED_STICKS[m] || [];
        for (var j = 0; j < sp.length; j++) {
          var col = reds.indexOf(j) >= 0 ? RED : GREEN;
          body += stickSvg(px(sp[j][0]), py(sp[j][1]), col);
        }
      }
    }
    var numeral = '';
    if (opt.numeral && !isHonor(t)) {
      numeral = '<text x="94" y="134" font-size="22" text-anchor="end" fill="' + INK +
        '" opacity="0.34" font-family="Arial,Helvetica,sans-serif" font-weight="700">' + rankOf(t) + '</text>';
    }
    return '<svg class="tile-face" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      body + numeral + '</svg>';
  }

  /** 牌背 SVG */
  function backSvg() {
    return '<svg class="tile-face" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<rect x="10" y="10" width="80" height="120" rx="10" fill="#2b6cb0" opacity="0.9"/>' +
      '<rect x="20" y="20" width="60" height="100" rx="7" fill="none" stroke="#9ec5fe" stroke-width="3" opacity="0.85"/>' +
      '<circle cx="50" cy="70" r="14" fill="none" stroke="#cfe2ff" stroke-width="3" opacity="0.9"/>' +
      '</svg>';
  }

  return {
    TONG: TONG, TIAO: TIAO, ZI: ZI,
    TILE_TYPES: TILE_TYPES,
    HONOR_START: HONOR_START,
    isHonor: isHonor,
    isNumber: isNumber,
    suitOf: suitOf,
    rankOf: rankOf,
    suitStart: suitStart,
    suitName: suitName,
    nameOf: nameOf,
    shortOf: shortOf,
    makeWall: makeWall,
    riffle: riffle,
    countsOf: countsOf,
    cloneCounts: cloneCounts,
    tilesOfCounts: tilesOfCounts,
    sorted: sorted,
    totalCount: totalCount,
    faceSvg: faceSvg,
    backSvg: backSvg
  };
});
