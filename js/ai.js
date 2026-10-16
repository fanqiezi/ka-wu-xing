/*
 * 卡五星麻将 —— 电脑 AI
 *
 * 决策思路：
 *   出牌：枚举每张可打的牌 -> 比较「向听数 -> 有效进张数 -> 孤张程度 -> 危险性」
 *   碰/杠：模拟操作后重新计算向听数，只有不变差才执行（杠还会考虑杠分收益）
 *   亮倒：听牌且剩余和牌张足够多时亮倒（番数 ×2）
 *   胡牌：能胡就胡
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./tiles.js'), require('./rules.js'));
  } else {
    root.KWX = root.KWX || {};
    root.KWX.AI = factory(root.KWX.Tiles, root.KWX.Rules);
  }
})(typeof self !== 'undefined' ? self : this, function (T, R) {
  'use strict';

  var TT = T.TILE_TYPES;

  function distinct(tiles) {
    var seen = {}, out = [];
    for (var i = 0; i < tiles.length; i++) {
      if (!seen[tiles[i]]) { seen[tiles[i]] = 1; out.push(tiles[i]); }
    }
    return out;
  }

  function without(tiles, tile, n) {
    var left = n === undefined ? 1 : n;
    var out = [];
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i] === tile && left > 0) { left--; continue; }
      out.push(tiles[i]);
    }
    return out;
  }

  function sumValues(obj) {
    var s = 0;
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) s += obj[k];
    return s;
  }

  /** 单张牌的「留牌价值」：孤张价值低，搭子/对子价值高 */
  function tileValue(counts, t) {
    if (T.isHonor(t)) return counts[t] >= 2 ? 6 + counts[t] * 2 : 1;
    var suit = T.suitOf(t);
    var rank = T.rankOf(t);
    var v = counts[t] >= 2 ? 6 + counts[t] * 2 : 0;
    for (var d = -2; d <= 2; d++) {
      if (d === 0) continue;
      var r = rank + d;
      if (r < 1 || r > 9) continue;
      var nt = T.suitStart(suit) + r - 1;
      if (counts[nt] > 0) v += (Math.abs(d) === 1 ? 3 : 1.5);
    }
    return v;
  }

  /** 已出现的牌（自己的手牌 + 所有弃牌 + 所有副露），用于算剩余张数 */
  function buildRemain(view) {
    var remain = new Array(TT);
    for (var i = 0; i < TT; i++) remain[i] = 4;
    function mark(t) { if (remain[t] > 0) remain[t]--; }
    view.hand.forEach(mark);
    (view.discards || []).forEach(function (arr) { arr.forEach(mark); });
    (view.meldsByPlayer || []).forEach(function (arr) {
      arr.forEach(function (m) {
        var n = m.kind === 'pong' ? 3 : 4;
        for (var k = 0; k < n; k++) mark(m.tile);
      });
    });
    return remain;
  }

  /**
   * 评估「打掉某张牌之后」的手牌质量
   * @returns {shanten, ukeire, waitCount}
   */
  function evaluateHand(hand13, melds, remain, rules) {
    var s = R.shanten(hand13, melds);
    var score = 0;
    var waitCount = 0;
    if (s === 0) {
      var waits = R.waitingTiles(hand13, melds);
      for (var i = 0; i < waits.length; i++) {
        // 屁胡不能捉炮，只能自摸，但自摸概率与剩余张数一致
        waitCount += remain[waits[i]];
      }
      score = waitCount * 14;
    } else if (s > 0) {
      var useful = R.usefulTiles(hand13, melds, remain);
      score = sumValues(useful) * 9;
    }
    return { shanten: s, score: score, waitCount: waitCount };
  }

  /** 出牌决策；hand 为摸牌后的 14 张（或 3n+2 张）
   *  view.allowed 存在时只在这几张里选（亮倒锁死、或不能打亮倒者的听张） */
  function chooseDiscard(view) {
    var hand = view.hand;
    var melds = view.melds || [];
    var remain = view.remain || buildRemain(view);
    var counts = T.countsOf(hand);
    var options = distinct(hand);
    if (view.allowed) {
      var legal = options.filter(function (t) { return view.allowed.indexOf(t) >= 0; });
      if (legal.length) options = legal;
    }
    var best = null;
    // 对手威胁：越到尾盘、对手副露越多，越可能已经听牌 → 出牌要更保守（降低放铳率）
    var threat = opponentThreat(view);
    var safetyW = 1 + 1.8 * Math.max(0, threat - 0.6);

    for (var i = 0; i < options.length; i++) {
      var t = options[i];
      var rest = without(hand, t, 1);
      var ev = evaluateHand(rest, melds, remain, view.rules);
      // 孤张优先打：留牌价值越低越该打
      var keepValue = tileValue(counts, t);
      // 安全性：牌河里出现过的（现物）、以及已被大量打出的牌更安全
      var seen = 4 - remain[t];
      var safety = seen >= 2 ? 6 : (seen === 1 ? 2 : 0);

      var total = -ev.shanten * 1000 + ev.score - keepValue * 3.2 + safety * safetyW;
      if (view.jitter) total += ((view.rng ? view.rng() : Math.random()) - 0.5) * view.jitter;

      if (!best || total > best.total) {
        best = { tile: t, total: total, ev: ev };
      }
    }
    return best ? best.tile : hand[0];
  }

  /** 打牌前：手上这张刚摸到的牌，若直接打掉后仍是听牌/更优，则判断是否「摸即打」 */
  function bestShantenAfterDiscard(hand, melds, remain) {
    var options = distinct(hand);
    var best = { shanten: 99, score: -1 };
    for (var i = 0; i < options.length; i++) {
      var ev = evaluateHand(without(hand, options[i], 1), melds, remain);
      if (ev.shanten < best.shanten || (ev.shanten === best.shanten && ev.score > best.score)) {
        best = { shanten: ev.shanten, score: ev.score };
      }
    }
    return best;
  }

  /**
   * 是否碰牌
   * hand 为当前 13 张手牌（含待处理的那张不算）
   */
  function shouldPong(view, tile) {
    var hand = view.hand;
    var melds = view.melds || [];
    var remain = view.remain || buildRemain(view);
    var cur = R.shanten(hand, melds);
    var after = without(hand, tile, 2);
    var newMelds = melds.concat([{ kind: 'pong', tile: tile }]);
    var best = bestShantenAfterDiscard(after, newMelds, remain);
    if (best.shanten < cur) return true;
    if (best.shanten > cur) return false;
    // 向听相同：比较进张质量，且已有 3 副副露时慎重（余地小）
    var curEval = evaluateHand(hand, melds, remain);
    if (melds.length >= 3) return false;
    return best.score > curEval.score * 1.05;
  }

  /** 是否直杠（手上三张，别人打出第四张） */
  function shouldZhiGang(view, tile) {
    var hand = view.hand;
    var melds = view.melds || [];
    var cur = R.shanten(hand, melds);
    var after = without(hand, tile, 3);
    var newMelds = melds.concat([{ kind: 'zhigang', tile: tile }]);
    var sAfter = R.shanten(after, newMelds);
    return sAfter <= cur;
  }

  /** 是否暗杠 */
  function shouldAnKong(view, tile) {
    var hand = view.hand;
    var melds = view.melds || [];
    var cur = R.shanten(hand, melds);
    var after = without(hand, tile, 4);
    var newMelds = melds.concat([{ kind: 'ankong', tile: tile }]);
    var sAfter = R.shanten(after, newMelds);
    // 杠分很香（暗杠两家各 2 倍底金），只要不让牌变差就杠
    return sAfter <= cur;
  }

  /** 是否补杠（已碰，手上又有第四张） */
  function shouldAddKong(view, tile) {
    var hand = view.hand;
    var melds = view.melds.map(function (m) {
      return m.kind === 'pong' && m.tile === tile ? { kind: 'mingkong', tile: tile } : m;
    });
    var cur = R.shanten(hand, view.melds || []);
    var after = without(hand, tile, 1);
    var sAfter = R.shanten(after, melds);
    // 补杠有被抢杠的风险，牌型会变差就不杠
    return sAfter <= cur;
  }

  /* ------------------------------------------------------------------ *
   * 亮倒决策：积分制（期望值）模型
   *
   * 亮倒 = 番数翻倍，但要把手牌摊开给所有人看，而且亮倒的人点炮要赔双倍。
   * 把两边都折成「底金」为单位的期望值来算分：
   *
   *   收益 = 2 × p自摸 × 番数
   *          亮倒让赢牌收益翻倍（自摸两家各出一份 → 多拿一份 fan×2）
   *   损失 = (1-衰减) × p被喂炮 × 番数        亮倒后对手会防守，点炮胡的机会大减
   *        + p放铳 × 对手平均番数              亮倒点炮赔双倍 → 多赔一份
   *        + p荒庄 × 番数 × 0.5                荒庄亮倒要赔听
   *
   * 关键点：**收益与自己番数成正比，而放铳的损失取决于对手的番数、跟自己的牌无关**。
   * 所以屁胡（×1）翻倍只多赚一点点，却要承担一样的放铳风险 → 期望值为负，不该亮倒；
   * 清一色/碰碰胡这类高番牌翻倍收益大，才值得摊牌。
   * ------------------------------------------------------------------ */
  var LIANGDAO = {
    // 亮倒期望值模型（单位：底金）。四个核心输入：
    //   ① 剩余抽牌数（turns = 牌墙/3）  ② 胡牌宽度（几种听张）
    //   ③ 剩余和牌张数（还剩几张能摸到） ④ 放铳风险（对手威胁 × 不能弃和）
    // 自摸概率用「1-(1-k/N)^n」算：k=剩余和牌张、N=没看见的牌、n=还能摸几次。
    huangRate: 0.06,        // 荒庄概率
    oppFan: 2.6,            // 别人胡牌时那手牌的平均番数（加算后大胡多，取 2.6）
    huangOppCount: 1.2,     // 荒局时平均有几个听牌对手要赔（亮倒者赔听）
    huangFan: 2.2,          // 赔听时对手的平均牌型番
    riskPerTurn: 0.010,     // 每巡放铳的基础概率（还要乘 threat / 危险放大）
    dangerMul: 1.5,         // 亮倒后不能弃和、必须一直打下去 → 放铳风险放大
    discardRiskMul: 1.5,    // 亮倒后连屁胡都能胡你打出的牌 → 再放大
    feedPerTurn: 0.010,     // 每巡被别人喂炮（点炮胡）的概率
    feedDecay: 0.25,        // 亮倒后点炮胡机会只剩 1/4（对手会防守你的听张）
    maxPDian: 0.45,
    maxQDian: 0.18,
    // 「还能摸几次牌」的有效系数：理论上是 牌墙/3，但实际上对手随时会先胡，
    // 而且亮倒之后自己只能摸打、等于一直在喂牌给别人，本局结束得比理论快得多。
    // 实测：亮倒之后平均只再摸到 2~3 张牌（牌墙 30 左右），所以这里取 0.4 折算。
    turnEfficiency: 0.40,
    // 亮倒门槛：期望值要超过这个数才摊牌（单位：底金）。
    // 这个门槛会被「按牌型的奖惩记忆」缩放：赢过的牌型门槛降低、输过的抬高。
    need: 0.3,
    // 屁胡（牌型无番）额外抬高门槛：输的时候赔的是对手的番、赢得时候只翻自己那 1 倍，
    // 所以现实里「屁胡冒险亮倒」基本不划算 —— 除非听得极宽且牌墙还很厚。
    pitHuNeedMul: 2.0,
    // ---- 奖惩记忆（每种牌型一套）----
    learnUp: 0.30,          // 亮倒后赢了 → 该牌型倾向 +0.30
    learnDown: 0.25,        // 亮倒后输了 → 该牌型倾向 -0.25
    learnMin: 0.35,         // 倾向下限（门槛 ÷ 0.35 ≈ 2.9 倍，很难再亮）
    learnMax: 2.60          // 倾向上限（门槛 ÷ 2.6 ≈ 0.38 倍，更容易亮）
  };

  /** 这手听牌里能胡出的最大牌型番数 + 牌型名（用于奖惩记忆的 key） */
  function bestTypeInfo(hand13, melds, waits, rules) {
    var counts = T.countsOf(hand13);
    var best = { fan: 1, names: [] };
    for (var i = 0; i < waits.length; i++) {
      var w = waits[i];
      if (counts[w] >= 4) continue;
      counts[w]++;
      var res = R.scoreWin({
        tiles: T.tilesOfCounts(counts), melds: melds, winTile: w, selfDraw: true, rules: rules
      });
      counts[w]--;
      if (res && res.typeFan > best.fan) {
        best.fan = res.typeFan;
        best.names = (res.typeItems || []).map(function (it) { return it.name; });
      }
    }
    return best;
  }

  /** 牌型 key：'屁胡' 或 '卡五星+清一色' */
  function typeKeyOfInfo(info) {
    if (!info || !info.names || !info.names.length) return '屁胡';
    return info.names.slice().sort().join('+');
  }

  /**
   * 对手威胁系数（放铳风险）：越到尾盘、对手副露越多，越可能已经听牌
   * 早巡 ≈0.6，尾盘/多副露 ≈1.6~2.0
   */
  function opponentThreat(view) {
    var wall = view.wallCount === undefined ? 30 : view.wallCount;
    var progress = Math.max(0, Math.min(1, 1 - wall / 40));
    var oppMelds = 0;
    (view.meldsByPlayer || []).forEach(function (arr, i) {
      if (i === view.seat) return;
      oppMelds += arr.length;
    });
    return 0.6 + 0.8 * progress + 0.12 * oppMelds;
  }

  /* ---------------- 亮倒奖惩记忆（按牌型） ---------------- */

  function newLearnTable() { return { table: {} }; }

  function learnEntry(table, key) {
    if (!table.table[key]) {
      table.table[key] = { key: key, reveal: 0, win: 0, lose: 0, adj: 1, types: {} };
    }
    return table.table[key];
  }

  /** 该情况当前的倾向系数（1 = 中性；>1 更容易亮，<1 更保守） */
  function learnAdj(table, key) {
    if (!table || !key || !table.table[key]) return 1;
    return table.table[key].adj;
  }

  /**
   * 记一次亮倒结果：**按「当时是什么情况」复盘**，不是只按牌型。
   * 赢了上调这一类情况的倾向、输了下调（有上下限 learnMin ~ learnMax）。
   */
  function noteLiangdaoResult(table, key, won, typeKey) {
    if (!table || !key) return null;
    var e = learnEntry(table, key);
    e.reveal++;
    if (typeKey) e.types[typeKey] = (e.types[typeKey] || 0) + 1;
    if (won) {
      e.win++;
      e.adj = Math.min(LIANGDAO.learnMax, e.adj + LIANGDAO.learnUp);
    } else {
      e.lose++;
      e.adj = Math.max(LIANGDAO.learnMin, e.adj - LIANGDAO.learnDown);
    }
    return e;
  }

  /** 这个情况桶里最常见的牌型（给界面看） */
  function topType(e) {
    var best = '', n = 0;
    for (var k in e.types) {
      if (Object.prototype.hasOwnProperty.call(e.types, k) && e.types[k] > n) { best = k; n = e.types[k]; }
    }
    return best;
  }

  /** 把一次亮倒的「情况」分桶：番数 / 听牌宽度 / 牌山与剩余和牌张 / 放铳风险 */
  function situationKey(plan) {
    var fanB = plan.fan >= 4 ? '番多' : '番少';
    var widthB = (plan.width || 0) >= 3 ? '听宽' : '听窄';
    var wall = plan.wall === undefined ? 30 : plan.wall;
    var scarce = wall <= 12 || (plan.remainWin || 0) <= 3;
    var wallB = scarce ? '牌山少' : '牌山多';
    var riskB = (plan.threat || 0) >= 1 ? '险高' : '险低';
    return fanB + '·' + widthB + '·' + wallB + '·' + riskB;
  }

  /** 情况描述（比 key 更啰嗦，用于日志/调试） */
  function situationLabel(plan) {
    return plan.key + '（' + plan.fan + ' 番 · 听 ' + (plan.width || 0) + ' 种' +
      ' · 剩 ' + (plan.remainWin || 0) + ' 张 · 牌山 ' + (plan.wall === undefined ? '?' : plan.wall) +
      ' · 风险 ' + ((plan.threat || 0) >= 1 ? '高' : '低') + '）';
  }

  /** 记忆表摘要（给界面展示用）：亮倒过的情况，按次数排序 */
  function learnSummary(table) {
    if (!table) return [];
    var out = [];
    for (var k in table.table) {
      if (Object.prototype.hasOwnProperty.call(table.table, k)) {
        var e = table.table[k];
        e.topType = topType(e);
        out.push(e);
      }
    }
    out.sort(function (a, b) { return b.reveal - a.reveal; });
    return out;
  }


  /**
   * 评估所有「打一张就能听牌」的方案，给出期望值评分与推荐
   * @returns null 或 { tile, waits, remainWin, fan, key, score, ... }
   */
  function liangdaoPlan(view) {
    var hand = view.hand;
    var melds = view.melds || [];
    var remain = view.remain || buildRemain(view);
    var rules = view.rules || {};
    var wall = view.wallCount === undefined ? 30 : view.wallCount;
    var plans = [];

    distinct(hand).forEach(function (t) {
      var rest = without(hand, t, 1);
      if (R.shanten(rest, melds) !== 0) return;
      var waits = R.waitingTiles(rest, melds);
      if (!waits.length) return;
      var remainWin = 0;
      for (var i = 0; i < waits.length; i++) remainWin += remain[waits[i]];
      if (remainWin <= 0) return;                 // 听死张（全在别人手里/牌河里），没意义
      var info = bestTypeInfo(rest, melds, waits, rules);
      plans.push({
        tile: t,
        waits: waits,
        width: waits.length,                      // 胡牌宽度
        remainWin: remainWin,                     // 剩余和牌张数
        fan: info.fan,
        key: typeKeyOfInfo(info)                  // 牌型（奖惩记忆用）
      });
    });
    if (!plans.length) return null;

    // ① 剩余抽牌数：每巡牌墙消耗约 3 张（三家各摸一张），再按 turnEfficiency 折算成
    //    「本局结束前我实际还轮得到几次摸牌」
    var turns = Math.max(1, wall / 3) * LIANGDAO.turnEfficiency;
    // ④ 放铳风险：对手威胁（尾盘/副露越多越危险）
    var threat = opponentThreat(view);
    var pDianAll = Math.min(LIANGDAO.maxPDian, LIANGDAO.riskPerTurn * turns * threat);
    var payMul = rules.liangdaoPayDouble !== false ? 2 : 1;
    var openMul = rules.liangdaoDiscardPitHu === false ? 1 : LIANGDAO.discardRiskMul;
    var pOtherWin = LIANGDAO.huangRate;           // 荒庄概率（下面每手再补）

    var seen = 0;
    for (var s = 0; s < remain.length; s++) seen += remain[s];
    var unseen = Math.max(1, seen);               // 没看见的牌 = 牌墙 + 对手手牌

    plans.forEach(function (p) {
      // ②③ 自摸概率：剩余和牌张 / 没看见的牌，重复 turns 次
      var pOne = Math.min(0.95, p.remainWin / unseen);
      var qZimo = 1 - Math.pow(1 - pOne, turns);
      // 亮倒后别人会防守你的听张 → 点炮胡的机会很小（屁胡也只能指望这一点）
      var qDian = Math.min(LIANGDAO.maxQDian,
        LIANGDAO.feedPerTurn * turns * LIANGDAO.feedDecay * threat);
      var pOther = Math.max(0, 1 - qZimo - LIANGDAO.huangRate);

      // 收益：亮倒后胡牌金额整体翻倍（自摸 = 两家都多付一份，点炮 = 点炮者多付一份）
      var gain = qZimo * 2 * p.fan + qDian * 1 * p.fan;
      // 损失①放铳：亮倒后不能弃和（只能摸打）+ 连屁胡都能胡你的弃牌 + 赔付翻倍
      var dianLoss = pDianAll * LIANGDAO.oppFan * (payMul * LIANGDAO.dangerMul * openMul - 1);
      // 损失②别人自摸/胡牌：亮倒者输钱一律翻倍 → 每个失局都多付一份
      var otherLoss = pOther * LIANGDAO.oppFan * (payMul - 1) / 2;
      // 损失③荒局：亮倒者哪怕自己听牌，也要赔给每个听牌对手「底金 × 对方牌型番」
      var huangLoss = rules.liangdaoHuangPei === false
        ? 0
        : LIANGDAO.huangRate * LIANGDAO.huangFan * LIANGDAO.huangOppCount;

      p.turns = turns;
      p.threat = threat;
      p.wall = wall;
      p.pSelfDraw = qZimo;
      p.pDianPao = qDian;
      p.pDian = pDianAll;
      p.gain = gain;
      p.dianLoss = dianLoss;
      p.otherLoss = otherLoss;
      p.huangLoss = huangLoss;
      p.score = gain - dianLoss - otherLoss - huangLoss;
    });

    plans.sort(function (a, b) { return b.score - a.score; });
    // 给推荐方案打上「情况」标签：奖惩记忆按它复盘（番数/听宽/牌山剩张/风险）
    plans[0].sitKey = situationKey(plans[0]);
    plans[0].sitLabel = situationLabel(plans[0]);
    return plans[0];
  }

  /**
   * 亮倒决策：期望值要超过「门槛 ÷ 这类情况的奖惩倾向」才摊牌
   * 情况 = 番数档 · 听牌宽度 · 牌山与剩余和牌张 · 放铳风险（不是只看牌型）
   * （屁胡无番，门槛还要再乘 pitHuNeedMul）
   * @returns { plan, need, adj, sitKey, score, yes }
   */
  function liangdaoDecision(view) {
    var plan = liangdaoPlan(view);
    if (!plan) return null;
    var sitKey = plan.sitKey || plan.key;
    var adj = learnAdj(view.liangdaoLearn, sitKey);
    var need = LIANGDAO.need / (adj || 1);
    if (plan.fan === 1) need *= LIANGDAO.pitHuNeedMul;
    return { plan: plan, need: need, adj: adj, sitKey: sitKey, score: plan.score, yes: plan.score > need };
  }

  /** 是否亮倒 */
  function shouldLiangdao(view) {
    if (!view.rules || view.rules.liangdaoEnabled === false) return false;
    var d = liangdaoDecision(view);
    return !!(d && d.yes);
  }

  /**
   * 面对别人打出的牌做决定
   * @returns {{action:string}} 'hu' | 'kong' | 'pong' | 'pass'
   */
  function claimDecision(view, opt) {
    if (opt.canHu) return { action: 'hu' };
    if (opt.canZhiGang && shouldZhiGang(view, opt.tile)) return { action: 'kong' };
    if (opt.canPong && shouldPong(view, opt.tile)) return { action: 'pong' };
    return { action: 'pass' };
  }

  return {
    chooseDiscard: chooseDiscard,
    claimDecision: claimDecision,
    shouldPong: shouldPong,
    shouldZhiGang: shouldZhiGang,
    shouldAnKong: shouldAnKong,
    shouldAddKong: shouldAddKong,
    shouldLiangdao: shouldLiangdao,
    liangdaoPlan: liangdaoPlan,
    liangdaoDecision: liangdaoDecision,
    newLearnTable: newLearnTable,
    learnAdj: learnAdj,
    learnSummary: learnSummary,
    noteLiangdaoResult: noteLiangdaoResult,
    situationKey: situationKey,
    situationLabel: situationLabel,
    typeKeyOfInfo: typeKeyOfInfo,
    bestTypeInfo: bestTypeInfo,
    opponentThreat: opponentThreat,
    LIANGDAO: LIANGDAO,
    buildRemain: buildRemain,
    tileValue: tileValue,
    evaluateHand: evaluateHand
  };
});
