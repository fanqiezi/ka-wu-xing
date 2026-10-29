/**
 * js/memory.js —— 「成长型」电脑的记忆与对手模型
 *
 * 只记**公开信息**（牌河、副露、切牌方式、胡牌结果），绝不读人类的手牌。
 * 存 localStorage['kwx.ai.memory.v1']，跨对局、跨刷新都在；带版本号，坏数据自动丢掉。
 * 数值上全部走「先验 + 收缩 + 上下限 + 衰减」，样本少的时候基本等于没有记忆。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KWX = root.KWX || {};
    root.KWX.Memory = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'kwx.ai.memory.v1';
  var VERSION = 1;

  // 先验：没数据时的默认画像（普通人的水平）
  var PRIOR = {
    aggression: 0.33,      // 碰杠倾向（0 保守 ~ 1 激进）
    tsumogiri: 0.50,       // 摸切率
    winSpeed: 0.50         // 胡牌速度（0 慢 ~ 1 快）
  };

  var MIN_GAMES = 20;      // 累计这么多局才算「完全信任」记忆
  var MAX_HOT = 8;         // 最多记 8 张「他爱胡的牌」

  function blank() {
    return {
      version: VERSION,
      games: 0,
      updatedAt: 0,
      human: {
        rounds: 0,
        discards: 0,
        tsumogiri: 0,
        pongs: 0,
        kongs: 0,
        winTiles: {},        // 他胡的牌 → 次数
        dealIn: {},          // 他放铳的牌 → 次数
        fans: {},            // 胡牌番数分布
        winDiscards: 0       // 他胡牌时全场已切出的张数（衡量快慢）
      }
    };
  }

  function bump(obj, k) {
    if (k === null || k === undefined) return;
    obj[k] = (obj[k] || 0) + 1;
  }

  /** 把一局的人类公开行为记进去；rec 由 game.js 在局末整理 */
  function update(mem, rec) {
    if (!mem || !mem.human) mem = blank();
    if (mem.version !== VERSION) mem = blank();
    if (!rec) return mem;
    var h = mem.human;
    h.rounds += 1;
    h.discards += rec.discards || 0;
    h.tsumogiri += rec.tsumogiri || 0;
    h.pongs += rec.pongs || 0;
    h.kongs += rec.kongs || 0;
    if (rec.winDiscards) h.winDiscards += rec.winDiscards;
    // 先让老记忆变淡（每局 ×0.98），再记这一局的新证据 —— 避免新证据被自己衰减
    decayMap(h.winTiles, 0.98);
    decayMap(h.dealIn, 0.98);
    decayMap(h.fans, 0.98);
    bump(h.winTiles, rec.winTile);
    bump(h.dealIn, rec.dealInTile);
    if (rec.fan) bump(h.fans, Math.round(rec.fan));
    mem.games = (mem.games || 0) + 1;
    mem.updatedAt = Date.now();
    return mem;
  }

  function decayMap(obj, k) {
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      obj[key] *= k;
      if (obj[key] < 0.02) delete obj[key];
    }
  }

  function topKeys(obj, n) {
    return Object.keys(obj)
      .map(function (k) { return { k: k, v: obj[k] }; })
      .filter(function (x) { return x.v > 0; })
      .sort(function (a, b) { return b.v - a.v; })
      .slice(0, n)
      .map(function (x) { return { tile: parseInt(x.k, 10), count: x.v }; });
  }

  /**
   * 由记忆算出「人类画像」（供 AI 决策使用）
   * @returns {{rounds, confidence, aggression, tsumogiri, winSpeed, hot, dealIn}}
   */
  function profile(mem) {
    var h = (mem && mem.version === VERSION && mem.human) ? mem.human : blank().human;
    var rounds = h.rounds || 0;
    var conf = Math.min(1, rounds / MIN_GAMES);
    var aggObs = h.rounds ? (h.pongs + h.kongs * 2) / (h.rounds * 3) : PRIOR.aggression;
    var tsumoObs = h.discards ? h.tsumogiri / h.discards : PRIOR.tsumogiri;
    // 收缩：样本少的时候朝先验靠（贝叶斯式的简单做法）
    function shrink(obs, prior, n, k) { return (obs * n + prior * k) / (n + k); }
    var aggression = shrink(aggObs, PRIOR.aggression, rounds, MIN_GAMES);
    var tsumogiri = shrink(tsumoObs, PRIOR.tsumogiri, h.discards || 0, 20);
    var avgWinDiscards = h.winDiscards && Object.keys(h.fans).length
      ? h.winDiscards / Math.max(1, Object.keys(h.fans).length) : 40;
    var winSpeed = Math.max(0, Math.min(1, 1 - avgWinDiscards / 80));
    return {
      rounds: rounds,
      confidence: conf,
      aggression: Math.max(0.05, Math.min(0.95, aggression)),
      tsumogiri: Math.max(0, Math.min(1, tsumogiri)),
      winSpeed: winSpeed,
      hot: topKeys(h.winTiles, MAX_HOT),
      dealIn: topKeys(h.dealIn, MAX_HOT)
    };
  }

  /** 给「成长档案」面板用：一行行的中文摘要 */
  function describe(mem) {
    var p = profile(mem);
    var rows = [];
    rows.push({ label: '累计局数', value: p.rounds + ' 局' });
    rows.push({
      label: '信任度', value: Math.round(p.confidence * 100) + '%',
      note: p.confidence < 1 ? '（满 ' + MIN_GAMES + ' 局后才完全生效）' : ''
    });
    rows.push({
      label: '打法激进程度', value: Math.round(p.aggression * 100) + '%',
      note: p.aggression > 0.45 ? '（偏碰杠、想快听）' : (p.aggression < 0.25 ? '（偏做牌、不轻易碰）' : '（中规中矩）')
    });
    rows.push({
      label: '摸切率', value: Math.round(p.tsumogiri * 100) + '%',
      note: p.tsumogiri > 0.65 ? '（常常摸到就切，手牌比较顺）'
        : (p.tsumogiri < 0.35 ? '（手切多，说明常在换张做牌）' : '（摸切和手切差不多）')
    });
    var hotTxt = p.hot.length ? p.hot.map(function (x) { return '#' + x.tile + '×' + Math.round(x.count); }).join(' ') : '还没有';
    rows.push({ label: '他常胡的牌', value: hotTxt, note: '（电脑会重点防这几张）' });
    return rows;
  }

  /* ---------------- 持久化 ---------------- */

  function storageOf(s) {
    if (s) return s;
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null;
      return localStorage;
    } catch (e) { return null; }
  }

  function load(s) {
    var ls = storageOf(s);
    if (!ls) return blank();
    try {
      var raw = ls.getItem(KEY);
      if (!raw) return blank();
      var obj = JSON.parse(raw);
      if (!obj || obj.version !== VERSION || !obj.human) return blank();
      return obj;
    } catch (e) { return blank(); }
  }

  function save(s, mem) {
    var ls = storageOf(s);
    if (!ls) return false;
    try {
      ls.setItem(KEY, JSON.stringify(mem));
      return true;
    } catch (e) { return false; }      // 隐私模式 / 配额满
  }

  function clear(s) {
    var ls = storageOf(s);
    if (!ls) return;
    try { ls.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return {
    KEY: KEY,
    VERSION: VERSION,
    PRIOR: PRIOR,
    MIN_GAMES: MIN_GAMES,
    blank: blank,
    update: update,
    profile: profile,
    describe: describe,
    load: load,
    save: save,
    clear: clear
  };
});
