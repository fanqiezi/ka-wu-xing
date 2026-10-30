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

  /* ------------------------------------------------------------------ *
   * 难度档：同一套算法 + 一张权重表（不是三份 AI）
   *
   *   normal  普通：牌效 + 粗防守（现物/断张），亮倒只算 EV / 轮次 / 听牌枚数
   *   hard    困难：2 层评估（打出后看下一巡进张与危险度）、逐张危险度、
   *                 对手威胁否决亮倒、杠的破坏性权衡、临界值混策
   *   growth  成长型：困难 + 只学「人类玩家」的公开行为，记忆跨对局/跨刷新
   *
   * 普通档的权重 = 历史默认值，保证行为与旧版逐位一致（旧测试全部不变）。
   * ------------------------------------------------------------------ */
  var NORMAL_PROFILE = {
    key: 'normal', label: '普通',
    jitter: 6,              // 决策噪声（越大越随意）
    safetyThreatK: 1.8,     // 对手威胁对「安全分」的放大量
    safetySeen2: 6,         // 牌河已见 2 张以上的安全分
    safetySeen1: 2,
    keepValueW: 3.2,        // 留牌价值权重（越大越爱切孤张）
    pongScoreMul: 1.05,     // 碰牌的进张质量门槛（相对当前手牌）
    pongMaxMelds: 3,        // 已有几副副露就不再碰
    liangdaoNeedMul: 1.0,   // 亮倒门槛倍数
    pitHuNeedMul: 2.0,      // 屁胡亮倒的额外门槛
    threatVeto: false,      // 对手明显已听 → 否决亮倒
    threatAt: 1.40,         // 「明显已听」的威胁阈值
    threatNeedMul: 1.6,     // 否决时把门槛抬高的倍数
    lookahead: 1,           // 前瞻层数（P2 起 hard 用 2）
    fanBias: 0,             // 番型倾向（0 = 只看牌效；>0 才开始为番型留牌）
    fanBiasKawuxing: 0,     // 只偏好「卡五」听口（胡 5筒/5条 嵌张）
    fanBiasQingyise: 0,     // 只偏好清一色
    fanBiasQidui: 0,        // 只偏好七对
    // ---- 困难档才用的评分项（普通档全部为 0 / false，行为与旧版一致）----
    dangerW: 0,             // 切出去这张牌的危险度权重
    leftRiskW: 0,           // 「剩下的牌之后好不好打」的权重（第 2 层）
    waitQualityW: 0,        // 听牌质量（几面听）权重
    retreat: false,         // 尾盘允许退向听防守
    retreatThreat: 1.45,    // 触发退向听的对手威胁阈值
    retreatWall: 14,        // 触发退向听的剩余牌山
    retreatShantenW: 220,   // 退向听模式下「1 向听」的代价（正常 1000）
    dangerHigh: 0.72,       // 「这张太危险了」阈值（退向听触发）
    dangerLow: 0.28,        // 「这张够安全」阈值（退向听候选）
    kongTradeoff: false,    // 杠之前算「破坏损失 vs 杠分收益」
    kongPayForShanten: 3,   // 1 个向听值几个底金的杠分
    kongWaitTol: 0.35,      // 同向听时，听口最多缩水多少
    mixBand: 0,             // 亮倒临界混合带（±比例），0 = 不用混合策略
    mixProb: 0.35,          // 带内选择不亮的概率
    // ---- 做牌计划层（困难/成长档）----
    plan: false,            // 是否启用计划层
    planEnter: 1.6,         // 开计划的门槛（单位：番）
    planExit: 0.7,          // 放弃门槛（迟滞，比 planEnter 低）
    planStallLimit: 3,      // 连续几巡没进展就休眠
    planDormantGap: 0.15,   // 休眠后要恢复到「比放弃时好这么多」才重新捡起来
    planCostPerTurn: 1.1,   // 每牺牲一巡牌效值几番
    planAbandonThreat: 1.55,// 对手威胁超过这个就放弃追番
    planBiasW: 110,         // 计划对打牌评分的偏置强度
    learn: false            // 是否启用「学人类」的记忆（P3）
  };

  var DIFFICULTY = {
    normal: NORMAL_PROFILE,
    // 困难：少一点随机、会挑好形听牌、轻量避铳；对手明显已听时略抬亮倒门槛。
    // 参数是拿「座位0 对两家普通档」的 300 局自对弈标定的：平均分 +56 vs 普通档 +20。
    // 教训：**大面积防守会掉分**（三人局里别人互放铳的收益被你让掉了），
    //       真正涨分的是「听牌质量」（多面听 / 别留死听）＋ 只在危险时才避铳。
    hard: Object.assign({}, NORMAL_PROFILE, {
      key: 'hard', label: '困难',
      jitter: 2,
      safetyThreatK: 2.6,
      safetySeen2: 8,
      safetySeen1: 3,
      pongScoreMul: 1.0,
      liangdaoNeedMul: 1.0,
      threatVeto: true,
      threatNeedMul: 1.15,        // 轻度否决：只在对手明显已听时略抬门槛
      lookahead: 2,
      dangerW: 40,                // 轻量避铳（大了会明显掉分）
      leftRiskW: 20,
      waitQualityW: 90,           // 主要涨分项：优先留好形听牌
      fanBiasKawuxing: 60,        // 只偏好「卡五」听口（实测：卡五成牌 ×3，平均分不降）
      fanBias: 0,                 // 番型倾向（按 A/B 标定填）
      retreat: true,              // 退向听只在极端局面（见下面阈值）
      retreatWall: 6,
      dangerHigh: 0.85,
      dangerLow: 0.25,
      kongTradeoff: true,
      mixBand: 0.10,
      plan: true,                 // 做牌计划层：会立目标番型、也会放弃和重新捡起来
      planBiasW: 60               // 计划对留牌的偏置（保守值：宁可不赚，也不拖垮牌效）
    }),
    // 成长型：困难 + 记忆（记忆内容在 P3 落地，这里先把开关和档位准备好）
    growth: Object.assign({}, NORMAL_PROFILE, {
      key: 'growth', label: '成长型',
      jitter: 2,
      safetyThreatK: 2.8,
      safetySeen2: 8,
      safetySeen1: 3,
      pongScoreMul: 1.0,
      liangdaoNeedMul: 1.0,
      threatVeto: true,
      threatNeedMul: 1.15,
      lookahead: 2,
      dangerW: 50,
      leftRiskW: 25,
      waitQualityW: 100,
      fanBiasKawuxing: 60,
      fanBias: 0,
      retreat: true,
      retreatWall: 6,
      dangerHigh: 0.85,
      dangerLow: 0.25,
      kongTradeoff: true,
      mixBand: 0.12,
      plan: true,
      planBiasW: 70,
      learn: true
    })
  };

  var DIFFICULTY_LIST = [
    { key: 'normal', label: '普通' },
    { key: 'hard', label: '困难' },
    { key: 'growth', label: '成长型（会学习）' }
  ];

  /** 取难度档（未知名字一律回到普通） */
  function profileOf(name) {
    return DIFFICULTY[name] || DIFFICULTY.normal;
  }

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
   * @returns {shanten, ukeire, waitCount, waits, shape}
   *   shape：听牌质量 0~1（几面听；单吊/嵌张偏低）
   */
  function evaluateHand(hand13, melds, remain, rules) {
    var s = R.shanten(hand13, melds);
    var score = 0;
    var waitCount = 0;
    var waits = null;
    var shape = 0;
    if (s === 0) {
      waits = R.waitingTiles(hand13, melds);
      for (var i = 0; i < waits.length; i++) {
        // 屁胡不能捉炮，只能自摸，但自摸概率与剩余张数一致
        waitCount += remain[waits[i]];
      }
      score = waitCount * 14;
      // 听几面：3 面以上 1.0、两面 0.6、单吊/嵌张 0.25
      shape = waits.length >= 3 ? 1 : (waits.length === 2 ? 0.6 : 0.25);
    } else if (s > 0) {
      var useful = R.usefulTiles(hand13, melds, remain);
      score = sumValues(useful) * 9;
    }
    return { shanten: s, score: score, waitCount: waitCount, waits: waits, shape: shape };
  }

  /* ------------------------------------------------------------------ *
   * 逐张危险度（公开信息推断，0 = 极安全、1 = 极危险）
   *
   * 只用「所有人都能看到的东西」：牌河、副露、牌墙剩余。
   * 判断依据（按可靠性排序）：
   *   1) 现物：这张牌在任一对手的牌河里出现过 → 没人会点炮给它
   *   2) 绝张：四张全可见 → 不可能被等
   *   3) 中张 vs 端张：3~7 比 1/9 更容易被两面/嵌张利用
   *   4) 对手花色倾向：某个对手几乎不打某花色 → 他大概率在等这门
   *   5) 副露越多 / 牌墙越少 → 对手越可能已经听牌，整体放大
   * ------------------------------------------------------------------ */
  function dangerOf(view, tile) {
    var remain = view.remain || buildRemain(view);
    var discards = view.discards || [[], [], []];
    var meldsByPlayer = view.meldsByPlayer || [[], [], []];
    var seat = view.seat === undefined ? -1 : view.seat;
    var seen = 4 - remain[tile];
    if (seen >= 4) return 0.02;                       // 绝张：不可能被等

    var oppDisc = [];
    var oppMelds = 0;
    for (var i = 0; i < 3; i++) {
      if (i === seat) continue;
      oppDisc = oppDisc.concat(discards[i] || []);
      oppMelds += (meldsByPlayer[i] || []).length;
    }
    // 现物
    for (var k = 0; k < oppDisc.length; k++) if (oppDisc[k] === tile) return 0.03;

    var d;
    if (T.isHonor(tile)) {
      // 字牌：见 2 张以上基本安全，1 张中等，0 张偏危险（别人可能在等对子/刻子）
      d = seen >= 2 ? 0.06 : (seen === 1 ? 0.26 : 0.42);
    } else {
      var rank = T.rankOf(tile);
      d = 0.42;
      if (rank >= 3 && rank <= 7) d += 0.16;          // 中张更容易被利用
      else if (rank === 1 || rank === 9) d -= 0.10;   // 端张安全一点
      if (seen >= 2) d -= 0.10;
      // 花色倾向：对手在这门打得越少，越可能在等这门
      var suit = T.suitOf(tile);
      var sameDisc = 0, otherDisc = 0;
      for (var q = 0; q < oppDisc.length; q++) {
        var od = oppDisc[q];
        if (T.isHonor(od)) continue;
        if (T.suitOf(od) === suit) sameDisc++; else otherDisc++;
      }
      if (otherDisc >= 4 && sameDisc === 0) d += 0.12;      // 对手明显不要别的门
      else if (sameDisc >= 6) d -= 0.12;                    // 对手一直在打这门
    }
    // 对手副露多 / 牌墙见底 → 更可能已经听牌，整体放大
    var wall = view.wallCount === undefined ? 30 : view.wallCount;
    var progress = Math.max(0, Math.min(1, 1 - wall / 40));
    d *= (1 + 0.18 * oppMelds) * (1 + 0.35 * progress);
    return Math.max(0, Math.min(1, d));
  }

  /** 手上剩下这些牌（之后还要打出去的）平均有多危险 —— 「这一张安全，但后面难打」的代价 */
  function leftoverDanger(view, tiles) {
    if (!tiles.length) return 0;
    var seen = {}, sum = 0, n = 0;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (seen[t]) continue;
      seen[t] = 1;
      sum += dangerOf(view, t);
      n++;
    }
    return n ? sum / n : 0;
  }

  /* ------------------------------------------------------------------ *
   * 番型潜力（只有困难/成长档用）：这手牌「往大了做」值多少番
   *
   * 听牌时直接算真实的最大番（复用亮倒用的 bestTypeInfo，1~3 个听张，成本可控）；
   * 没听时用便宜代理：清一色进度 / 七对进度 / 对子密度，估个等效番。
   * 注意：这不改变「是不是屁胡」的判定，只是给留牌多加一项偏好。
   * ------------------------------------------------------------------ */
  function fanPotential(hand13, melds, remain, rules) {
    var waits = R.waitingTiles(hand13, melds);
    if (waits.length) {
      var info = bestTypeInfo(hand13, melds, waits, rules);
      return {
        fan: Math.max(1, Math.min(info.fan || 1, 16)),
        names: (info.names || []).slice()
      };
    }
    // 未听：代理值
    var counts = T.countsOf(hand13);
    var total = hand13.length || 1;
    var suitCount = [0, 0, 0], honors = 0, pairs = 0, triples = 0;
    for (var t = 0; t < TT; t++) {
      var c = counts[t];
      if (!c) continue;
      if (T.isHonor(t)) honors += c;
      else suitCount[T.suitOf(t)] += c;
      if (c >= 2) pairs++;
      if (c >= 3) triples++;
    }
    (melds || []).forEach(function (m) {
      if (T.isHonor(m.tile)) honors += 3;
      else suitCount[T.suitOf(m.tile)] += 3;
      triples++;
    });
    var maxSuit = Math.max(suitCount[0], suitCount[1], suitCount[2]);
    var qingyise = maxSuit / total;                     // 0~1
    var qidui = Math.min(1, pairs / 7);                 // 0~1
    var pengpeng = Math.min(1, (triples + pairs * 0.4) / 4);
    var honorPenalty = honors > 0 ? 0 : 1;              // 没字牌才可能是清一色
    var proxyNames = [];
    if (qingyise >= 0.8 && honorPenalty === 0) proxyNames.push('清一色');
    if (qidui >= 0.6) proxyNames.push('七对');
    if (pengpeng >= 0.6) proxyNames.push('碰碰胡');
    return {
      fan: 1 + 4 * Math.pow(qingyise * (0.35 + 0.65 * honorPenalty), 2) +
        3 * qidui * qidui + 2 * pengpeng,
      names: proxyNames
    };
  }

  /* ------------------------------------------------------------------ *
   * 做牌计划层（困难 / 成长档）
   *
   * 人类不是「给番型加个分」，而是：起手读结构 → 立一个目标番型 →
   * 每巡看进张 / 对手弃牌 / 牌山余量 / 威胁 → 该弃就弃、条件回来再捡起来。
   *
   * 这里把这件事落成一个小状态机（状态存在 Game 里，按座位一份）：
   *   state = { key, name, at, progress, stall, dormant: {key: {progress, at}} }
   *
   * 每巡：① 给每个候选番型算 ready（离做成多近）和 cost（要牺牲几巡牌效）
   *       ② ev = 番数 × ready − cost × planCostPerTurn（单位：番）
   *       ③ 迟滞：进入要 ev ≥ planEnter、退出要 ev < planExit（防摇摆）
   *       ④ 连续 planStallLimit 巡没进展 / 威胁太大 → 休眠（不是删除）
   *       ⑤ 休眠的番型，progress 涨回来 ≥ dormantGap → 允许重新激活
   * ------------------------------------------------------------------ */

  var PLAN_DEFS = [
    { key: 'qingyise', name: '清一色', fan: 4 },
    { key: 'qidui', name: '七对', fan: 4 },
    { key: 'longqidui', name: '龙七对', fan: 8 },
    { key: 'pengpeng', name: '碰碰胡', fan: 2 },
    { key: 'dasanyuan', name: '大三元', fan: 8 },
    { key: 'xiaosanyuan', name: '小三元', fan: 4 },
    { key: 'sigui', name: '四归一', fan: 2 },
    { key: 'shouzhuayi', name: '手抓一', fan: 4 }
  ];

  var DRAGONS = [18, 19, 20];   // 中 / 发 / 白

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /** 手牌 + 副露的统计（计划评估用，O(21)） */
  function handStats(hand, melds) {
    var counts = T.countsOf(hand);
    var per = [0, 0, 0], honors = 0, pairs = 0, triplets = 0, quads = 0, singles = 0;
    var dragonTriplets = 0, dragonPairs = 0, dragonCount = 0;
    for (var t = 0; t < TT; t++) {
      var c = counts[t];
      if (!c) continue;
      if (T.isHonor(t)) {
        honors += c;
        if (DRAGONS.indexOf(t) >= 0) dragonCount += c;
      } else per[T.suitOf(t)] += c;
      if (c === 1) singles++;
      if (c === 2) pairs++;
      if (c >= 3) triplets++;
      if (c >= 4) quads++;
    }
    (melds || []).forEach(function (m) {
      if (T.isHonor(m.tile)) {
        honors += 3;
        if (DRAGONS.indexOf(m.tile) >= 0) dragonCount += 3;
      } else per[T.suitOf(m.tile)] += 3;
      if (m.kind === 'pong') { triplets++; pairs += 0; }
      else { triplets++; quads += 0; }
    });
    // 字牌里的三元统计要单独算（副露里碰的中发白也算刻子）
    DRAGONS.forEach(function (d) {
      var inHand = counts[d] || 0;
      var ponged = (melds || []).some(function (m) { return m.tile === d && (m.kind === 'pong' || m.kind === 'mingkong' || m.kind === 'ankong' || m.kind === 'zhigang'); });
      if (ponged || inHand >= 3) dragonTriplets++;
      else if (inHand === 2) dragonPairs++;
    });
    var total = hand.length + (melds || []).reduce(function (s, m) { return s + (m.kind === 'pong' ? 3 : 4); }, 0);
    return {
      counts: counts, per: per, honors: honors, pairs: pairs, triplets: triplets,
      quads: quads, singles: singles, total: total,
      dragonTriplets: dragonTriplets, dragonPairs: dragonPairs, dragonCount: dragonCount,
      maxSuit: Math.max(per[0], per[1], per[2])
    };
  }

  /** 「四归一」进度：手上已有三张同牌（再来一张就是暗四归一），或已碰 + 手上还有一张 */
  function siguiProgress(hand, melds, counts) {
    var best = 0;
    for (var t = 0; t < TT; t++) {
      if (counts[t] >= 3) best = Math.max(best, 0.85);
      else if (counts[t] >= 1 && (melds || []).some(function (m) {
        return m.tile === t && (m.kind === 'pong' || m.kind === 'mingkong');
      })) best = Math.max(best, 0.7);
    }
    return best;
  }

  /**
   * 给每个番型算「离做成多近 / 要牺牲多少」
   * @returns {Array<{key,name,fan,ready,cost,infeasible}>}
   */
  function planCandidates(view) {
    var hand = view.hand;
    var melds = view.melds || [];
    var st = handStats(hand, melds);
    var total = Math.max(1, st.total);
    var out = [];

    // 清一色：同门张数越多越近；字牌是减分项（字牌只能当将/刻子，凑不进清一色）
    var qingReady = clamp01((st.maxSuit - 8) / 4) * (1 - Math.min(0.5, st.honors * 0.12));
    out.push({
      key: 'qingyise', name: '清一色', fan: 4,
      ready: qingReady, cost: Math.max(0, total - st.maxSuit) / 2,
      infeasible: (total - st.maxSuit) > 5
    });

    // 七对 / 龙七对：不能有副露；对子越多越近（4 对 0.4、5 对 0.6、6 对 0.8、7 对 1.0）
    var noMelds = melds.length === 0;
    var pairsReady = clamp01((st.pairs - 2) / 5);
    out.push({
      key: 'qidui', name: '七对', fan: 4,
      ready: noMelds ? pairsReady : 0, cost: Math.max(0, 7 - st.pairs) / 2,
      infeasible: !noMelds || st.pairs < 4
    });
    if (noMelds) {
      out.push({
        key: 'longqidui', name: '龙七对', fan: 8,
        ready: st.quads > 0 ? clamp01((st.pairs - 2) / 5) : 0,
        cost: Math.max(0, 7 - st.pairs) / 2,
        infeasible: st.quads === 0 || st.pairs < 5
      });
    }

    // 碰碰胡：刻子 + 对子多、顺子少
    var pengReady = clamp01((st.triplets + st.pairs * 0.5 - 1) / 3);
    out.push({
      key: 'pengpeng', name: '碰碰胡', fan: 2,
      ready: pengReady, cost: Math.max(0, 4 - st.triplets - st.pairs * 0.5) / 2,
      infeasible: pengReady <= 0.01
    });

    // 大三元 / 小三元：三元牌刻子/对子
    var bigReady = clamp01((st.dragonTriplets - 1) / 2);
    var smallReady = clamp01((st.dragonTriplets + st.dragonPairs * 0.6 - 1) / 2);
    out.push({
      key: 'dasanyuan', name: '大三元', fan: 8,
      ready: bigReady, cost: Math.max(0, 3 - st.dragonTriplets) * 0.9,
      infeasible: st.dragonTriplets < 1
    });
    out.push({
      key: 'xiaosanyuan', name: '小三元', fan: 4,
      ready: smallReady, cost: Math.max(0, 3 - st.dragonTriplets - st.dragonPairs) * 0.8,
      infeasible: st.dragonTriplets + st.dragonPairs < 2
    });

    // 四归一 / 手抓一（都是顺带的，权重低）
    out.push({
      key: 'sigui', name: '四归一', fan: 2,
      ready: siguiProgress(hand, melds, st.counts), cost: 0.4,
      infeasible: siguiProgress(hand, melds, st.counts) <= 0
    });
    out.push({
      key: 'shouzhuayi', name: '手抓一', fan: 4,
      ready: clamp01((st.triplets + melds.length - 3) / 1),
      cost: 0.6, infeasible: (st.triplets + melds.length) < 3
    });

    return out;
  }

  /** 计划对「打这张牌」的偏好：打掉计划外的牌加分，留计划要的牌（返回 -1~+1） */
  function planTileBias(plan, view, tile) {
    if (!plan) return 0;
    var hand = view.hand, melds = view.melds || [];
    var counts = T.countsOf(hand);
    var c = counts[tile] || 0;
    var honor = T.isHonor(tile);
    if (plan.key === 'qingyise') {
      var per = [0, 0, 0];
      for (var t = 0; t < TT; t++) {
        var cc = counts[t];
        if (!cc || T.isHonor(t)) continue;
        per[T.suitOf(t)] += cc;
      }
      var best = Math.max(per[0], per[1], per[2]);
      var bestSuit = per.indexOf(best);
      if (honor) return 0.7;
      return T.suitOf(tile) === bestSuit ? -0.8 : 0.9;
    }
    if (plan.key === 'qidui' || plan.key === 'longqidui') {
      if (c >= 2) return -1.0;       // 对子留着
      return 0.9;                    // 单张打掉，去凑对子
    }
    if (plan.key === 'pengpeng') {
      if (c >= 2) return -0.9;       // 对子/刻子留着
      // 顺子里的中张更容易被拆，优先打端张和孤张
      return T.isHonor(tile) ? 0.2 : 0.6;
    }
    if (plan.key === 'dasanyuan' || plan.key === 'xiaosanyuan') {
      if (DRAGONS.indexOf(tile) >= 0) return -1.5;   // 三元牌绝对留着
      return honor ? 0.4 : 0.7;
    }
    if (plan.key === 'sigui') {
      return c >= 3 ? -1.5 : (c === 0 ? 0 : 0.3);
    }
    if (plan.key === 'shouzhuayi') {
      return c >= 2 ? -0.5 : 0.4;
    }
    return 0;
  }

  /**
   * 每巡更新计划（在出牌前调用一次）
   * @returns {{plan: object|null, state: object, events: Array}}
   *   events: [{type:'enter'|'abandon'|'reenter'|'switch', key, name, why}]
   */
  function updatePlan(view) {
    var p = profileOf(view.diff);
    var state = view.planState || null;
    var events = [];
    if (!p.plan) return { plan: null, state: null, events: events };
    if (!state) state = { key: null, name: null, at: 0, progress: 0, stall: 0, dormant: {}, lastTurn: -1 };

    var turn = (view.wallCount === undefined ? 30 : (40 - view.wallCount));
    if (state.lastTurn === turn) return { plan: state.key ? state : null, state: state, events: events };
    state.lastTurn = turn;

    var threat = opponentThreat(view);
    var cands = planCandidates(view);
    var cur = null, best = null, bestEv = -999;
    cands.forEach(function (c) {
      if (c.infeasible) return;
      var ev = c.fan * c.ready - c.cost * p.planCostPerTurn;
      c.ev = ev;
      if (c.key === (state.key || '')) cur = c;
      if (ev > bestEv) { bestEv = ev; best = c; }
    });

    function enterKey(c, why) {
      events.push({ type: state.key ? 'switch' : 'enter', key: c.key, name: c.name, why: why });
      state.key = c.key;
      state.name = c.name;
      state.at = turn;
      state.progress = c.ready;
      state.stall = 0;
    }
    function abandonKey(why) {
      if (!state.key) return;
      state.dormant[state.key] = { progress: state.progress, at: turn };
      events.push({ type: 'abandon', key: state.key, name: state.name, why: why });
      state.key = null;
      state.name = null;
      state.stall = 0;
      state.blockedTurn = turn;     // 同一巡内不再立刻重新立计划（避免抖动）
    }

    if (state.key) {
      // 已有计划：看进展、看威胁、看是否还值得
      var progress = cur ? cur.ready : 0;
      if (cur && !cur.infeasible) {
        if (progress > state.progress + 0.02) { state.progress = progress; state.stall = 0; }
        else state.stall++;
      } else {
        abandonKey('已经不可能了');
      }
      var evNow = cur ? cur.ev : -999;
      if (state.key) {
        if (evNow < p.planExit) abandonKey('不值了');
        else if (state.stall >= p.planStallLimit) abandonKey('连续 ' + state.stall + ' 巡没进展');
        else if (threat >= p.planAbandonThreat) abandonKey('对手威胁太大');
      }
    }

    // 没计划（或刚放弃）：看看有没有值得开的；包括「休眠过的番型重新激活」
    if (!state.key && best && bestEv >= p.planEnter && state.blockedTurn !== turn) {
      var dom = state.dormant[best.key];
      if (dom && best.ready < dom.progress + p.planDormantGap) {
        // 还没恢复到能重新捡起来的程度 → 不激活
      } else {
        if (dom) {
          events.push({ type: 'reenter', key: best.key, name: best.name, why: '条件恢复了' });
          delete state.dormant[best.key];
        }
        enterKey(best, 'EV ' + bestEv.toFixed(1));
      }
    }
    // 休眠记录慢慢过期（牌山快没了就别再惦记）
    Object.keys(state.dormant).forEach(function (k) {
      if (turn - state.dormant[k].at > 6) delete state.dormant[k];
    });

    var plan = null;
    if (state.key) {
      plan = { key: state.key, name: state.name, at: state.at, progress: state.progress };
    }
    return { plan: plan, state: state, events: events };
  }

  /** 出牌决策；hand 为摸牌后的 14 张（或 3n+2 张）
   *  view.allowed 存在时只在这几张里选（亮倒锁死、或不能打亮倒者的听张） */
  function chooseDiscard(view) {
    var hand = view.hand;
    var melds = view.melds || [];
    var remain = view.remain || buildRemain(view);
    var counts = T.countsOf(hand);
    var p = profileOf(view.diff);
    var options = distinct(hand);
    if (view.allowed) {
      var legal = options.filter(function (t) { return view.allowed.indexOf(t) >= 0; });
      if (legal.length) options = legal;
    }
    var best = null;
    var scored = [];
    // 对手威胁：越到尾盘、对手副露越多，越可能已经听牌 → 出牌要更保守（降低放铳率）
    var threat = opponentThreat(view);
    var safetyW = 1 + p.safetyThreatK * Math.max(0, threat - 0.6);
    // 成长型：按「人类画像」调整（只学公开行为；置信度低时几乎不生效）
    var hm = p.learn ? view.humanModel : null;
    var hmConf = hm ? (hm.confidence || 0) : 0;
    var hmAgg = hm ? (hm.aggression || 0) : 0;
    var hmHot = {};
    if (hm && hm.hot) hm.hot.slice(0, 3).forEach(function (x) { hmHot[x.tile] = 1; });
    var dangerMul = 1 + 0.35 * hmAgg * hmConf;      // 对激进人类更谨慎
    var jitter = view.jitter === undefined ? p.jitter : view.jitter;
    // 退向听防守：尾盘 + 对手威胁大时，宁可多一向听也要打安全牌
    var shantenW = 1000;
    var wall = view.wallCount === undefined ? 30 : view.wallCount;
    if (p.retreat && threat >= p.retreatThreat && wall <= p.retreatWall) {
      shantenW = p.retreatShantenW;
    }

    // 做牌计划（困难/成长档）：目标番型由 game 每巡更新后放在 view.plan 里
    var plan = view.plan || null;

    for (var i = 0; i < options.length; i++) {
      var t = options[i];
      var rest = without(hand, t, 1);
      var ev = evaluateHand(rest, melds, remain, view.rules);
      // 孤张优先打：留牌价值越低越该打
      var keepValue = tileValue(counts, t);
      // 安全性：牌河里出现过的（现物）、以及已被大量打出的牌更安全
      var seen = 4 - remain[t];
      var safety = seen >= 2 ? p.safetySeen2 : (seen === 1 ? p.safetySeen1 : 0);

      var total = -ev.shanten * shantenW + ev.score - keepValue * p.keepValueW + safety * safetyW;
      if (p.dangerW) total -= dangerOf(view, t) * p.dangerW * dangerMul;  // 这张牌有多危险
      if (p.leftRiskW) total -= leftoverDanger(view, rest) * p.leftRiskW * dangerMul;
      if (p.waitQualityW && ev.shape) total += ev.shape * p.waitQualityW; // 听牌质量（几面听）
      if (hmHot[t]) total -= 70 * hmConf;                                // 他常胡这张 → 更不想切
      if (plan && p.planBiasW) total += planTileBias(plan, view, t) * p.planBiasW; // 为计划留牌
      if (jitter) total += ((view.rng ? view.rng() : Math.random()) - 0.5) * jitter;

      if (!best || total > best.total) {
        best = { tile: t, total: total, ev: ev };
      }
      scored.push({
        tile: t, total: total, ev: ev, rest: rest,
        danger: (p.dangerW || p.retreat) ? dangerOf(view, t) : 0
      });    }

    // 番型倾向（困难/成长档）：只对排名靠前的几张算真实番，避免每张都跑 scoreWin
    if (best && (p.fanBias || p.fanBiasKawuxing || p.fanBiasQingyise || p.fanBiasQidui)) {
      scored.sort(function (a, b) { return b.total - a.total; });
      var topN = Math.min(3, scored.length);
      var bestFan = null;
      for (var fi = 0; fi < topN; fi++) {
        var fc = scored[fi];
        var fp = fanPotential(fc.rest, melds, remain, view.rules);
        var bonus = (fp.fan - 1) * p.fanBias;      // 屁胡（1 番）不加成，够大才值得等
        var nm = fp.names || [];
        if (p.fanBiasKawuxing && nm.indexOf('卡五星') >= 0) bonus += p.fanBiasKawuxing;
        if (p.fanBiasQingyise && nm.indexOf('清一色') >= 0) bonus += p.fanBiasQingyise;
        if (p.fanBiasQidui &&
          (nm.indexOf('七对') >= 0 || nm.indexOf('龙七对') >= 0 || nm.indexOf('双龙七对') >= 0)) {
          bonus += p.fanBiasQidui;
        }
        fc.total += bonus;
        if (!bestFan || fc.total > bestFan.total) bestFan = fc;
      }
      if (bestFan) best = bestFan;
    }

    // 退向听防守（困难档）：尾盘 + 对手威胁大时，宁可多一向听也别打危险牌
    if (best && p.retreat && shantenW < 1000) {
      var bestDanger = dangerOf(view, best.tile);
      if (bestDanger >= p.dangerHigh) {
        var alt = null;
        for (var k = 0; k < scored.length; k++) {
          var c = scored[k];
          if (c.ev.shanten > best.ev.shanten + 1) continue;      // 最多退一个向听
          if (c.danger > p.dangerLow) continue;                  // 必须够安全
          if (!alt || c.danger < alt.danger ||
            (c.danger === alt.danger && c.total > alt.total)) alt = c;
        }
        if (alt) best = alt;
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

  /** 这次杠能立刻收多少钱（单位：底金） */
  function kongPayoff(view, kind) {
    var base = (view.rules && view.rules.baseScore) || 1;
    var per = kind === 'ankong' ? 2 : (kind === 'zhigang' ? 2 : 1);
    var payers = kind === 'zhigang' ? 1 : 2;
    var chain = Math.pow(2, Math.min(Math.max(view.gangChain || 0, 0), 4));
    return base * per * payers * chain;
  }

  /**
   * 杠的统一决策：杠完向听不变就直接杠；
   * 困难档再权衡「杠分收益 vs 破坏手牌的代价」——
   *   · 已经听牌（0 向听）不为了杠分破坏听牌
   *   · 还没听且杠分 ≥ kongPayForShanten × 变差的向听数，才用杠分换进度
   *   · 同向听但听口缩水超过 kongWaitTol 也不杠
   */
  function kongDecision(view, kind, cur, sAfter, waitBefore, waitAfter) {
    var p = profileOf(view.diff);
    if (sAfter < cur) return true;
    if (sAfter === cur) {
      if (!p.kongTradeoff) return true;
      if (waitBefore > 0 && waitAfter < waitBefore * (1 - p.kongWaitTol)) return false;
      return true;
    }
    // 杠完向听变差
    if (!p.kongTradeoff) return false;
    if (cur <= 0) return false;                       // 已经听牌，不换
    var payoff = kongPayoff(view, kind);
    return payoff >= p.kongPayForShanten * (sAfter - cur);
  }

  function waitCountOf(hand, melds, remain) {
    if (!remain) return 0;
    var waits = R.waitingTiles(hand, melds);
    var n = 0;
    for (var i = 0; i < waits.length; i++) n += remain[waits[i]];
    return n;
  }

  /**
   * 是否碰牌
   * hand 为当前 13 张手牌（含待处理的那张不算）
   */
  function shouldPong(view, tile) {
    var hand = view.hand;
    var melds = view.melds || [];
    var remain = view.remain || buildRemain(view);
    var p = profileOf(view.diff);
    var cur = R.shanten(hand, melds);
    var after = without(hand, tile, 2);
    var newMelds = melds.concat([{ kind: 'pong', tile: tile }]);
    var best = bestShantenAfterDiscard(after, newMelds, remain);
    if (best.shanten < cur) return true;
    if (best.shanten > cur) return false;
    // 向听相同：比较进张质量，且已有较多副露时慎重（余地小）
    var curEval = evaluateHand(hand, melds, remain);
    if (melds.length >= p.pongMaxMelds) return false;
    return best.score > curEval.score * p.pongScoreMul;
  }

  /** 是否直杠（手上三张，别人打出第四张） */
  function shouldZhiGang(view, tile) {
    var hand = view.hand;
    var melds = view.melds || [];
    var remain = view.remain || buildRemain(view);
    var cur = R.shanten(hand, melds);
    var after = without(hand, tile, 3);
    var newMelds = melds.concat([{ kind: 'zhigang', tile: tile }]);
    var sAfter = R.shanten(after, newMelds);
    var wb = cur === 0 ? waitCountOf(hand, melds, remain) : 0;
    var wa = sAfter === 0 ? waitCountOf(after, newMelds, remain) : 0;
    return kongDecision(view, 'zhigang', cur, sAfter, wb, wa);
  }

  /** 是否暗杠 */
  function shouldAnKong(view, tile) {
    var hand = view.hand;
    var melds = view.melds || [];
    var remain = view.remain || buildRemain(view);
    var cur = R.shanten(hand, melds);
    var after = without(hand, tile, 4);
    var newMelds = melds.concat([{ kind: 'ankong', tile: tile }]);
    var sAfter = R.shanten(after, newMelds);
    var wb = cur === 0 ? waitCountOf(hand, melds, remain) : 0;
    var wa = sAfter === 0 ? waitCountOf(after, newMelds, remain) : 0;
    return kongDecision(view, 'ankong', cur, sAfter, wb, wa);
  }

  /** 是否补杠（已碰，手上又有第四张） */
  function shouldAddKong(view, tile) {
    var hand = view.hand;
    var remain = view.remain || buildRemain(view);
    var melds = view.melds.map(function (m) {
      return m.kind === 'pong' && m.tile === tile ? { kind: 'mingkong', tile: tile } : m;
    });
    var cur = R.shanten(hand, view.melds || []);
    var after = without(hand, tile, 1);
    var sAfter = R.shanten(after, melds);
    var wb = cur === 0 ? waitCountOf(hand, view.melds || [], remain) : 0;
    var wa = sAfter === 0 ? waitCountOf(after, melds, remain) : 0;
    return kongDecision(view, 'addkong', cur, sAfter, wb, wa);
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
    var p = profileOf(view.diff);
    var sitKey = plan.sitKey || plan.key;
    var adj = learnAdj(view.liangdaoLearn, sitKey);
    var need = LIANGDAO.need / (adj || 1) * p.liangdaoNeedMul;
    if (plan.fan === 1) need *= p.pitHuNeedMul;
    // 困难档：对手已经明显听牌时，亮倒等于把自己的听口送给对手躲 → 显著抬高门槛
    var threat = opponentThreat(view);
    var vetoed = !!(p.threatVeto && threat >= p.threatAt);
    if (vetoed) need *= p.threatNeedMul;
    // 成长型：对「激进的人类」更谨慎（他快听、你亮倒就是在送听口）
    if (p.learn && view.humanModel) {
      var hm = view.humanModel;
      need *= 1 + 0.15 * (hm.aggression || 0) * (hm.confidence || 0);
    }
    // 困难档：EV 落在临界带里用混合策略（避免阈值被对手反推），带外用确定判断
    var yes = plan.score > need;
    var mixed = false;
    if (p.mixBand > 0) {
      var lo = need * (1 - p.mixBand), hi = need * (1 + p.mixBand);
      if (plan.score > lo && plan.score <= hi) {
        mixed = true;
        var r = view.rng ? view.rng() : Math.random();
        yes = r >= p.mixProb;          // 带内有 mixProb 的概率选择不亮
      }
    }
    return {
      plan: plan, need: need, adj: adj, sitKey: sitKey, score: plan.score,
      threat: threat, vetoed: vetoed, mixed: mixed, yes: yes
    };
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
    dangerOf: dangerOf,
    leftoverDanger: leftoverDanger,
    fanPotential: fanPotential,
    kongPayoff: kongPayoff,
    // 做牌计划层
    planCandidates: planCandidates,
    updatePlan: updatePlan,
    planTileBias: planTileBias,
    handStats: handStats,
    PLAN_DEFS: PLAN_DEFS,
    LIANGDAO: LIANGDAO,
    // 难度档
    DIFFICULTY: DIFFICULTY,
    DIFFICULTY_LIST: DIFFICULTY_LIST,
    profileOf: profileOf,
    buildRemain: buildRemain,
    tileValue: tileValue,
    evaluateHand: evaluateHand
  };
});
