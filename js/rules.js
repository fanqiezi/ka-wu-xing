/*
 * 卡五星麻将 —— 规则引擎
 *   - 胡牌判定（标准型 4 副 + 将 / 七对）
 *   - 听牌与向听数（AI 用）
 *   - 番型与计分
 *   - 屁胡（小胡）只能自摸，不能捉炮  ← 关键规则修复
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./tiles.js')); }
  else { root.KWX = root.KWX || {}; root.KWX.Rules = factory(root.KWX.Tiles); }
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  var TT = T.TILE_TYPES;          // 21
  var HONOR_START = T.HONOR_START; // 18

  /* ================= 基础判定 ================= */

  /** 计数数组能否拆成 needSets 副（刻子/顺子），不保留任何余牌 */
  function canFormSets(c, needSets) {
    if (needSets === 0) {
      for (var i = 0; i < TT; i++) if (c[i] !== 0) return false;
      return true;
    }
    var i = 0;
    while (i < TT && c[i] === 0) i++;
    if (i >= TT) return false;
    if (c[i] >= 3) {
      c[i] -= 3;
      if (canFormSets(c, needSets - 1)) { c[i] += 3; return true; }
      c[i] += 3;
    }
    if (i < HONOR_START && (i % 9) <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      if (canFormSets(c, needSets - 1)) { c[i]++; c[i + 1]++; c[i + 2]++; return true; }
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    return false;
  }

  /** 是否和牌（计数数组含胡牌张）；melds 为副露数组 */
  function isWinCounts(counts, melds) {
    var meldCount = melds ? melds.length : 0;
    var need = 4 - meldCount;
    if (need < 0) return false;
    var total = 0;
    for (var i = 0; i < TT; i++) total += counts[i];
    if (total !== need * 3 + 2) return false;
    if (meldCount === 0 && sevenPairsInfo(counts)) return true;
    var c = counts.slice();
    for (var p = 0; p < TT; p++) {
      if (c[p] >= 2) {
        c[p] -= 2;
        var ok = canFormSets(c, need);
        c[p] += 2;
        if (ok) return true;
      }
    }
    return false;
  }

  /** 七对信息：返回 null 或 {pairs, quads, isLong, isDoubleLong} */
  function sevenPairsInfo(counts) {
    var pairs = 0, quads = 0;
    for (var i = 0; i < TT; i++) {
      if (counts[i] % 2 !== 0) return null;
      pairs += counts[i] / 2;
      if (counts[i] === 4) quads++;
    }
    if (pairs !== 7) return null;
    return { pairs: 7, quads: quads, isLong: quads >= 1, isDoubleLong: quads >= 2 };
  }

  var DECOMP_LIMIT = 120;

  /** 枚举所有合法拆解（用于番型判定，如碰碰胡、卡五星） */
  function allDecompositions(counts, needSets) {
    var out = [];
    var c = counts.slice();
    for (var p = 0; p < TT; p++) {
      if (c[p] >= 2) {
        c[p] -= 2;
        collect(c, 0, needSets, [], out, p);
        c[p] += 2;
      }
      if (out.length >= DECOMP_LIMIT) break;
    }
    return out;
  }

  function collect(c, start, need, acc, out, pair) {
    if (out.length >= DECOMP_LIMIT) return;
    if (need === 0) {
      for (var i = 0; i < TT; i++) if (c[i] !== 0) return;
      out.push({ pair: pair, sets: acc.slice() });
      return;
    }
    var i = start;
    while (i < TT && c[i] === 0) i++;
    if (i >= TT) return;
    if (c[i] >= 3) {
      c[i] -= 3; acc.push({ type: 'triplet', tile: i });
      collect(c, i, need - 1, acc, out, pair);
      acc.pop(); c[i] += 3;
    }
    if (i < HONOR_START && (i % 9) <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      acc.push({ type: 'run', tile: i });
      collect(c, i, need - 1, acc, out, pair);
      acc.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
    }
  }

  /* ================= 听牌 ================= */

  /** 返回所有能让该手牌和牌的牌（不含牌山剩余校验） */
  function waitingTiles(tiles, melds) {
    var counts = T.countsOf(tiles);
    var out = [];
    for (var t = 0; t < TT; t++) {
      if (counts[t] >= 4) continue;
      counts[t]++;
      if (isWinCounts(counts, melds)) out.push(t);
      counts[t]--;
    }
    return out;
  }

  function isTenpai(tiles, melds) { return waitingTiles(tiles, melds).length > 0; }

  /* ================= 向听数 ================= */

  /**
   * 标准型向听数。
   *
   * 一副和牌 = 4 副面子 + 1 个将，共 5 个「搭子」。设手牌（含副露）能拆出
   *   m 个完整面子、p 个两面/嵌张搭子、q 个对子
   * 则：
   *   - 若 q >= 1，用其中 1 个对子做将，其余 q-1 个对子当搭子用；
   *   - 若 q == 0，还要额外 1 张牌造将。
   *   - 能做面子的搭子数 r = min(p + max(0,q-1), 4-m)
   *   - 还差 2*(4-m-r) + r + (q==0?1:0) 张牌成和
   * 向听数 = 还差张数 - 1（已和牌为 -1，听牌为 0）。
   *
   * 用「按牌型 DP + 状态记忆」枚举所有 (m, p, q) 组合，避免指数爆炸。
   */
  function standardShanten(counts, meldCount) {
    var memo = new Map();

    function key(i) {
      var s = i + ':';
      for (var k = i; k < TT; k++) s += counts[k] + ',';
      return s;
    }

    /** 只保留帕累托最优状态：若已有 (s',p',q') 各项都不小于它，则该状态无用 */
    function prune(list) {
      if (list.length <= 1) return list;
      list.sort(function (a, b) { return b[0] - a[0] || b[1] - a[1] || b[2] - a[2]; });
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i][0], p = list[i][1], q = list[i][2];
        var dominated = false;
        for (var k = 0; k < out.length; k++) {
          if (out[k][0] >= s && out[k][1] >= p && out[k][2] >= q) { dominated = true; break; }
        }
        if (!dominated) out.push(list[i]);
      }
      return out;
    }

    /** 返回 tiles[i..] 能形成的 [面子, 搭子, 对子] 组合（未使用牌作浮牌忽略） */
    function states(i) {
      var k = key(i);
      if (memo.has(k)) return memo.get(k);
      var res = [];
      var seen = new Set();
      function push(s, p, q) {
        if (s > 4 || p > 4 || q > 4) return;
        var kk = s + ',' + p + ',' + q;
        if (!seen.has(kk)) { seen.add(kk); res.push([s, p, q]); }
      }
      var j = i;
      while (j < TT && counts[j] === 0) j++;
      if (j >= TT) { push(0, 0, 0); res = prune(res); memo.set(k, res); return res; }

      var sub, n, x;
      function merge(ds, dp, dq) {
        for (x = 0; x < sub.length; x++) push(sub[x][0] + ds, sub[x][1] + dp, sub[x][2] + dq);
      }

      // 1) 这一张作浮牌丢弃
      counts[j]--;
      sub = states(j);
      counts[j]++;
      merge(0, 0, 0);

      // 2) 刻子
      if (counts[j] >= 3) {
        counts[j] -= 3;
        sub = states(j);
        counts[j] += 3;
        merge(1, 0, 0);
      }
      // 3) 顺子
      if (j < HONOR_START && (j % 9) <= 6 && counts[j + 1] > 0 && counts[j + 2] > 0) {
        counts[j]--; counts[j + 1]--; counts[j + 2]--;
        sub = states(j);
        counts[j]++; counts[j + 1]++; counts[j + 2]++;
        merge(1, 0, 0);
      }
      // 4) 对子
      if (counts[j] >= 2) {
        counts[j] -= 2;
        sub = states(j);
        counts[j] += 2;
        merge(0, 0, 1);
      }
      // 5) 两面/边张搭子 (j, j+1)
      if (j < HONOR_START && (j % 9) <= 7 && counts[j + 1] > 0) {
        counts[j]--; counts[j + 1]--;
        sub = states(j);
        counts[j]++; counts[j + 1]++;
        merge(0, 1, 0);
      }
      // 6) 嵌张搭子 (j, j+2)
      if (j < HONOR_START && (j % 9) <= 6 && counts[j + 2] > 0) {
        counts[j]--; counts[j + 2]--;
        sub = states(j);
        counts[j]++; counts[j + 2]++;
        merge(0, 1, 0);
      }
      memo.set(k, prune(res));
      return memo.get(k);
    }

    var st = states(0);
    var best = 8;
    for (var n = 0; n < st.length; n++) {
      var m = st[n][0] + meldCount;
      if (m > 4) m = 4;
      var p = st[n][1];
      var q = st[n][2];
      var pTotal = p + (q >= 1 ? q - 1 : q);
      var room = 4 - m;
      if (pTotal > room) pTotal = room;
      if (pTotal < 0) pTotal = 0;
      var need = 2 * (room - pTotal) + pTotal + (q >= 1 ? 0 : 1);
      var sh = need - 1;
      if (sh < best) best = sh;
    }
    return best;
  }

  function chiitoiShanten(counts) {
    var pairs = 0, kinds = 0;
    for (var i = 0; i < TT; i++) {
      if (counts[i] >= 1) kinds++;
      if (counts[i] >= 2) pairs++;
    }
    return 6 - pairs + Math.max(0, 7 - kinds);
  }

  /** 综合向听数（标准型与七对取小） */
  function shanten(tiles, melds) {
    var counts = T.countsOf(tiles);
    var meldCount = melds ? melds.length : 0;
    if (isWinCounts(counts, melds)) return -1;
    var best = standardShanten(counts, meldCount);
    if (meldCount === 0) {
      var s7 = chiitoiShanten(counts);
      if (s7 < best) best = s7;
    }
    return best;
  }

  /**
   * 有效进张：返回 { tile: 剩余可进张数 }，只统计能降低向听数（或直接和牌）的牌
   * remainOf 用于扣除已经出现过的牌
   */
  function usefulTiles(tiles, melds, remain) {
    var counts = T.countsOf(tiles);
    var base = shanten(tiles, melds);
    var out = {};
    for (var t = 0; t < TT; t++) {
      var rem = remain ? remain[t] : (4 - counts[t]);
      if (rem <= 0) continue;
      counts[t]++;
      var nt = T.tilesOfCounts(counts);
      var ns = shanten(nt, melds);
      counts[t]--;
      if (ns < base) out[t] = rem;
    }
    return out;
  }

  /* ================= 亮倒时该亮哪几张牌 =================
   *
   * 规则：亮倒只需要展示「能凑成赢牌的关联牌」。
   *   - 标准型：把手上已经成型的整段（刻子 / 顺子 / 将）藏起来，
   *     只亮还在等牌的那一整段。例：
   *       11134567999 + 中中，听 2/5/8  ->  只亮 34567
   *       1223345578 + 中中中，听 6/9   ->  只亮 78
   *   - 七对一族：单骑那张必亮，另外每个四张亮 2 张
   *     七对亮 1 张、龙七对亮 3 张、双龙七对亮 5 张，以此类推。
   */

  /** 这副牌能不能全部拆成面子（刻子/顺子） */
  function allSets(c) {
    var total = 0;
    for (var i = 0; i < TT; i++) total += c[i];
    if (total % 3 !== 0) return false;
    return canFormSets(c.slice(), total / 3);
  }

  /** 能不能拆成 pairCount 个对子 + 若干面子 */
  function canPartitionPairs(c, pairCount) {
    if (!pairCount) return allSets(c);
    for (var p = 0; p < TT; p++) {
      if (c[p] >= 2) {
        c[p] -= 2;
        var ok = allSets(c);
        c[p] += 2;
        if (ok) return true;
      }
    }
    return false;
  }

  /** 把手牌按「连续段」切分：筒/条按相邻的连续区间切，字牌每种单独一段 */
  function componentsOf(hand) {
    var c = T.countsOf(hand);
    var comps = [];
    for (var s = 0; s < 2; s++) {
      var base = s * 9, i = 0;
      while (i < 9) {
        if (c[base + i] === 0) { i++; continue; }
        var j = i;
        while (j + 1 < 9 && c[base + j + 1] > 0) j++;
        var tiles = [];
        for (var k = i; k <= j; k++) {
          for (var n = 0; n < c[base + k]; n++) tiles.push(base + k);
        }
        comps.push(tiles);
        i = j + 1;
      }
    }
    for (var h = HONOR_START; h < TT; h++) {
      if (c[h] > 0) {
        var ht = [];
        for (var m = 0; m < c[h]; m++) ht.push(h);
        comps.push(ht);
      }
    }
    return comps;
  }

  /** 标准型的亮牌（兜底）：藏掉能自成完整面子的整段 */
  function standardReveal(hand) {
    var comps = componentsOf(hand);
    var hidden = [];
    var needPair = [];
    for (var i = 0; i < comps.length; i++) {
      var c = T.countsOf(comps[i]);
      if (canPartitionPairs(c, 0)) hidden.push(comps[i]);
      else if (canPartitionPairs(c, 1)) needPair.push(comps[i]);
    }
    // 整手牌只需要一个将；从「要占一个对子」的分段里挑最大的那段藏起来
    if (needPair.length) {
      needPair.sort(function (a, b) { return b.length - a.length; });
      hidden.push(needPair[0]);
    }
    var hide = {};
    hidden.forEach(function (tiles) {
      tiles.forEach(function (t) { hide[t] = (hide[t] || 0) + 1; });
    });
    var out = [];
    hand.forEach(function (t) {
      if (hide[t] > 0) { hide[t]--; return; }
      out.push(t);
    });
    return T.sorted(out);
  }

  /** 七对一族的亮牌：单骑那张 + 每个四张亮 2 张 */
  function sevenPairsReveal(hand, meldCount) {
    if (meldCount) return null;
    var c = T.countsOf(hand);
    var single = -1, quads = [], pairs = 0;
    for (var i = 0; i < TT; i++) {
      if (c[i] === 0) continue;
      if (c[i] % 2 === 0) {
        pairs += c[i] / 2;
        if (c[i] === 4) quads.push(i);
        continue;
      }
      if (c[i] === 1 && single < 0) { single = i; continue; }
      return null;                  // 不是七对型
    }
    if (single < 0 || pairs !== 6) return null;
    var out = [single];
    quads.forEach(function (q) { out.push(q); out.push(q); });
    return T.sorted(out);
  }

  /** 这副牌能否拆成若干面子 + 至多一个将对子；返回「用掉几个对子」的可达集合 */
  var pairMemo = new Map();
  function pairOptions(c) {
    var key = c.join(',');
    if (pairMemo.has(key)) return pairMemo.get(key);
    var opts = [];
    if (allSets(c)) opts.push(0);
    for (var p = 0; p < TT; p++) {
      if (c[p] >= 2) {
        c[p] -= 2;
        var ok = allSets(c);
        c[p] += 2;
        if (ok) { opts.push(1); break; }
      }
    }
    pairMemo.set(key, opts);
    return opts;
  }

  /** 全是偶数张（对子堆），七对型用 */
  function allPairs(c) {
    for (var i = 0; i < TT; i++) if (c[i] % 2 !== 0) return false;
    return true;
  }

  /**
   * 亮出这几张牌，对手能不能推出全部听张？
   *   - 藏起来的部分要能拆成完整面子（将只能有一个）；
   *   - 对每个听张 W，「亮出的牌 + W」也要能拆成完整面子，
   *     并且两边的将加起来正好一个（一副和牌只有一个将）；
   *   - 七对型另算：两边都是成对的牌堆。
   */
  function revealWorks(handCounts, revealed, waits) {
    var cT = T.countsOf(revealed);
    var cH = handCounts.slice();
    var hTotal = 0;
    for (var i = 0; i < TT; i++) {
      cH[i] -= cT[i];
      if (cH[i] < 0) return false;
      hTotal += cH[i];
    }
    var oH = pairOptions(cH);
    var hPairs = hTotal > 0 && allPairs(cH);
    if (hTotal === 0) return true;            // 整手牌都亮出来了，对手当然推得出
    if (!oH.length && !hPairs) return false;
    for (var w = 0; w < waits.length; w++) {
      var cW = cT.slice();
      cW[waits[w]]++;
      var ok = false;
      var oW = pairOptions(cW);
      for (var a = 0; a < oW.length && !ok; a++) {
        for (var b = 0; b < oH.length; b++) {
          if (oW[a] + oH[b] === 1) { ok = true; break; }
        }
      }
      if (!ok && hPairs && allPairs(cW)) ok = true;   // 七对型
      if (!ok) return false;
    }
    return true;
  }

  /** 找出能推出全部听张的、张数最少的亮牌组合 */
  function smallestReveal(hand, waits) {
    var counts = T.countsOf(hand);
    var n = hand.length;
    var seen = Object.create(null);
    var picked = [];
    for (var size = 1; size <= n; size++) {
      var found = null;
      (function search(start, left) {
        if (found) return;
        if (left === 0) {
          var cand = picked.map(function (k) { return hand[k]; });
          var key = cand.join(',');
          if (seen[key]) return;
          seen[key] = 1;
          if (revealWorks(counts, cand, waits)) found = cand;
          return;
        }
        for (var k = start; k <= n - left; k++) {
          picked.push(k);
          search(k + 1, left - 1);
          picked.pop();
          if (found) return;
        }
      })(0, size);
      if (found) return found;
    }
    return hand.slice();
  }

  /**
   * 亮倒时要公开的那几张牌（「能凑成赢牌的关联牌」）
   *
   * 标准型：取能让对手推出全部听张的最小组合。例：
   *   11134567999 + 中中，听 2/5/8  ->  34567
   *   1223345578 + 中中中，听 6/9   ->  78
   * 七对一族：单骑那张必亮，另外每个四张亮 2 张
   *   七对 1 张、龙七对 3 张、双龙七对 5 张，以此类推。
   */
  function revealTiles(hand, melds) {
    var waits = waitingTiles(hand, melds);
    if (!waits.length) return hand.slice();
    var counts = T.countsOf(hand);
    // 七对型的「亮 1/3/5 张」只有在它也能推出全部听张时才用；
    // 有些牌同时还能按普通牌型多面听，那时这个亮法会漏听张，得退回普通搜索。
    var sp = sevenPairsReveal(hand, melds ? melds.length : 0);
    if (sp && revealWorks(counts, sp, waits)) return sp;
    return smallestReveal(hand, waits);
  }

  /* ================= 番型与计分 ================= */

  var DEFAULT_RULES = {
    baseScore: 1,               // 底金
    cap: 8,                     // 封顶倍数（双龙七对可到 16）
    pitHuOnlyZimo: true,        // 屁胡只能自摸（不能捉炮）★
    liangdaoPitHuCanDianPao: true,  // 亮倒者自己的屁胡也能捉别人的炮 ★
    liangdaoDiscardPitHu: true,  // 亮倒的人打出的牌，屁胡也能胡 ★
    gangPaoPitHu: true,          // 杠后打出的牌（杠上炮），屁胡也能胡 ★
    liangdaoEnabled: true,      // 是否允许亮倒
    liangdaoLockHand: true,     // 亮倒后只能摸打，不能再改听张 ★
    liangdaoPayDouble: true,    // 亮倒者输钱一律翻倍（点炮、别人自摸都翻倍）★
    liangdaoDianPaoAsZimo: false, // 点炮亮倒者是否按「亮倒者自摸」算两份（默认不算）★
    noDealInLiangdao: true,     // 不许故意打出亮倒者的听张（迫不得已除外）★
    liangdaoHuangPei: true,     // 荒局时亮倒的人（即使听牌）还要赔给听牌者 ★
    gangScore: true,            // 是否结算杠分
    // 荒局时未听牌赔听牌（查大叫）。亮倒的人也算听牌者，未听牌者一样要赔给他
    huangzhuangPei: true,
    zimoDouble: false           // 自摸是否额外翻倍（本规则集默认不加番）
  };

  function meldTripletOf(melds, tile) {
    for (var i = 0; i < melds.length; i++) {
      if (melds[i].tile === tile) return true;
    }
    return false;
  }

  function isQingYiSe(tiles, melds) {
    var suit = -1;
    var all = tiles.slice();
    for (var i = 0; i < melds.length; i++) {
      all.push(melds[i].tile);
    }
    for (var k = 0; k < all.length; k++) {
      if (T.isHonor(all[k])) return false;
      var s = T.suitOf(all[k]);
      if (suit === -1) suit = s;
      else if (suit !== s) return false;
    }
    return suit !== -1;
  }

  function sanYuanInfo(counts, melds) {
    var has = [];
    for (var h = HONOR_START; h < TT; h++) {
      has.push(meldTripletOf(melds, h) || counts[h] >= 3);
    }
    var tripletCount = has.filter(Boolean).length;
    var da = tripletCount === 3;
    var xiao = false;
    if (tripletCount === 2) {
      for (var i = 0; i < 3; i++) {
        if (!has[i] && counts[HONOR_START + i] >= 2) xiao = true;
      }
    }
    return { da: da, xiao: xiao };
  }

  /**
   * 计分
   * ctx = {
   *   tiles: 含胡牌张的手牌数组（不含副露），长度应为 3*(4-melds)+2
   *   melds: [{kind:'pong'|'ankong'|'mingkong'|'zhigang', tile}]
   *   winTile, selfDraw, liangdao, haidi, gangFlower, gangPao, qiangGang, rules
   * }
   */
  function scoreWin(ctx) {
    var rules = Object.assign({}, DEFAULT_RULES, ctx.rules || {});
    var tiles = ctx.tiles;
    var melds = ctx.melds || [];
    var counts = T.countsOf(tiles);
    var meldCount = melds.length;
    var need = 4 - meldCount;
    var winTile = ctx.winTile;

    var timing = [];
    // 注意：亮倒不在这里 —— 它是最后对得分整体 ×2，不参与加算
    if (ctx.haidi) timing.push({ name: '海底捞', mult: 2, kind: 'timing' });
    if (ctx.gangFlower) timing.push({ name: '杠上开花', mult: 2, kind: 'timing' });
    // 杠上炮是**乘算**，但**固定 ×2**：不再随「第几杠」递增（杠上杠也是 ×2）
    //   屁胡 + 杠上炮：1 × 2 = 2 → 2 倍底金
    //   清一色 + 杠上炮：4 × 2 = 8 → 8 倍底金
    var gangPaoMul = 1;
    if (ctx.gangPao) {
      gangPaoMul = 2;
      timing.push({ name: '杠上炮', mult: 2, kind: 'timing', mode: 'mul' });
    }
    if (ctx.qiangGang) timing.push({ name: '抢杠胡', mult: 2, kind: 'timing' });

    var qingyise = isQingYiSe(tiles, melds);
    var sy = sanYuanInfo(counts, melds);
    var candidates = [];

    // ---- 七对 / 龙七对 / 双龙七对 ----
    var sp = meldCount === 0 ? sevenPairsInfo(counts) : null;
    if (sp) {
      var items = [];
      if (sp.isDoubleLong) items.push({ name: '双龙七对', mult: 16, kind: 'type' });
      else if (sp.isLong) items.push({ name: '龙七对', mult: 8, kind: 'type' });
      else items.push({ name: '七对', mult: 4, kind: 'type' });
      if (qingyise) items.push({ name: '清一色', mult: 4, kind: 'type' });
      if (sy.da) items.push({ name: '大三元', mult: 8, kind: 'type' });
      else if (sy.xiao) items.push({ name: '小三元', mult: 4, kind: 'type' });
      candidates.push({ items: items, seven: true, doubleLong: sp.isDoubleLong });
    }

    // ---- 标准型：枚举所有拆解，取最大 ----
    var decomps = allDecompositions(counts, need);
    for (var d = 0; d < decomps.length; d++) {
      var decomp = decomps[d];
      var it = [];
      // 碰碰胡：手牌全是刻子（副露本身都是刻子），4 副碰也算
      if (decomp.sets.every(function (s) { return s.type === 'triplet'; })) {
        it.push({ name: '碰碰胡', mult: 2, kind: 'type' });
      }
      // 卡五星：胡 5 筒 / 5 条，且是 456 里的嵌张
      if (!T.isHonor(winTile) && T.rankOf(winTile) === 5) {
        for (var s2 = 0; s2 < decomp.sets.length; s2++) {
          var st = decomp.sets[s2];
          if (st.type === 'run' && st.tile + 1 === winTile) {
            it.push({ name: '卡五星', mult: 2, kind: 'type' });
            break;
          }
        }
      }
      // 明四归一：胡的牌自己碰过
      var mingSi = false;
      for (var m = 0; m < melds.length; m++) {
        if (melds[m].kind === 'pong' && melds[m].tile === winTile) mingSi = true;
      }
      if (mingSi) it.push({ name: '明四归一', mult: 2, kind: 'type' });
      // 暗四归一：胡的牌手上原有三张
      if (counts[winTile] === 4) it.push({ name: '暗四归一', mult: 4, kind: 'type' });
      // 手抓一：四副碰/杠，手牌只剩单骑
      if (meldCount === 4 && tiles.length === 2) it.push({ name: '手抓一', mult: 4, kind: 'type' });
      if (qingyise) it.push({ name: '清一色', mult: 4, kind: 'type' });
      if (sy.da) it.push({ name: '大三元', mult: 8, kind: 'type' });
      else if (sy.xiao) it.push({ name: '小三元', mult: 4, kind: 'type' });
      candidates.push({ items: it, seven: false, doubleLong: false });
    }

    if (candidates.length === 0) return null; // 诈胡

    // 取「牌型番之和」最大的拆解（加算，不再乘算）
    var best = null;
    for (var c2 = 0; c2 < candidates.length; c2++) {
      var sum2 = 0;
      for (var k = 0; k < candidates[c2].items.length; k++) sum2 += candidates[c2].items[k].mult;
      var typeFan = sum2 || 1;      // 没有任何牌型番就是屁胡，按 1 倍底金算
      if (!best || typeFan > best.typeFan ||
        (typeFan === best.typeFan && candidates[c2].items.length > best.items.length)) {
        best = {
          typeFan: typeFan,
          typeSum: sum2,            // 原始牌型番之和（可能是 0，0 才代表「一个番都没有」）
          items: candidates[c2].items.slice(),
          seven: candidates[c2].seven,
          doubleLong: candidates[c2].doubleLong
        };
      }
    }

    // 时机番里的「加算项」（杠上开花/抢杠胡/海底捞）同样相加
    var timingSum = 0;
    for (var q = 0; q < timing.length; q++) {
      if (timing[q].mode === 'mul') continue;   // 杠上炮是乘算项，不参与相加
      timingSum += timing[q].mult;
    }

    // 番型和 = 牌型番 + 加算的时机番。**底 ×1 只在什么番都没有时才算（屁胡）**：
    // 一旦有番（哪怕是杠上开花这种时机番），番数和就是那些番相加，不再额外加 1。
    var baseSum = best.typeSum + timingSum;
    if (baseSum === 0) baseSum = 1;         // 屁胡兜底：底金 ×1
    // 杠上炮「乘算」：番数和 =（牌型番 + 加算时机番）× 2（固定 2 倍，不看第几杠）
    //   屁胡 + 杠上炮：1 × 2 = 2  → 底金 5 = 10 分
    //   清一色 + 杠上炮：4 × 2 = 8 → 底金 5 = 40 分
    var sum = baseSum * gangPaoMul;
    var cap = best.doubleLong ? Math.max(rules.cap, 16) : rules.cap;
    var cappedSum = cap > 0 ? Math.min(sum, cap) : sum;
    var liangdaoMul = ctx.liangdao ? 2 : 1;
    var multiplier = cappedSum * liangdaoMul;

    var allItems = best.items.concat(timing);
    if (ctx.liangdao) allItems.push({ name: '亮倒', mult: 2, kind: 'final' });

    // 屁胡：牌型本身没有任何番（时机番不算牌型番）
    var isPitHu = best.typeFan === 1;

    return {
      fan: multiplier,          // 最终倍数（封顶后 × 亮倒）
      capped: multiplier,       // 结算直接用这个
      sum: sum,                 // 番数和（已含杠上炮乘算，未封顶、未亮倒）
      baseSum: baseSum,         // 加算部分（牌型番 + 加算时机番，屁胡兜底 1）
      gangPaoMul: gangPaoMul,   // 杠上炮倍率（无杠上炮时为 1）
      cappedSum: cappedSum,     // 封顶后、亮倒前
      liangdaoMul: liangdaoMul,
      cap: cap,
      items: allItems,
      typeItems: best.items,
      timingItems: timing,
      typeFan: best.typeFan,
      isPitHu: isPitHu,
      seven: best.seven,
      doubleLong: best.doubleLong,
      isQingYiSe: qingyise
    };
  }

  /**
   * 该手牌能否以「捉炮」（胡别人打出的牌）方式取胜。
   *
   * 卡五星规则：屁胡（小胡，底金×1）只能自摸，不能逮炮 —— 这里就是修复点。
   * 三个例外（都可配置）：
   *   1) **自己亮倒了，屁胡也能捉任何人的炮**（liangdaoPitHuCanDianPao）
   *   2) **亮倒的人打出的牌，屁胡也能胡**（liangdaoDiscardPitHu）—— 摊了牌就得认
   *   3) **杠上炮：杠后打出的牌，屁胡也能胡**（gangPaoPitHu）
   */
  function canWinOnDiscard(tiles, melds, tile, ctx) {
    var rules = Object.assign({}, DEFAULT_RULES, (ctx && ctx.rules) || {});
    var counts = T.countsOf(tiles);
    if (counts[tile] >= 4) return null;
    counts[tile]++;
    var withTile = T.tilesOfCounts(counts);
    var probe = Object.assign({}, ctx || {}, {
      tiles: withTile, melds: melds, winTile: tile, selfDraw: false, rules: rules
    });
    probe.liangdao = ctx && ctx.liangdao;
    var res = scoreWin(probe);
    if (!res) return null;
    if (rules.pitHuOnlyZimo && res.isPitHu) {
      var allowed =
        (rules.liangdaoPitHuCanDianPao && ctx && ctx.liangdao) ||
        (rules.liangdaoDiscardPitHu && ctx && ctx.fromLiangdao) ||
        (rules.gangPaoPitHu !== false && ctx && ctx.gangPao);
      if (!allowed) return null;
    }
    return res;
  }

  /** 自摸是否和牌 */
  function canWinOnDraw(tiles, melds, tile, ctx) {
    var counts = T.countsOf(tiles);
    if (counts[tile] >= 4) return null;
    counts[tile]++;
    var withTile = T.tilesOfCounts(counts);
    var probe = Object.assign({}, ctx || {}, {
      tiles: withTile, melds: melds, winTile: tile, selfDraw: true
    });
    return scoreWin(probe);
  }

  /* ================= 副露可用性 ================= */

  function canPong(tiles, tile) {
    var n = 0;
    for (var i = 0; i < tiles.length; i++) if (tiles[i] === tile) n++;
    return n >= 2;
  }

  function canAnKongList(tiles) {
    var counts = T.countsOf(tiles);
    var out = [];
    for (var t = 0; t < TT; t++) if (counts[t] === 4) out.push(t);
    return out;
  }

  /** 碰后能否补杠（明杠/蓄杠） */
  function canAddKong(tiles, melds) {
    var out = [];
    for (var i = 0; i < melds.length; i++) {
      var m = melds[i];
      if (m.kind !== 'pong') continue;
      for (var k = 0; k < tiles.length; k++) {
        if (tiles[k] === m.tile) { out.push(m.tile); break; }
      }
    }
    return out;
  }

  /** 手上有暗刻，可以直杠别人打出的牌 */
  function canZhiGang(tiles, tile) {
    var n = 0;
    for (var i = 0; i < tiles.length; i++) if (tiles[i] === tile) n++;
    return n === 3;
  }

  /** 荒庄赔听：听牌者的最大牌型番数 */
  function maxFanForTenpai(tiles, melds, opts) {
    var waits = waitingTiles(tiles, melds);
    if (waits.length === 0) return null;
    var best = null;
    for (var i = 0; i < waits.length; i++) {
      var counts = T.countsOf(tiles);
      counts[waits[i]]++;
      var withTile = T.tilesOfCounts(counts);
      var res = scoreWin(Object.assign({}, opts || {}, {
        tiles: withTile, melds: melds, winTile: waits[i], selfDraw: false
      }));
      if (!res) continue;
      var typeOnly = res.typeFan; // 赔听按牌型番
      if (!best || typeOnly > best.fan) best = { fan: typeOnly, tile: waits[i], result: res };
    }
    return best;
  }

  return {
    DEFAULT_RULES: DEFAULT_RULES,
    canFormSets: canFormSets,
    isWinCounts: isWinCounts,
    sevenPairsInfo: sevenPairsInfo,
    allDecompositions: allDecompositions,
    waitingTiles: waitingTiles,
    isTenpai: isTenpai,
    shanten: shanten,
    standardShanten: standardShanten,
    chiitoiShanten: chiitoiShanten,
    usefulTiles: usefulTiles,
    scoreWin: scoreWin,
    canWinOnDiscard: canWinOnDiscard,
    canWinOnDraw: canWinOnDraw,
    canPong: canPong,
    canAnKongList: canAnKongList,
    canAddKong: canAddKong,
    canZhiGang: canZhiGang,
    maxFanForTenpai: maxFanForTenpai,
    isQingYiSe: isQingYiSe,
    revealTiles: revealTiles,
    revealWorks: revealWorks,
    pairOptions: pairOptions,
    componentsOf: componentsOf,
    standardReveal: standardReveal,
    sevenPairsReveal: sevenPairsReveal
  };
});
