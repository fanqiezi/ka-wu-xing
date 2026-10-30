/*
 * 卡五星麻将 —— 牌局引擎（三人：玩家 + 2 个电脑）
 *
 * 流程：发牌 -> 轮流 摸牌 / 自身操作(胡·杠·亮倒) / 打牌 -> 别人 胡·杠·碰 -> 下一家
 * 结算：番数加算（底金 × 番数和），亮倒在最后对得分整体 ×2；
 *       自摸两家出，点炮点炮者出一份
 *       杠分立刻结算；荒庄查大叫（未听牌赔听牌）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./tiles.js'), require('./rules.js'), require('./ai.js'), require('./memory.js'));
  } else {
    root.KWX = root.KWX || {};
    root.KWX.Game = factory(root.KWX.Tiles, root.KWX.Rules, root.KWX.AI, root.KWX.Memory);
  }
})(typeof self !== 'undefined' ? self : this, function (T, R, AI, Memory) {
  'use strict';

  var PLAYER_NAMES = ['你', '下家', '上家'];

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
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

  function distinct(tiles) {
    var seen = {}, out = [];
    for (var i = 0; i < tiles.length; i++) {
      if (!seen[tiles[i]]) { seen[tiles[i]] = 1; out.push(tiles[i]); }
    }
    return out;
  }

  function Game(options) {
    options = options || {};
    this.rules = Object.assign({}, R.DEFAULT_RULES, options.rules || {});
    this.speed = options.speed === undefined ? 520 : options.speed;
    this.seed = options.seed;
    this.rng = options.rng || (options.seed !== undefined ? makeRng(options.seed) : Math.random);
    this.listeners = {};
    this.roundNo = 0;
    this.dealer = Math.floor(this.rng() * 3);
    this.players = [0, 1, 2].map(function (i) {
      return {
        seat: i,
        name: PLAYER_NAMES[i],
        isAI: i !== 0,
        hand: [],
        melds: [],
        discards: [],
        score: 0,
        liangdao: false,     // 是否已亮倒
        passWin: false,      // 漏胡：点炮没胡，过手前不能再胡
        lastDraw: null
      };
    });
    if (options.humanSeatIsAI) { /* 保留给无头测试 */ }
    // 电脑难度：normal（普通）/ hard（困难）/ growth（成长型，会学人类）
    this.aiDifficulty = AI.profileOf(options.aiDifficulty || 'normal').key;
    // 可选：按座位单独指定难度（A/B 自对弈统计用；默认跟随全局难度）
    this.aiDifficultyBySeat = options.aiDifficultyBySeat || null;
    // 「成长型」的记忆（由 UI 从 localStorage 读出来传进来；不传就是空记忆）
    this.aiMemory = options.memory || (Memory ? Memory.blank() : null);
    this._humanModel = Memory ? Memory.profile(this.aiMemory) : null;
    // 做牌计划（按座位一份状态；aiPlans 是状态机，aiPlanNow 是当前目标番型名，aiPlanLog 是事件流水）
    this.aiPlans = [null, null, null];
    this.aiPlanNow = [null, null, null];
    this.aiPlanLog = [];
    // 电脑的「亮倒奖惩记忆」：每个座位一套，按牌型记「亮倒后赢了/输了」的倾向
    this.liangdaoLearn = [0, 1, 2].map(function () { return AI.newLearnTable(); });
    this.playing = false;
    this.pending = null;
    this.log = [];
    this.history = [];        // 每局输赢明细（给「对局记录」用）
    this._scoreBefore = null;
    this.roundGangs = [];     // 本局杠分（杠是立刻结算的，单独记下来给结算弹窗展示）
    this.gangChain = 0;
    this.wall = [];
    this.turnHadKong = false;
    this.turnKongIndex = 0;   // 本巡这一杠是「杠上杠」的第几杠（0 = 没杠）
    this.lastDiscard = null;
  }

  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  Game.prototype.on = function (evt, fn) {
    (this.listeners[evt] = this.listeners[evt] || []).push(fn);
    return this;
  };

  Game.prototype.emit = function (evt, data) {
    var arr = this.listeners[evt];
    if (arr) for (var i = 0; i < arr.length; i++) arr[i](data);
    if (evt !== 'change') {
      var all = this.listeners['change'];
      if (all) for (var k = 0; k < all.length; k++) all[k]({ evt: evt, data: data });
    }
  };

  Game.prototype.pushLog = function (text, cls) {
    this.log.push({ text: text, cls: cls || '' });
    if (this.log.length > 200) this.log.shift();
    this.emit('log', { text: text, cls: cls || '' });
  };

  Game.prototype.say = function (seat, text, cls) {
    this.pushLog('【' + this.players[seat].name + '】' + text, cls);
  };

  /* ============================ 状态快照（给 UI） ============================ */

  /**
   * 亮倒玩家对外公开的那几张牌：只公开「能凑成赢牌条件」的听牌型，
   * 其余（比如这一巡刚摸到的那张）不展示。
   */
  Game.prototype.publicHand = function (seat) {
    var p = this.players[seat];
    if (!p.liangdao) return null;
    if (p.liangdaoReveal) return p.liangdaoReveal.slice();
    // 算一次缓存住：这个计算要枚举拆解，别每次渲染都重算
    var key = p.hand.join(',') + '|' + p.lastDraw + '|' + p.melds.length;
    if (p._revealKey === key && p._revealCache) return p._revealCache.slice();
    var out;
    if (p.hand.length % 3 === 1) {
      out = R.revealTiles(p.hand, p.melds);
    } else {
      out = null;
      // 刚摸完牌还没打：挑一个能听牌的留法，只亮那段关联牌
      var opts = distinct(p.hand);
      for (var i = 0; i < opts.length; i++) {
        var rest = without(p.hand, opts[i], 1);
        if (R.isTenpai(rest, p.melds)) { out = R.revealTiles(T.sorted(rest), p.melds); break; }
      }
      if (!out) out = p.hand.slice();
    }
    p._revealKey = key;
    p._revealCache = out;
    return out.slice();
  };

  Game.prototype.snapshot = function () {
    var self = this;
    var HUMAN = 0;
    return {
      roundNo: this.roundNo,
      dealer: this.dealer,
      wallCount: this.wall ? this.wall.length : 0,
      playing: this.playing,
      gangChain: this.gangChain,
      rules: this.rules,
      lastDiscard: this.lastDiscard || null,
      players: this.players.map(function (p) {
        // 听牌信息属于私有信息：只有自己的、以及已经亮倒（手牌公开）的对手才算
        var mayKnowTenpai = p.seat === HUMAN || p.liangdao;
        return {
          seat: p.seat, name: p.name, isAI: p.isAI,
          hand: p.hand.slice(),
          handCount: p.hand.length,
          melds: p.melds.map(function (m) { return { kind: m.kind, tile: m.tile }; }),
          discards: p.discards.slice(),
          score: p.score,
          liangdao: p.liangdao,
          reveal: self.publicHand(p.seat),
          tenpai: self.playing && mayKnowTenpai && p.hand.length % 3 === 1
            ? R.isTenpai(p.hand, p.melds) : false,
          lastDraw: p.lastDraw
        };
      })
    };
  };

  /** AI 视角信息 */
  Game.prototype.viewFor = function (seat) {
    var p = this.players[seat];
    var discards = this.players.map(function (q) { return q.discards.slice(); });
    var meldsByPlayer = this.players.map(function (q) { return q.melds.slice(); });
    return {
      seat: seat,
      hand: p.hand.slice(),
      melds: p.melds.slice(),
      discards: discards,
      meldsByPlayer: meldsByPlayer,
      remain: AI.buildRemain({ hand: p.hand, discards: discards, meldsByPlayer: meldsByPlayer }),
      wallCount: this.wall ? this.wall.length : 0,
      rules: this.rules,
      diff: (this.aiDifficultyBySeat && this.aiDifficultyBySeat[seat]) || this.aiDifficulty,
      gangChain: this.gangChain,                 // 杠链（杠分收益要用）
      planState: this.aiPlans[seat],             // 做牌计划的状态机（按座位一份，每局重置）
      humanModel: AI.profileOf((this.aiDifficultyBySeat && this.aiDifficultyBySeat[seat]) || this.aiDifficulty).learn
        ? this._humanModel : null,               // 「成长型」才带对手画像
      liangdaoLearn: this.liangdaoLearn[seat],   // 该座位的亮倒奖惩记忆
      human: seat === 0,
      rng: this.rng
    };
  };

  /**
   * 亮倒奖惩记忆：这一局亮倒过的电脑，按**当时的情况**复盘 ——
   * 赢了就上调「这一类情况」的亮倒倾向、没赢就下调，下一局遇到同类情况门槛随之缩放。
   * 情况维度：番数档 · 听牌宽度 · 牌山与剩余和牌张 · 放铳风险（对手副露/牌河）
   * @param {function(number):boolean} isWinner 座位号 -> 是不是本局赢家
   */
  Game.prototype.learnFromLiangdao = function (isWinner) {
    var self = this;
    this.players.forEach(function (p, i) {
      if (!p.isAI || !p.liangdao) return;                     // 只让电脑学（玩家自己决定）
      var sit = p.liangdaoSit || p.liangdaoKey;
      if (!sit) return;
      AI.noteLiangdaoResult(self.liangdaoLearn[i], sit, !!(isWinner && isWinner(i)), p.liangdaoKey);
    });
  };

  /* ============================ 人机交互 ============================ */

  Game.prototype.ask = function (payload) {
    var self = this;
    return new Promise(function (resolve) {
      self.pending = { resolve: resolve, payload: payload };
      self.emit('ask', payload);
    });
  };

  Game.prototype.cancelAsk = function () {
    if (this.pending) {
      var r = this.pending.resolve;
      this.pending = null;
      r(null);
      this.emit('askEnd');
    }
  };

  Game.prototype.submit = function (answer) {
    if (!this.pending) return false;
    var p = this.pending;
    this.pending = null;
    this.emit('askEnd');
    p.resolve(answer);
    return true;
  };

  Game.prototype.stop = function () {
    this.playing = false;
    this.cancelAsk();
  };

  /* ============================ 对局记录 ============================ */

  /** 记一步回放事件（只在对局记录里用，不影响牌局） */
  Game.prototype.rec = function (ev) {
    if (this.replay) this.replay.events.push(ev);
  };

  /** 结算前后对比分数，记下一局的输赢明细 */
  Game.prototype.recordRound = function (result) {
    var self = this;
    var before = this._scoreBefore || [0, 0, 0];
    var deltas = this.players.map(function (p, i) { return p.score - (before[i] || 0); });
    var winners = [];
    if (result && result.type === 'win') {
      result.winners.forEach(function (w) {
        winners.push({
          seat: w.seat,
          name: w.name,
          selfDraw: !!w.selfDraw,
          fromSeat: w.fromSeat,
          qiangGang: !!w.qiangGang,
          gangPao: !!w.gangPao,
          fan: w.result.capped,
          typeFan: w.result.typeFan,
          items: w.result.items.map(function (it) { return it.name; }),
          amount: w.pays.reduce(function (s, x) { return s + x.amount; }, 0)
        });
      });
    }
    this.history.push({
      round: this.roundNo,
      type: (result && result.type) || 'huang',
      dealer: this.dealer,
      deltas: deltas,
      scores: this.players.map(function (p) { return p.score; }),
      winners: winners,
      gangs: (result && result.gangs) ? result.gangs : null,
      replay: this.replay || null,
      tenpai: (result && result.type === 'huang')
        ? result.tenpai.map(function (t) { return !!t.tenpai; })
        : null
    });
    this._scoreBefore = null;
    this.emit('history', { round: this.history.length });
    this.noteMemory(result);
  };

  /**
   * 「成长型」学着记这一局：只记人类的**公开行为**
   * （切了多少张、其中几张是摸切、碰杠几次、胡的是什么牌/几番、谁放了他的铳）
   */
  Game.prototype.noteMemory = function (result) {
    if (!Memory || !this.aiMemory) return;
    if (AI.profileOf(this.aiDifficulty).learn !== true) return;
    var h = this.players[0];
    var pongs = 0, kongs = 0;
    (h.melds || []).forEach(function (m) {
      if (m.kind === 'pong') pongs++; else kongs++;
    });
    var rec = {
      discards: h.discards.length,
      tsumogiri: h.tsumogiriCount || 0,
      pongs: pongs,
      kongs: kongs,
      winDiscards: this.players.reduce(function (s, p) { return s + p.discards.length; }, 0),
      winTile: null,
      dealInTile: null,
      fan: 0
    };
    if (result && result.type === 'win') {
      result.winners.forEach(function (w) {
        if (w.seat === 0) {
          rec.winTile = w.winTile;
          rec.fan = (w.result && w.result.capped) || 0;
        }
        if (!w.selfDraw && w.fromSeat === 0) rec.dealInTile = w.winTile;
      });
    }
    Memory.update(this.aiMemory, rec);
    this._humanModel = Memory.profile(this.aiMemory);
    this.emit('memory', { memory: this.aiMemory });
  };

  /* ============================ 开局 ============================ */

  Game.prototype.startRound = function () {
    var self = this;
    if (this.playing) return Promise.resolve();
    this.roundNo++;
    this._scoreBefore = this.players.map(function (p) { return p.score; });
    var wall = T.riffle(T.makeWall(), this.rng);
    this.wall = wall;
    this.gangChain = 0;
    this.roundGangs = [];
    this.lastDiscard = null;
    this.roundResult = null;
    this.players.forEach(function (p) {
      p.hand = [];
      p.melds = [];
      p.discards = [];
      p.liangdao = false;
      p.liangdaoFresh = false;
      p.liangdaoReveal = null;
      p.liangdaoKey = null;
      p.liangdaoSit = null;
      p.liangdaoFeature = null;
      p.passWin = false;
      p.lastDraw = null;
      p.tsumogiriCount = 0;      // 本局摸切了几张（成长型记忆要用）
    });
    // 做牌计划：每局重新来过（上一局的计划不带到这一局）
    this.aiPlans = [null, null, null];
    this.aiPlanNow = [null, null, null];
    // 每人 13 张
    for (var k = 0; k < 13; k++) {
      for (var s = 0; s < 3; s++) {
        this.players[(this.dealer + s) % 3].hand.push(this.wall.pop());
      }
    }
    this.players.forEach(function (p) { p.hand = T.sorted(p.hand); });
    // 回放：记下起手牌 + 牌山顺序，之后每一步事件都记进来（对局记录的「回放」用）
    this.replay = {
      dealer: this.dealer,
      round: this.roundNo,
      deal: this.players.map(function (p) { return p.hand.slice(); }),
      wall: this.wall.slice(),          // pop() 从尾部取牌，回放时按张数推算剩余牌山
      events: []
    };
    this.playing = true;
    this.emit('roundStart', { dealer: this.dealer, roundNo: this.roundNo });
    this.pushLog('第 ' + this.roundNo + ' 局开始，庄家：' + this.players[this.dealer].name, 'hl');
    return this.runRound();
  };

  /** 切换电脑难度（记忆不随难度切换而清空，属于「成长型」的独立档案） */
  Game.prototype.setDifficulty = function (name) {
    this.aiDifficulty = AI.profileOf(name).key;
    return this.aiDifficulty;
  };

  Game.prototype.newMatch = function () {
    this.players.forEach(function (p) { p.score = 0; });
    this.roundNo = 0;
    this.dealer = Math.floor(this.rng() * 3);
    this.log = [];
    this.history = [];
    this._scoreBefore = null;
  };

  /* ============================ 主循环 ============================ */

  Game.prototype.runRound = async function () {
    var seat = this.dealer;
    var needDraw = true;
    var afterKongClaim = false;
    var claim = null;

    while (this.playing) {
      var p = this.players[seat];
      var ctx = { haidi: false, gangFlower: false };

      if (needDraw) {
        if (!afterKongClaim) { this.turnHadKong = false; this.turnKongIndex = 0; }
        afterKongClaim = false;
        if (this.wall.length === 0) {
          return this.finishHuangzhuang();
        }
        var t = this.wall.pop();
        p.hand.push(t);
        p.hand = T.sorted(p.hand);
        p.lastDraw = t;
        p.passWin = false;
        ctx.haidi = this.wall.length === 0;
        this.rec({ t: 'draw', seat: seat, tile: t, wallLeft: this.wall.length });
        this.emit('draw', { seat: seat, tile: t });
        if (!p.isAI) await sleep(60);
      } else {
        // 碰之后不摸牌，直接打；碰会打断「杠上杠」链
        this.turnHadKong = false;
        this.turnKongIndex = 0;
        this.gangChain = 0;
      }

      /* ---- 自身操作：胡 / 暗杠 / 补杠 / 亮倒 ----
       * 摸完牌后：胡 / 杠 / 亮倒都可以；
       * 碰完牌（needDraw=false，lastDraw 为 null）：不能再杠（杠必须摸牌后），
       *   但如果这手牌能听牌，仍然要问一下要不要亮倒。 */
      var outcome = await this.selfPhase(seat, ctx);
      if (outcome === 'win') return;

      /* ---- 打牌 ---- */
      var tile = await this.discardPhase(seat);
      if (tile === null) return;   // 被中断

      /* ---- 别人响应 ---- */
      claim = await this.resolveClaims(tile, seat);
      if (claim === 'win') return;

      if (claim && claim.type === 'pong') {
        seat = claim.seat;
        needDraw = false;
        this.gangChain = 0;
      } else if (claim && claim.type === 'kong') {
        seat = claim.seat;
        needDraw = true;
        afterKongClaim = true;   // 直杠后补牌，仍属同一杠链
      } else {
        seat = (seat + 1) % 3;
        needDraw = true;
        if (!this.turnHadKong) this.gangChain = 0;
      }
    }
  };

  /* ============================ 摸牌后自身操作 ============================ */

  /** @returns 'win' | 'continue' */
  Game.prototype.selfPhase = async function (seat, ctx) {
    var p = this.players[seat];
    var declined = {};
    while (this.playing) {
      var all = this.selfActions(seat, ctx);
      var actions = all.filter(function (a) {
        if (a.type === 'pass') return false;
        return !declined[a.type + ':' + (a.tile === undefined ? '' : a.tile)];
      });
      if (actions.length === 0) return 'continue';
      if (!p.isAI) actions.push({ type: 'pass' });

      var choice;
      if (p.isAI) {
        choice = this.aiSelfChoice(seat, actions);
        if (choice.type !== 'pass') await sleep(this.speed * 0.55);
      } else {
        // 顺便把「现在允许打哪些牌」带给界面：这样玩家在问亮倒时可以直接点牌出牌
        var preview = this.allowedDiscards(seat);
        var answer = await this.ask({
          kind: 'self', seat: seat, actions: actions, ctx: ctx, preview: preview
        });
        if (!answer) return 'continue';
        choice = answer;
      }

      if (choice.type === 'pass') {
        for (var i = 0; i < actions.length; i++) {
          var a = actions[i];
          if (a.type === 'pass') continue;
          declined[a.type + ':' + (a.tile === undefined ? '' : a.tile)] = true;
        }
        continue;
      }
      if (choice.type === 'hu') {
        await this.settleWin([{ seat: seat, result: choice.result, winTile: p.lastDraw, fromSeat: null }], true, ctx);
        return 'win';
      }
      if (choice.type === 'liangdao') {
        p.liangdao = true;
        p.liangdaoFresh = true;   // 这一手还可以选留哪张，之后就锁死只能摸打
        // 记下这次摊的是什么牌型 + 当时的情况 —— 结算时按「赢/输」回访这一类情况
        var ldp = AI.liangdaoPlan(this.viewFor(seat));
        p.liangdaoKey = ldp ? ldp.key : null;
        p.liangdaoSit = ldp ? ldp.sitKey : null;      // 按情况分桶的 key（见 ai.js situationKey）
        p.liangdaoFeature = ldp ? ldp.sitLabel : null; // 给界面看的情况描述
        this.say(seat, '亮倒！番数 ×2', 'liangdao');
        this.rec({ t: 'liangdao', seat: seat });
        this.emit('liangdao', { seat: seat, sit: p.liangdaoFeature });
        continue;
      }
      if (choice.type === 'ankong' || choice.type === 'addkong') {
        var kind = choice.type === 'ankong' ? 'ankong' : 'mingkong';
        var robbed = await this.doKong(seat, choice.tile, kind, null);
        if (robbed) return 'win';
        // 杠后补牌
        ctx.gangFlower = true;
        declined = {};   // 补牌后重新判断
        if (this.wall.length === 0) {
          this.pushLog('牌墙已空，杠后无牌可补，本局荒庄（杠钱照算）', 'hl');
          this.finishHuangzhuang();
          return 'win';
        }
        var rt = this.wall.pop();
        p.hand.push(rt);
        p.hand = T.sorted(p.hand);
        p.lastDraw = rt;
        ctx.haidi = this.wall.length === 0;
        this.rec({ t: 'draw', seat: seat, tile: rt, fromKong: true, wallLeft: this.wall.length });
        this.emit('draw', { seat: seat, tile: rt, fromKong: true });
        await sleep(this.speed * 0.5);
        continue;
      }
    }
    return 'continue';
  };

  Game.prototype.selfActions = function (seat, ctx) {
    var p = this.players[seat];
    var acts = [];
    var win = null;
    if (p.lastDraw !== null && this.justDrew(seat)) {
      // 注意：canWinOnDraw 接收的是「尚未包含胡牌张」的手牌
      win = R.canWinOnDraw(without(p.hand, p.lastDraw, 1), p.melds, p.lastDraw, {
        rules: this.rules,
        liangdao: p.liangdao,
        haidi: ctx.haidi,
        gangFlower: ctx.gangFlower
      });
    }
    if (win) acts.push({ type: 'hu', result: win, tile: p.lastDraw });
    // 杠必须「摸牌后」才能开：牌墙已空不能杠（没有牌可补）；碰完牌（lastDraw 为 null）不能杠。
    // 亮倒之后仍然允许补杠 / 暗杠 / 直杠（这几样不改变已经定下的听牌型）。
    if (this.wall.length > 0 && p.lastDraw !== null) {
      var an = R.canAnKongList(p.hand);
      for (var i = 0; i < an.length; i++) acts.push({ type: 'ankong', tile: an[i] });
      // 补杠只能在「摸到第 4 张的当回合」补：这一手不补，后面就作废了
      var add = R.canAddKong(p.hand, p.melds).filter(function (t) { return t === p.lastDraw; });
      for (var j = 0; j < add.length; j++) acts.push({ type: 'addkong', tile: add[j] });
    }
    // 亮倒只在自己回合、摸完牌之后问（碰完之后不再问）
    if (p.lastDraw !== null && this.canLiangdao(seat)) acts.push({ type: 'liangdao' });
    if (acts.length) acts.push({ type: 'pass' });
    return acts;
  };

  Game.prototype.justDrew = function (seat) {
    var p = this.players[seat];
    return p.hand.length % 3 === 2;
  };

  Game.prototype.canLiangdao = function (seat) {
    var p = this.players[seat];
    if (p.liangdao || !this.rules.liangdaoEnabled) return false;
    var opts = distinct(p.hand);
    for (var i = 0; i < opts.length; i++) {
      if (R.isTenpai(without(p.hand, opts[i], 1), p.melds)) return true;
    }
    return false;
  };

  Game.prototype.aiSelfChoice = function (seat, actions) {
    var p = this.players[seat];
    var view = this.viewFor(seat);
    for (var i = 0; i < actions.length; i++) {
      if (actions[i].type === 'hu') return actions[i];
    }
    for (var k = 0; k < actions.length; k++) {
      var a = actions[k];
      if (a.type === 'ankong' && AI.shouldAnKong(view, a.tile)) return a;
      if (a.type === 'addkong' && AI.shouldAddKong(view, a.tile)) return a;
    }
    for (var m = 0; m < actions.length; m++) {
      if (actions[m].type === 'liangdao' && AI.shouldLiangdao(view)) return actions[m];
    }
    return { type: 'pass' };
  };

  /* ============================ 打牌 ============================ */

  /**
   * 亮倒者的听张：除非迫不得已，谁都不能打出这些牌（不许故意放铳）
   * 返回 { tile: true }
   */
  Game.prototype.dangerousDiscards = function (seat) {
    var banned = {};
    if (!this.rules.noDealInLiangdao) return banned;
    var p = this.players[seat];
    for (var k = 0; k < 3; k++) {
      if (k === seat) continue;
      var op = this.players[k];
      if (!op.liangdao) continue;
      for (var i = 0; i < p.hand.length; i++) {
        var t = p.hand[i];
        if (banned[t]) continue;
        var res = R.canWinOnDiscard(op.hand, op.melds, t, {
          rules: this.rules,
          liangdao: op.liangdao,       // 亮倒者自己的屁胡也能捉炮
          fromLiangdao: p.liangdao
        });
        if (res) banned[t] = true;
      }
    }
    return banned;
  };

  /**
   * 这一手允许打出哪些牌（亮倒锁死 + 不许放铳 两个约束）
   * @returns { allowed, banned, locked, forced }
   */
  Game.prototype.allowedDiscards = function (seat) {
    var p = this.players[seat];
    var allowed = p.hand.slice();
    var locked = false;
    if (p.liangdao) {
      if (p.liangdaoFresh) {
        // 亮倒的这一手：可以自由选择要留下的听牌型，但必须仍然听牌
        var keep = allowed.filter(function (t) {
          return R.isTenpai(without(p.hand, t, 1), p.melds);
        });
        if (keep.length) allowed = keep;
      } else if (this.rules.liangdaoLockHand && p.lastDraw !== null) {
        // 亮倒之后只能摸打：只允许打出刚摸到的那张，听张不能再改
        allowed = [p.lastDraw];
        locked = true;
      }
    }

    // 不许故意打出亮倒者的听张（即便会因此听不了牌）；手里全是危险张时才被迫放铳
    var banned = this.dangerousDiscards(seat);
    var bannedTiles = Object.keys(banned).map(Number);
    var forced = false;
    if (bannedTiles.length) {
      var safe = allowed.filter(function (t) { return !banned[t]; });
      if (safe.length) allowed = safe;
      else forced = true;
    }
    return { allowed: allowed, banned: bannedTiles, locked: locked, forced: forced };
  };

  Game.prototype.discardPhase = async function (seat) {
    var p = this.players[seat];
    var plan = this.allowedDiscards(seat);
    var allowed = plan.allowed;
    var locked = plan.locked;
    var banned = plan.banned;
    var bannedTiles = banned;
    var forced = plan.forced;

    var tile = null;
    if (p.isAI) {
      var view = this.viewFor(seat);
      view.allowed = allowed;
      // 做牌计划：每巡先更新一次（立目标 / 放弃 / 重新捡起来），再按计划留牌
      if (AI.profileOf(view.diff).plan) {
        var pr = AI.updatePlan(view);
        this.aiPlans[seat] = pr.state;
        this.aiPlanNow[seat] = pr.plan ? pr.plan.name : null;
        if (pr.events && pr.events.length) {
          var self2 = this;
          pr.events.forEach(function (ev) {
            self2.aiPlanLog.push({
              seat: seat, round: self2.roundNo, type: ev.type,
              key: ev.key, name: ev.name, why: ev.why
            });
          });
        }
        view.plan = pr.plan;
      }
      tile = AI.chooseDiscard(view);
      if (allowed.indexOf(tile) < 0) tile = allowed[0];
      await sleep(this.speed);
    } else {
      var answer = await this.ask({
        kind: 'discard', seat: seat, tiles: p.hand.slice(),
        allowed: allowed, locked: locked,
        banned: bannedTiles, forced: forced
      });
      if (!answer) return null;
      tile = answer.tile;
      if (allowed.indexOf(tile) < 0) tile = allowed[0];
    }
    if (forced && banned.indexOf(tile) >= 0) {
      this.pushLog(p.name + ' 手里全是亮倒者的听张，只能被迫打出 ' + T.nameOf(tile), 'hl');
    }
    // 切牌方式：打出的正好是刚摸到的那张 = 摸切；从手牌里挑一张 = 手切
    var tsumogiri = p.lastDraw !== null && tile === p.lastDraw;
    if (tsumogiri) p.tsumogiriCount = (p.tsumogiriCount || 0) + 1;
    p.hand = without(p.hand, tile, 1);
    p.lastDraw = null;
    p.liangdaoFresh = false;
    // 亮倒玩家的「公开手牌」= 能推出听牌的那段关联牌；其余不亮
    if (p.liangdao) p.liangdaoReveal = R.revealTiles(p.hand, p.melds);
    p.discards.push(tile);
    this.lastDiscard = { tile: tile, seat: seat, tsumogiri: tsumogiri };
    this.rec({
      t: 'discard', seat: seat, tile: tile, tsumogiri: tsumogiri,
      plan: this.aiPlanNow[seat] || null        // 回放里展示「当时在做哪个番」
    });
    this.emit('discard', { seat: seat, tile: tile, tsumogiri: tsumogiri });
    this.pushLog(p.name + (tsumogiri ? ' 摸切 ' : ' 手切 ') + T.nameOf(tile));
    return tile;
  };

  /* ============================ 别人响应（胡 / 杠 / 碰） ============================ */

  Game.prototype.resolveClaims = async function (tile, fromSeat) {
    var self = this;

    // 给真人玩家一个明确提示：这张牌本来能胡，但因为「屁胡只能自摸」被规则拦下
    if (fromSeat !== 0 && this.rules.pitHuOnlyZimo && !this.players[fromSeat].liangdao) {
      var hp = this.players[0];
      if (!hp.passWin && hp.isAI === false) {
        var strict = R.canWinOnDiscard(hp.hand, hp.melds, tile, {
          rules: this.rules, liangdao: hp.liangdao, gangPao: this.turnHadKong,
          fromLiangdao: false
        });
        if (!strict) {
          var relaxed = R.canWinOnDiscard(hp.hand, hp.melds, tile, {
            rules: Object.assign({}, this.rules, { pitHuOnlyZimo: false, liangdaoPitHuCanDianPao: true }),
            liangdao: hp.liangdao, gangPao: this.turnHadKong
          });
          if (relaxed && relaxed.isPitHu) {
            this.emit('pitHuBlocked', { tile: tile });
            this.pushLog('你本可胡 ' + T.nameOf(tile) + '，但屁胡（小胡）只能自摸、不能捉炮 —— 已按规则拦下', 'hl');
          }
        }
      }
    }

    var candidates = [];
    for (var i = 1; i <= 2; i++) {
      var seat = (fromSeat + i) % 3;
      var p = this.players[seat];
      var canHu = false, huResult = null;
      if (!p.passWin) {
        huResult = R.canWinOnDiscard(p.hand, p.melds, tile, {
          rules: this.rules,
          liangdao: p.liangdao,
          // 杠上炮：杠后打出的牌，屁胡也能胡；番数加算 +2，只有杠链 / 亮倒才乘算
          gangPao: this.turnHadKong,
          gangChainMul: this.gangChainMul(),
          // 亮倒的人打出的牌，屁胡也能胡
          fromLiangdao: this.players[fromSeat].liangdao
        });
        canHu = !!huResult;
      }
      // 亮倒之后不能碰（会换手牌）；但直杠（手里三张杠别人打出的）仍然允许
      var canZhiGang = this.wall.length > 0 && R.canZhiGang(p.hand, tile);
      var canPong = !p.liangdao && R.canPong(p.hand, tile);
      if (!canHu && !canZhiGang && !canPong) continue;
      candidates.push({
        seat: seat, canHu: canHu, huResult: huResult,
        canZhiGang: canZhiGang, canPong: canPong
      });
    }
    if (!candidates.length) return null;

    var decisions = [];
    for (var c = 0; c < candidates.length; c++) {
      var cand = candidates[c];
      var p2 = this.players[cand.seat];
      var ans;
      if (p2.isAI) {
        ans = AI.claimDecision(this.viewFor(cand.seat), {
          tile: tile, canHu: cand.canHu, canZhiGang: cand.canZhiGang, canPong: cand.canPong
        });
        if (ans.action !== 'pass') await sleep(this.speed * 0.5);
      } else {
        var res = await this.ask({
          kind: 'claim', seat: cand.seat, tile: tile,
          canHu: cand.canHu, huResult: cand.huResult,
          canZhiGang: cand.canZhiGang, canPong: cand.canPong
        });
        ans = res || { action: 'pass' };
      }
      decisions.push({ cand: cand, ans: ans });
    }

    // 1) 胡（可一炮双响）
    var winners = [];
    for (var w = 0; w < decisions.length; w++) {
      var d = decisions[w];
      if (d.cand.canHu && d.ans.action === 'hu') {
        winners.push({ seat: d.cand.seat, result: d.cand.huResult, winTile: tile, fromSeat: fromSeat });
      } else if (d.cand.canHu && d.ans.action !== 'hu') {
        this.players[d.cand.seat].passWin = true;
        this.say(d.cand.seat, '过（漏胡，过手前不能再胡）', 'muted');
      }
    }
    if (winners.length) {
      await this.settleWin(winners, false, { gangPao: this.turnHadKong });
      return 'win';
    }

    // 2) 杠（直杠）
    for (var g = 0; g < decisions.length; g++) {
      var dg = decisions[g];
      if (dg.cand.canZhiGang && dg.ans.action === 'kong') {
        var robbed = await this.doKong(dg.cand.seat, tile, 'zhigang', fromSeat);
        if (robbed) return 'win';
        return { type: 'kong', seat: dg.cand.seat };
      }
    }

    // 3) 碰
    for (var q = 0; q < decisions.length; q++) {
      var dq = decisions[q];
      if (dq.cand.canPong && dq.ans.action === 'pong') {
        var pp = this.players[dq.cand.seat];
        pp.hand = without(pp.hand, tile, 2);
        pp.melds.push({ kind: 'pong', tile: tile, from: fromSeat });
        // 碰的牌从牌河移走
        var dp = this.players[fromSeat].discards;
        dp.splice(dp.lastIndexOf(tile), 1);
        this.say(dq.cand.seat, '碰 ' + T.nameOf(tile), 'meld');
        this.rec({ t: 'pong', seat: dq.cand.seat, tile: tile, from: fromSeat });
        this.emit('pong', { seat: dq.cand.seat, tile: tile, from: fromSeat });
        await sleep(this.speed * 0.4);
        return { type: 'pong', seat: dq.cand.seat };
      }
    }
    return null;
  };

  /* ============================ 杠 ============================ */

  /** 当前杠链的倍率（第 1 杠 1、第 2 杠 2 … 第 5 杠起封顶 16） */
  Game.prototype.gangChainMul = function () {
    if (!this.gangChain) return 1;
    return Math.pow(2, Math.min(this.gangChain - 1, 4));
  };

  /**
   * 执行杠并结算杠分
   * @returns 是否被抢杠胡（true 表示本局已结束）
   */
  Game.prototype.doKong = async function (seat, tile, kind, fromSeat) {
    var p = this.players[seat];
    var base = this.rules.baseScore;
    var mult;

    if (kind === 'ankong') {
      p.hand = without(p.hand, tile, 4);
      p.melds.push({ kind: 'ankong', tile: tile });
    } else if (kind === 'zhigang') {
      p.hand = without(p.hand, tile, 3);
      p.melds.push({ kind: 'zhigang', tile: tile, from: fromSeat });
      var dp = this.players[fromSeat].discards;
      dp.splice(dp.lastIndexOf(tile), 1);
    } else { // 补杠
      p.hand = without(p.hand, tile, 1);
      for (var i = 0; i < p.melds.length; i++) {
        if (p.melds[i].kind === 'pong' && p.melds[i].tile === tile) {
          p.melds[i] = { kind: 'mingkong', tile: tile, from: p.melds[i].from };
          break;
        }
      }
      // 抢杠胡（只抢补杠，暗杠不抢）
      var robbers = [];
      for (var k = 1; k <= 2; k++) {
        var other = (seat + k) % 3;
        var op = this.players[other];
        if (op.passWin) continue;
        var hr = R.canWinOnDiscard(op.hand, op.melds, tile, {
          rules: this.rules, liangdao: op.liangdao, qiangGang: true
        });
        if (!hr) continue;
        var ans;
        if (op.isAI) {
          ans = { action: 'hu' };
        } else {
          var res = await this.ask({
            kind: 'claim', seat: other, tile: tile,
            canHu: true, huResult: hr, canZhiGang: false, canPong: false, qiangGang: true
          });
          ans = res || { action: 'pass' };
        }
        if (ans.action === 'hu') robbers.push({ seat: other, result: hr, winTile: tile, fromSeat: seat, qiangGang: true });
      }
      if (robbers.length) {
        this.say(seat, '补杠 ' + T.nameOf(tile), 'meld');
        await this.settleWin(robbers, false, { qiangGang: true });
        return true;
      }
    }

    this.gangChain++;
    // 杠链翻倍：第 1 杠 ×1（不算杠上杠）、第 2 杠 ×2、……、第 5 杠 ×16 之后封顶不再翻倍
    var chainMul = Math.pow(2, Math.min(this.gangChain - 1, 4));
    this.turnHadKong = true;
    this.turnKongIndex = this.gangChain;   // 这是本链的第几杠（杠分按链递增；杠上炮按杠链乘算）
    var chainTxt = chainMul > 1 ? '（杠上杠 ×' + chainMul + '）' : '';

    if (this.rules.gangScore) {
      if (kind === 'zhigang') {
        var amtZ = base * 2 * chainMul;
        p.score += amtZ;
        this.players[fromSeat].score -= amtZ;
        this.roundGangs.push({
          seat: seat, kind: kind, tile: tile, per: amtZ, chain: chainMul, payers: [fromSeat]
        });
        this.pushLog(p.name + ' 直杠 ' + T.nameOf(tile) + '，' + this.players[fromSeat].name +
          ' 付 ' + amtZ + chainTxt, 'score');
      } else {
        var per = (kind === 'ankong' ? base * 2 : base * 1) * chainMul;
        var payers = [];
        for (var s = 0; s < 3; s++) {
          if (s === seat) continue;
          p.score += per;
          this.players[s].score -= per;
          payers.push(s);
        }
        this.roundGangs.push({
          seat: seat, kind: kind, tile: tile, per: per, chain: chainMul, payers: payers
        });
        this.pushLog(p.name + ' ' + (kind === 'ankong' ? '暗杠' : '补杠(明杠)') + ' ' + T.nameOf(tile) +
          '，每家 ' + per + chainTxt, 'score');
      }
    }
    this.rec({ t: kind === 'ankong' ? 'ankong' : (kind === 'zhigang' ? 'zhigang' : 'addkong'), seat: seat, tile: tile, from: (fromSeat === undefined ? null : fromSeat) });
    this.emit('kong', { seat: seat, tile: tile, kind: kind });
    await sleep(this.speed * 0.45);
    return false;
  };

  /* ============================ 结算 ============================ */

  Game.prototype.settleWin = async function (winners, selfDraw, ctx) {
    ctx = ctx || {};
    var base = this.rules.baseScore;
    var details = [];

    for (var i = 0; i < winners.length; i++) {
      var w = winners[i];
      var p = this.players[w.seat];
      var fan = w.result.capped;
      var amount = fan * base;
      var pays = [];

      if (selfDraw) {
        for (var s = 0; s < 3; s++) {
          if (s === w.seat) continue;
          var payAmt = amount;
          var payNote = '';
          if (this.players[s].liangdao && this.rules.liangdaoPayDouble) {
            // 自己亮倒了：输钱一律翻倍（别人自摸也一样）
            payAmt = amount * 2;
            payNote = '亮倒者输牌赔双倍';
          }
          this.players[s].score -= payAmt;
          p.score += payAmt;
          pays.push({ seat: s, amount: payAmt, note: payNote });
        }
      } else {
        var payer = this.players[w.fromSeat];
        var mul = 1;
        var notes = [];
        if (p.liangdao && this.rules.liangdaoDianPaoAsZimo) {
          // 旧玩法：点炮亮倒者 = 相当于亮倒者自摸，点炮者一人出两份。
          // 默认不再这么算：亮倒的 ×2 已经在番数里了，点炮者只出一份。
          mul *= 2;
          notes.push('亮倒·相当于自摸');
        }
        if (payer.liangdao && this.rules.liangdaoPayDouble) {
          // 亮倒的人输钱翻倍（点炮当然也算）
          mul *= 2;
          notes.push('亮倒者输牌赔双倍');
        }
        var total = amount * mul;
        payer.score -= total;
        p.score += total;
        pays.push({ seat: w.fromSeat, amount: total, note: notes.join('·') });
      }

      details.push({
        seat: w.seat,
        name: p.name,
        selfDraw: !!selfDraw,
        fromSeat: w.fromSeat,
        winTile: w.winTile,
        hand: p.hand.slice(),
        melds: p.melds.map(function (m) { return { kind: m.kind, tile: m.tile }; }),
        result: w.result,
        amount: amount,
        pays: pays,
        qiangGang: !!ctx.qiangGang || !!w.qiangGang,
        gangPao: !!ctx.gangPao
      });

      this.say(w.seat, (selfDraw ? '自摸 ' : '胡牌 ') + T.nameOf(w.winTile) + ' —— ' +
        w.result.items.map(function (it) { return it.name + '×' + it.mult; }).join(' + ') +
        ' = ' + fan + ' 倍', 'win');
      this.rec({
        t: 'win', seat: w.seat, tile: w.winTile, selfDraw: !!selfDraw,
        from: (w.fromSeat === undefined ? null : w.fromSeat), fan: fan
      });
    }

    var winnerSeats = {};
    details.forEach(function (d) { winnerSeats[d.seat] = true; });
    this.learnFromLiangdao(function (s) { return !!winnerSeats[s]; });

    this.playing = false;
    this.roundResult = {
      type: 'win', winners: details, selfDraw: !!selfDraw,
      gangChain: this.gangChain, gangs: this.roundGangs.slice()
    };
    this.recordRound(this.roundResult);
    this.emit('roundEnd', this.roundResult);
    if (this.roundNo > 0) {
      // 下一局庄家 = 第一个胡牌的玩家
      this.dealer = winners[0].seat;
    }
    return this.roundResult;
  };

  Game.prototype.finishHuangzhuang = function () {
    var base = this.rules.baseScore;
    var cap = this.rules.cap;
    var tenpai = this.players.map(function (p) {
      var best = R.maxFanForTenpai(p.hand, p.melds, { rules: this.rules });
      return best ? { tenpai: true, fan: best.fan, tile: best.tile } : { tenpai: false, fan: 0, tile: null };
    }, this);

    var pays = [];
    var anyLiangdao = this.players.some(function (p) { return p.liangdao; });
    var allTenpai = tenpai.every(function (t) { return t.tenpai; });
    if (this.rules.huangzhuangPei) {
      // 1) 未听牌者赔听牌者（查大叫）。
      //    亮倒的人也算听牌者 —— 未听牌者一样要赔给他（旧的「不必赔亮倒者」开关已并入这条规则）
      for (var i = 0; i < 3; i++) {
        if (tenpai[i].tenpai) continue;
        for (var j = 0; j < 3; j++) {
          if (i === j || !tenpai[j].tenpai) continue;
          var fan = Math.min(tenpai[j].fan, cap);
          if (this.players[j].liangdao) fan = Math.min(fan * 2, cap);
          var amt = fan * base;
          this.players[i].score -= amt;
          this.players[j].score += amt;
          pays.push({ from: i, to: j, fan: fan, amount: amt, reason: '未听赔听' });
          this.pushLog(this.players[i].name + ' 未听牌，赔 ' + this.players[j].name + ' ' + amt +
            '（' + fan + ' 倍底金）', 'score');
        }
      }

      // 2) 荒局时亮倒的人（即使自己听牌）还要赔给其他听牌者
      if (this.rules.liangdaoHuangPei) {
        for (var a = 0; a < 3; a++) {
          if (!this.players[a].liangdao) continue;
          for (var b = 0; b < 3; b++) {
            if (a === b || !tenpai[b].tenpai) continue;
            var fanB = Math.min(tenpai[b].fan, cap);
            if (this.players[b].liangdao) fanB = Math.min(fanB * 2, cap);
            var amtB = fanB * base;
            this.players[a].score -= amtB;
            this.players[b].score += amtB;
            pays.push({ from: a, to: b, fan: fanB, amount: amtB, reason: '亮倒赔听' });
            this.pushLog(this.players[a].name + ' 亮倒却没胡，赔 ' + this.players[b].name + ' ' +
              amtB + '（' + fanB + ' 倍底金）', 'score');
          }
        }
      }

      // 3) 无人亮倒且三家都听牌：互相抵消，不进行任何赔付
      if (!anyLiangdao && allTenpai) {
        this.pushLog('三家都听牌且无人亮倒 —— 互不赔付', 'muted');
      }
    }

    this.pushLog('荒庄（牌墙摸完，无人胡牌）—— 荒庄不荒杠，杠钱照算', 'hl');
    this.rec({ t: 'huang' });
    // 荒庄也算「亮倒没赢」：该牌型的亮倒倾向下调
    this.learnFromLiangdao(function () { return false; });
    this.playing = false;
    this.roundResult = {
      type: 'huang',
      tenpai: tenpai.map(function (t, idx) {
        return { seat: idx, tenpai: t.tenpai, fan: t.fan, tile: t.tile };
      }),
      pays: pays,
      gangChain: this.gangChain,
      gangs: this.roundGangs.slice()
    };
    this.recordRound(this.roundResult);
    this.emit('roundEnd', this.roundResult);
    return this.roundResult;
  };

  Game.PLAYER_NAMES = PLAYER_NAMES;
  Game.without = without;
  Game.distinct = distinct;

  return Game;
});
