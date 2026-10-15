/*
 * 牌局引擎无头模拟测试（三家全是电脑）
 * 运行： node tests/game.test.js
 */
'use strict';

const assert = require('assert');
const T = require('../js/tiles.js');
const R = require('../js/rules.js');
const Game = require('../js/game.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  \u2717 ' + name + '\n        ' + e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  \u2717 ' + name + '\n        ' + e.message); }
}
function group(n) { console.log('\n' + n); }

/** 牌面简记： '123456789t 123b 111z'  t=筒 b=条 z=字(1中2发3白) */
function H(str) {
  const out = [];
  String(str).trim().split(/\s+/).forEach(part => {
    const m = /^([0-9]+)([tbz])$/.exec(part);
    if (!m) throw new Error('bad tile notation: ' + part);
    const suit = m[2];
    for (const ch of m[1]) {
      const n = parseInt(ch, 10);
      if (suit === 't') out.push(n - 1);
      else if (suit === 'b') out.push(9 + n - 1);
      else out.push(17 + n);
    }
  });
  return out.sort((a, b) => a - b);
}

const ROUNDS = 60;

/** 跑一局，返回统计信息 */
function playOne(seed, stats) {
  const game = new Game({ seed: seed, speed: 0, rules: { baseScore: 1, cap: 8 } });
  game.players.forEach(p => { p.isAI = true; });   // 全自动

  game.on('ask', (payload) => {
    throw new Error('全 AI 对局不应出现人机交互请求：' + JSON.stringify(payload.kind));
  });

  game.on('discard', () => {
    game.players.forEach((p, i) => {
      assert.strictEqual(p.hand.length + 3 * p.melds.length, 13,
        '打牌后手牌张数异常 seat=' + i + ' hand=' + p.hand.length + ' melds=' + p.melds.length);
      assert.ok(p.hand.length >= 0);
    });
  });

  let result = null;
  game.on('roundEnd', (r) => { result = r; });

  return game.startRound().then(() => {
    assert.ok(result, '本局应产生结算结果');

    // 分数守恒（零和）
    const total = game.players.reduce((s, p) => s + p.score, 0);
    assert.strictEqual(total, 0, '总分应为 0，实际 ' + total);

    // 牌张守恒
    let tiles = game.wall.length;
    game.players.forEach(p => {
      tiles += p.hand.length + p.discards.length;
      p.melds.forEach(m => { tiles += (m.kind === 'pong' ? 3 : 4); });
    });
    assert.strictEqual(tiles, 84, '牌张总数应为 84，实际 ' + tiles);

    // 每种牌不超过 4 张
    const cnt = new Array(21).fill(0);
    game.players.forEach(p => {
      p.hand.forEach(t => cnt[t]++);
      p.discards.forEach(t => cnt[t]++);
      p.melds.forEach(m => { for (let k = 0; k < (m.kind === 'pong' ? 3 : 4); k++) cnt[m.tile]++; });
    });
    game.wall.forEach(t => cnt[t]++);
    for (let i = 0; i < 21; i++) {
      assert.ok(cnt[i] <= 4, T.nameOf(i) + ' 出现 ' + cnt[i] + ' 次');
    }

    stats.rounds++;
    if (result.type === 'huang') {
      stats.huang++;
    } else {
      result.winners.forEach(w => {
        if (w.selfDraw) stats.zimo++;
        else {
          stats.dianpao++;
          // ★ 核心断言：点炮胡的牌型不可能是屁胡 —— 两种例外：
          //   1) 放炮的人已亮倒（摊了牌，弃牌连屁胡都能胡）
          //   2) 杠上炮（杠后打出的牌，屁胡也能胡）
          const fromLiangdao = game.players[w.fromSeat].liangdao;
          const isGangPao = w.result.items.some(it => it.name === '杠上炮');
          if (fromLiangdao) stats.dianpaoToLiangdao = (stats.dianpaoToLiangdao || 0) + 1;
          else if (isGangPao) stats.dianpaoGangPao = (stats.dianpaoGangPao || 0) + 1;
          else {
            assert.strictEqual(w.result.isPitHu, false,
              '屁胡不应该能通过捉炮取胜！牌型：' + w.result.items.map(i => i.name).join('+'));
          }
        }
        if (w.result.isPitHu) stats.pitHu++;
        if (w.result.items.some(i => i.name === '卡五星')) stats.kaWuXing++;
        if (w.result.items.some(i => i.name === '亮倒')) stats.liangdao++;
        if (w.qiangGang) stats.qiangGang++;
        if (w.gangPao) stats.gangPao++;
      });
    }
    if (game.players.some(p => p.melds.some(m => m.kind === 'ankong' || m.kind === 'mingkong' || m.kind === 'zhigang'))) {
      stats.withKong++;
    }
    return result;
  });
}

(async function main() {
  group('无头对局模拟（' + ROUNDS + ' 局，全电脑）');

  const stats = {
    rounds: 0, huang: 0, zimo: 0, dianpao: 0, pitHu: 0,
    kaWuXing: 0, liangdao: 0, qiangGang: 0, gangPao: 0, withKong: 0
  };

  let error = null;
  for (let i = 0; i < ROUNDS; i++) {
    try {
      await playOne(1000 + i * 7919, stats);
    } catch (e) {
      error = e;
      break;
    }
  }

  test('全部对局无异常', () => {
    if (error) throw error;
    assert.strictEqual(stats.rounds, ROUNDS);
  });

  test('结算分布合理（有胡牌也有荒庄）', () => {
    console.log('        胡牌 ' + (stats.zimo + stats.dianpao) + ' 次（自摸 ' + stats.zimo +
      ' / 点炮 ' + stats.dianpao + '），荒庄 ' + stats.huang + ' 局');
    console.log('        屁胡 ' + stats.pitHu + ' 次，卡五星 ' + stats.kaWuXing +
      ' 次，亮倒 ' + stats.liangdao + ' 次，抢杠 ' + stats.qiangGang +
      ' 次，杠上炮 ' + stats.gangPao + ' 次，出现杠的局 ' + stats.withKong);
    assert.ok(stats.zimo + stats.dianpao > 0, '应至少有人胡牌');
    assert.ok(stats.huang < stats.rounds, '不应全部荒庄');
    assert.ok(stats.pitHu > 0, '应出现屁胡（自摸）');
  });

  test('屁胡确实只能自摸（模拟中零违例）', () => {
    assert.ok(stats.dianpao > 0, '样本中应有点炮胡，否则该断言无意义');
  });

  /* ------------------------------------------------------------------ */
  group('规则细节：屁胡点炮被拦截');

  test('构造屁胡听牌 -> 点炮被拒、自摸可胡', () => {
    const tiles = [0, 1, 2, 9, 10, 11, 18, 18, 19, 19, 20, 20, 3].sort((a, b) => a - b); // 13 张
    const res1 = R.canWinOnDiscard(tiles, [], 4, { rules: R.DEFAULT_RULES });
    const res2 = R.canWinOnDraw(tiles, [], 4, { rules: R.DEFAULT_RULES });
    if (res2) assert.strictEqual(res1, null, '若自摸能胡且为屁胡，则点炮必须被拒绝');
  });

  group('结算接口');

  await testAsync('自摸：两家出，赢家得两份', async () => {
    const game = new Game({ speed: 0, rules: { baseScore: 2, cap: 8 } });
    game.players[0].hand = [0, 1, 2, 9, 10, 11, 18, 18, 19, 19, 20, 20, 3];
    const result = {
      capped: 2, isPitHu: false, items: [{ name: '碰碰胡', mult: 2 }], typeFan: 2
    };
    await game.settleWin([{ seat: 0, result: result, winTile: 4, fromSeat: null }], true, {});
    assert.strictEqual(game.players[0].score, 8);   // 2 倍 × 底金 2 × 两家
    assert.strictEqual(game.players[1].score, -4);
    assert.strictEqual(game.players[2].score, -4);
  });

  await testAsync('点炮：点炮者出一份', async () => {
    const game = new Game({ speed: 0, rules: { baseScore: 2, cap: 8 } });
    const result = { capped: 4, isPitHu: false, items: [{ name: '清一色', mult: 4 }], typeFan: 4 };
    await game.settleWin([{ seat: 1, result: result, winTile: 4, fromSeat: 2 }], false, {});
    assert.strictEqual(game.players[1].score, 8);
    assert.strictEqual(game.players[2].score, -8);
    assert.strictEqual(game.players[0].score, 0);
  });

  await testAsync('点炮亮倒者：默认只出一份（不再按「相当于自摸」算两份）', async () => {
    const result = { capped: 2, isPitHu: false, items: [{ name: '亮倒', mult: 2 }], typeFan: 1 };
    const game = new Game({ speed: 0, rules: { baseScore: 1, cap: 8 } });
    game.players[1].liangdao = true;
    await game.settleWin([{ seat: 1, result: result, winTile: 4, fromSeat: 2 }], false, {});
    assert.strictEqual(game.players[1].score, 2, '默认点炮只出一份');
    assert.strictEqual(game.players[2].score, -2);

    // 打开开关后，仍按旧玩法算两份
    const g2 = new Game({ speed: 0, rules: { baseScore: 1, cap: 8, liangdaoDianPaoAsZimo: true } });
    g2.players[1].liangdao = true;
    await g2.settleWin([{ seat: 1, result: result, winTile: 4, fromSeat: 2 }], false, {});
    assert.strictEqual(g2.players[1].score, 4, '打开开关后点炮者出两份');
    assert.strictEqual(g2.players[2].score, -4);
  });

  await testAsync('一炮双响：点炮者付两份', async () => {
    const game = new Game({ speed: 0, rules: { baseScore: 1, cap: 8 } });
    const r1 = { capped: 2, isPitHu: false, items: [{ name: '碰碰胡', mult: 2 }], typeFan: 2 };
    const r2 = { capped: 4, isPitHu: false, items: [{ name: '清一色', mult: 4 }], typeFan: 4 };
    await game.settleWin([
      { seat: 1, result: r1, winTile: 4, fromSeat: 0 },
      { seat: 2, result: r2, winTile: 4, fromSeat: 0 }
    ], false, {});
    assert.strictEqual(game.players[0].score, -6);
    assert.strictEqual(game.players[1].score, 2);
    assert.strictEqual(game.players[2].score, 4);
  });

  /* ------------------------------------------------------------------ */
  group('杠分 / 抢杠 / 荒庄赔听 / 屁胡拦截（流程级）');

  await (async () => {
    await testAsync('杠分：暗杠两家各 2 倍、直杠点杠者 2 倍、补杠两家各 1 倍', async () => {
      const g1 = new Game({ speed: 0, rules: { baseScore: 1 } });
      g1.players[0].hand = [4, 4, 4, 4];
      await g1.doKong(0, 4, 'ankong', null);
      assert.deepStrictEqual(g1.players.map(p => p.score), [4, -2, -2], '暗杠');

      const g2 = new Game({ speed: 0, rules: { baseScore: 1 } });
      g2.players[0].hand = [4, 4, 4];
      g2.players[1].discards = [4];
      await g2.doKong(0, 4, 'zhigang', 1);
      assert.deepStrictEqual(g2.players.map(p => p.score), [2, -2, 0], '直杠');

      const g3 = new Game({ speed: 0, rules: { baseScore: 1 } });
      g3.players[0].hand = [4];
      g3.players[0].melds = [{ kind: 'pong', tile: 4 }];
      await g3.doKong(0, 4, 'mingkong', null);
      assert.deepStrictEqual(g3.players.map(p => p.score), [2, -1, -1], '补杠');
    });

    await testAsync('杠上杠：连续开杠第二杠翻倍', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1 } });
      g.players[0].hand = [4, 4, 4, 4, 5, 5, 5, 5];
      await g.doKong(0, 4, 'ankong', null);
      assert.strictEqual(g.gangChain, 1);
      assert.strictEqual(g.players[0].score, 4);
      await g.doKong(0, 5, 'ankong', null);
      assert.strictEqual(g.gangChain, 2);
      assert.strictEqual(g.players[0].score, 4 + 8, '第二杠每家 2×2=4');
      assert.strictEqual(g.players[1].score, -2 - 4);
    });

    await testAsync('抢杠胡：补杠被别人胡，杠不成立且结算抢杠', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8 } });
      g.playing = true;
      g.players[0].hand = [4];                                  // 手上第四张 5筒
      g.players[0].melds = [{ kind: 'pong', tile: 4 }];         // 已碰 5筒
      g.players[1].hand = H('123t 46t 789t 555b 22b');          // 听 5筒，卡五星
      g.players[2].hand = H('147t 258b 369t 11z 22z');
      const robbed = await g.doKong(0, 4, 'mingkong', null);
      assert.strictEqual(robbed, true, '应被抢杠');
      assert.ok(g.roundResult && g.roundResult.type === 'win');
      const w = g.roundResult.winners[0];
      assert.strictEqual(w.seat, 1);
      assert.strictEqual(w.qiangGang, true);
      assert.strictEqual(w.pays[0].seat, 0, '由补杠者付');
      assert.strictEqual(g.players[1].score, 4, '卡五星 ×2 × 抢杠 ×2 = 4');
      assert.strictEqual(g.players[0].score, -4);
      assert.strictEqual(g.gangChain, 0, '抢杠成立则这次杠不算');
    });

    await testAsync('荒庄赔听：未听牌者赔给听牌者', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8, huangzhuangPei: true } });
      g.wall = [];
      g.players[0].hand = H('123456789t 12b 11b');              // 听 3条（屁胡，1 倍）
      g.players[1].hand = H('147t 258b 369t 11z 22z');          // 未听
      g.players[2].hand = H('147t 258b 369t 11z 22z');          // 未听
      const res = g.finishHuangzhuang();
      assert.strictEqual(res.type, 'huang');
      assert.deepStrictEqual(g.players.map(p => p.score), [2, -1, -1]);
      assert.strictEqual(g.players.reduce((a, p) => a + p.score, 0), 0);
    });

    await testAsync('屁胡听牌时，别人打出来不询问玩家、并给出拦截提示', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1 } });
      g.playing = true;
      g.players[0].isAI = false;                                 // 玩家
      g.players[0].hand = H('123456789t 12b 11b');               // 听 3条，屁胡
      g.players[1].hand = H('147t 258b 369t 11z 22z');
      g.players[2].hand = H('147t 258b 369t 11z 22z');
      let asked = false, blocked = null;
      g.on('ask', () => { asked = true; });
      g.on('pitHuBlocked', d => { blocked = d; });
      const r = await g.resolveClaims(9 + 3 - 1, 1);             // 下家（座位1）打出 3条
      assert.strictEqual(r, null, '不应产生胡牌结算');
      assert.strictEqual(asked, false, '屁胡不能捉炮，就不该弹操作按钮');
      assert.ok(blocked, '应给出「屁胡不能捉炮」提示');
      assert.strictEqual(blocked.tile, 9 + 3 - 1);
    });

    await testAsync('亮倒者输钱翻倍：点炮翻倍、别人自摸也翻倍', async () => {
      const r = { capped: 2, isPitHu: false, items: [{ name: '碰碰胡', mult: 2 }], typeFan: 2 };

      // 亮倒者点炮 -> 2 倍
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8, liangdaoPayDouble: true } });
      g.players[0].liangdao = true;
      await g.settleWin([{ seat: 1, result: r, winTile: 4, fromSeat: 0 }], false, {});
      assert.strictEqual(g.players[0].score, -4, '亮倒者点炮赔双倍');
      assert.strictEqual(g.players[1].score, 4);

      // 别人自摸，自己亮倒 -> 也要付双倍（不看赢家是否亮倒）
      const g2 = new Game({ speed: 0, rules: { baseScore: 1, cap: 8, liangdaoPayDouble: true } });
      g2.players[0].liangdao = true;
      await g2.settleWin([{ seat: 1, result: r, winTile: 4, fromSeat: null }], true, {});
      assert.strictEqual(g2.players[0].score, -4, '亮倒者遇到别人自摸也赔双倍');
      assert.strictEqual(g2.players[2].score, -2, '没亮倒的照常付一份');
      assert.strictEqual(g2.players[1].score, 6);

      // 关掉罚则后一律只赔一份
      const g3 = new Game({ speed: 0, rules: { baseScore: 1, cap: 8, liangdaoPayDouble: false } });
      g3.players[0].liangdao = true;
      await g3.settleWin([{ seat: 1, result: r, winTile: 4, fromSeat: 0 }], false, {});
      assert.strictEqual(g3.players[0].score, -2, '关掉罚则后只赔一份');
    });

    await testAsync('亮倒 vs 亮倒：输家亮倒要翻倍（赢家亮倒默认不再算自我两份）', async () => {
      const r = { capped: 2, isPitHu: false, items: [{ name: '碰碰胡', mult: 2 }], typeFan: 2 };

      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8, liangdaoPayDouble: true } });
      g.players[0].liangdao = true;
      g.players[1].liangdao = true;
      await g.settleWin([{ seat: 1, result: r, winTile: 4, fromSeat: 0 }], false, {});
      assert.strictEqual(g.players[0].score, -4, '2 倍牌型 × 输家亮倒翻倍');
      assert.strictEqual(g.players[1].score, 4);

      // 打开「点炮亮倒者相当于自摸」后，点炮者要出两份
      const g2 = new Game({
        speed: 0,
        rules: { baseScore: 1, cap: 8, liangdaoPayDouble: true, liangdaoDianPaoAsZimo: true }
      });
      g2.players[0].liangdao = true;
      g2.players[1].liangdao = true;
      await g2.settleWin([{ seat: 1, result: r, winTile: 4, fromSeat: 0 }], false, {});
      assert.strictEqual(g2.players[0].score, -8, '相当于自摸两份 × 输家亮倒翻倍');
      assert.strictEqual(g2.players[1].score, 8);
    });

    await testAsync('亮倒者自己的屁胡也能捉别人的炮', async () => {
      const pit = H('123456789t 12b 11b');     // 听 3条，屁胡
      const tile = 9 + 3 - 1;

      // 自己没亮倒：屁胡不能捉炮
      const a = R.canWinOnDiscard(pit, [], tile, {
        rules: R.DEFAULT_RULES, liangdao: false, fromLiangdao: false
      });
      assert.strictEqual(a, null, '没亮倒时屁胡不能捉炮');

      // 自己亮倒了：屁胡也能捉任何人的炮
      const b = R.canWinOnDiscard(pit, [], tile, {
        rules: R.DEFAULT_RULES, liangdao: true, fromLiangdao: false
      });
      assert.ok(b, '亮倒后屁胡应该能捉炮');
      assert.strictEqual(b.isPitHu, true);

      // 关掉这条规则后又不行
      const c = R.canWinOnDiscard(pit, [], tile, {
        rules: Object.assign({}, R.DEFAULT_RULES, { liangdaoPitHuCanDianPao: false }),
        liangdao: true, fromLiangdao: false
      });
      assert.strictEqual(c, null, '关掉规则后亮倒的屁胡也不能捉炮');

      // 完整流程：亮倒的玩家应该被询问要不要胡
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g.playing = true;
      g.players[0].isAI = false;
      g.players[0].hand = pit;
      g.players[0].liangdao = true;
      g.players[1].hand = H('147t 258b 369t 11z 22z');
      g.players[2].hand = H('147t 258b 369t 11z 22z');
      let askKind = null;
      g.on('ask', payload => { askKind = payload.kind; if (payload.kind === 'claim') g.submit({ action: 'hu' }); });
      const res = await g.resolveClaims(tile, 1);
      assert.strictEqual(askKind, 'claim', '应该询问亮倒的玩家要不要胡');
      assert.strictEqual(res, 'win');
      assert.strictEqual(g.roundResult.winners[0].result.isPitHu, true);
    });

    await testAsync('AI 亮倒决策：屁胡一般不亮，高番牌才亮', async () => {
      const AIm = require('../js/ai.js');
      const rules = Object.assign({}, R.DEFAULT_RULES);
      const mkView = (hand, wall) => ({
        hand: hand, melds: [], wallCount: wall === undefined ? 30 : wall,
        remain: (() => { const c = new Array(21).fill(4); hand.forEach(t => c[t]--); return c; })(),
        rules: rules
      });

      // 屁胡，嵌张听 3 条（只剩 4 张有效张）
      const pit = mkView(H('123456789t 11b 24b 9b'));
      const pitPlan = AIm.liangdaoPlan(pit);
      assert.ok(pitPlan, '应能算出听牌方案');
      assert.strictEqual(pitPlan.fan, 1, '这是屁胡');
      assert.ok(pitPlan.score <= 0, '屁胡亮倒期望值应为负，实际 ' + pitPlan.score.toFixed(3));
      assert.strictEqual(AIm.shouldLiangdao(pit), false, '屁胡不该亮倒');

      // 清一色九莲听（胡 1-9 筒都行，有效张极多）
      const big = mkView(H('1112345678999t 5t'));
      const bigPlan = AIm.liangdaoPlan(big);
      assert.ok(bigPlan, '应能算出听牌方案');
      assert.ok(bigPlan.fan >= 4, '清一色牌型，实际 ' + bigPlan.fan);
      assert.ok(bigPlan.score > 0, '高番牌亮倒期望值应为正，实际 ' + bigPlan.score.toFixed(3));
      assert.strictEqual(AIm.shouldLiangdao(big), true, '高番牌应该亮倒');
      assert.ok(bigPlan.score > pitPlan.score, '听的越宽、番越高，评分应更高');
    });

    await testAsync('亮倒不再是「一听牌就亮」：屁胡几乎不亮、大胡才考虑', async () => {
      const AIm = require('../js/ai.js');
      const orig = AIm.shouldLiangdao;
      const st = { pitTry: 0, pitYes: 0, bigTry: 0, bigYes: 0 };
      // 直接统计「面对亮倒机会时的决策率」（赢牌里的亮倒占比有选择性偏差，不能用来衡量）
      // 用生产逻辑 liangdaoDecision，保证统计的就是真的会做的决定
      AIm.shouldLiangdao = function (view) {
        const d = AIm.liangdaoDecision(view);
        if (!d) return false;
        if (d.plan.fan === 1) { st.pitTry++; if (d.yes) st.pitYes++; }
        else { st.bigTry++; if (d.yes) st.bigYes++; }
        return d.yes;
      };

      let liangdao = 0, wins = 0;
      try {
        for (let i = 0; i < 30; i++) {
          const g = new Game({ seed: 5000 + i * 977, speed: 0, rules: R.DEFAULT_RULES });
          g.players.forEach(p => { p.isAI = true; });
          let res = null;
          g.on('roundEnd', r => { res = r; });
          await g.startRound();
          if (res && res.type === 'win') {
            wins++;
            res.winners.forEach(w => {
              if (w.result.items.some(it => it.name === '亮倒')) liangdao++;
            });
          }
        }
      } finally {
        AIm.shouldLiangdao = orig;
      }

      const pitRate = st.pitTry ? st.pitYes / st.pitTry : 0;
      const bigRate = st.bigTry ? st.bigYes / st.bigTry : 0;
      console.log('        30 局：亮倒机会 ' + (st.pitTry + st.bigTry) + ' 次 —— ' +
        '屁胡亮倒决策率 ' + (pitRate * 100).toFixed(1) + '% (' + st.pitYes + '/' + st.pitTry + ')，' +
        '大胡 ' + (bigRate * 100).toFixed(0) + '% (' + st.bigYes + '/' + st.bigTry + ')；' +
        '赢牌里亮倒占比 ' + (liangdao / Math.max(1, wins) * 100).toFixed(0) + '%');
      assert.ok(st.pitTry > 50, '样本太少：' + st.pitTry);
      assert.ok(pitRate < 0.03, '屁胡几乎不该亮倒，实际决策率 ' + (pitRate * 100).toFixed(1) + '%');
      assert.ok(bigRate > 0.15, '大胡应该有一部分敢亮倒，实际决策率 ' + (bigRate * 100).toFixed(0) + '%');
      assert.ok(bigRate < 0.8, '也不该逢大胡就亮，实际决策率 ' + (bigRate * 100).toFixed(0) + '%');
      assert.ok(pitRate < bigRate, '屁胡亮倒率应明显低于大胡');
      assert.ok(liangdao / Math.max(1, wins) < 0.4, '多数对局不该有人亮倒，实际 ' +
        (liangdao / Math.max(1, wins) * 100).toFixed(0) + '%');
    });

    await testAsync('亮倒决策会看「剩余抽牌数 / 听张宽度 / 剩余张数 / 放铳风险」', async () => {
      const AIm = require('../js/ai.js');
      const rules = Object.assign({}, R.DEFAULT_RULES);
      const mk = (hand, wall, extras) => Object.assign({
        hand: hand, melds: [], wallCount: wall, seat: 0,
        remain: (() => { const c = new Array(21).fill(4); hand.forEach(t => c[t]--); return c; })(),
        rules: rules
      }, extras || {});

      const hand = H('1112345678999t 5t');   // 清一色九莲听（极宽）

      // ① 剩余抽牌数：牌墙越少，期望值越低
      const early = AIm.liangdaoPlan(mk(hand, 40));
      const late = AIm.liangdaoPlan(mk(hand, 6));
      assert.ok(early.score > late.score,
        '牌墙多的时候应该更值得亮（' + early.score.toFixed(2) + ' vs ' + late.score.toFixed(2) + '）');

      // ② 听张宽度 / ③ 剩余和牌张数：同样的番数，听 9 面 比听 1 面值得多
      const wide = AIm.liangdaoPlan(mk(hand, 30));
      const narrow = AIm.liangdaoPlan(mk(H('123456789t 123b 11b'), 30));
      assert.ok(wide.remainWin > narrow.remainWin, '九莲听的剩余张数应更多');
      assert.ok(wide.pSelfDraw > narrow.pSelfDraw, '听得多自摸概率更高');

      // ④ 放铳风险：对手副露越多（越可能听牌），期望值越低
      const quiet = AIm.liangdaoPlan(mk(hand, 30, { meldsByPlayer: [[], [], []], discards: [[], [], []] }));
      const hot = AIm.liangdaoPlan(mk(hand, 30, {
        meldsByPlayer: [[], [{ kind: 'pong', tile: 18 }, { kind: 'pong', tile: 19 }],
          [{ kind: 'pong', tile: 20 }, { kind: 'pong', tile: 21 }]], discards: [[], [], []]
      }));
      assert.ok(hot.threat > quiet.threat, '对手副露多 → 威胁更大');
      assert.ok(hot.score < quiet.score,
        '对手越像听牌，亮倒期望值越低（' + quiet.score.toFixed(2) + ' vs ' + hot.score.toFixed(2) + '）');
      assert.ok(hot.dianLoss > quiet.dianLoss, '放铳损失应该更大');
    });

    await testAsync('亮倒奖惩机制：赢过该牌型更敢亮，输过更保守（含上下限）', async () => {
      const AIm = require('../js/ai.js');
      const hand = H('1112345678999t 5t');
      const view = {
        hand: hand, melds: [], wallCount: 30, seat: 0,
        remain: (() => { const c = new Array(21).fill(4); hand.forEach(t => c[t]--); return c; })(),
        rules: R.DEFAULT_RULES, liangdaoLearn: AIm.newLearnTable()
      };
      const d0 = AIm.liangdaoDecision(view);
      assert.ok(d0 && d0.plan.key, '应能算出牌型：' + (d0 && d0.plan.key));
      const key = d0.plan.key;
      assert.strictEqual(AIm.learnAdj(view.liangdaoLearn, key), 1, '一开始是中性');
      assert.strictEqual(d0.need, AIm.LIANGDAO.need, '中性时门槛就是基准值');

      // 输了两次 → 倾向下调、门槛抬高（更保守）
      AIm.noteLiangdaoResult(view.liangdaoLearn, key, false);
      AIm.noteLiangdaoResult(view.liangdaoLearn, key, false);
      const adjLose = AIm.learnAdj(view.liangdaoLearn, key);
      const dLose = AIm.liangdaoDecision(view);
      assert.ok(adjLose < 1, '输过之后倾向应 <1，实际 ' + adjLose);
      assert.ok(dLose.need > d0.need, '输过之后门槛更高（更难亮）');

      // 再赢三次 → 倾向回到 >1、门槛低于基准
      for (let i = 0; i < 3; i++) AIm.noteLiangdaoResult(view.liangdaoLearn, key, true);
      const dWin = AIm.liangdaoDecision(view);
      assert.ok(AIm.learnAdj(view.liangdaoLearn, key) > 1, '赢过之后倾向应 >1');
      assert.ok(dWin.need < d0.need, '赢过之后更容易亮');

      // 上下限：不会无限放大/缩小
      for (let i = 0; i < 40; i++) AIm.noteLiangdaoResult(view.liangdaoLearn, key, false);
      assert.strictEqual(AIm.learnAdj(view.liangdaoLearn, key), AIm.LIANGDAO.learnMin, '有下限');
      for (let i = 0; i < 80; i++) AIm.noteLiangdaoResult(view.liangdaoLearn, key, true);
      assert.strictEqual(AIm.learnAdj(view.liangdaoLearn, key), AIm.LIANGDAO.learnMax, '有上限');

      // 战绩也在累计（赢/输次数、亮倒次数）
      const e = AIm.learnSummary(view.liangdaoLearn)[0];
      assert.strictEqual(e.reveal, 125, '亮倒次数应累计，实际 ' + e.reveal);
      assert.strictEqual(e.win + e.lose, e.reveal, '赢+输 = 亮倒次数');
      assert.strictEqual(e.lose, 42, '输了 2 + 40 次');
    });

    await testAsync('奖惩记忆接到牌局上：亮倒赢了上调、输了（含荒庄）下调', async () => {
      const AIm = require('../js/ai.js');
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });

      // 1 号（电脑）用「清一色」亮倒并赢下这一局
      g.players[1].isAI = true;
      g.players[1].liangdao = true;
      g.players[1].liangdaoKey = '清一色';
      g.learnFromLiangdao(s => s === 1);
      const winEntry = g.liangdaoLearn[1].table['清一色'];
      assert.strictEqual(winEntry.win, 1, '赢了一次');
      assert.ok(winEntry.adj > 1, '赢了 → 倾向上调（更敢亮）');

      // 1 号用「七对」亮倒但没赢
      g.players[1].liangdaoKey = '七对';
      g.learnFromLiangdao(() => false);
      const loseEntry = g.liangdaoLearn[1].table['七对'];
      assert.strictEqual(loseEntry.lose, 1, '输了一次');
      assert.ok(loseEntry.adj < 1, '输了 → 倾向下调（更保守）');

      // 玩家自己的亮倒不参与学习（人工决定，不需要电脑那套记忆）
      g.players[0].isAI = false;
      g.players[0].liangdao = true;
      g.players[0].liangdaoKey = '清一色';
      g.learnFromLiangdao(() => true);
      assert.strictEqual(g.liangdaoLearn[0].table['清一色'], undefined, '玩家不该被记录');

      // 没有亮倒的电脑也不记
      g.players[2].liangdao = false;
      g.players[2].liangdaoKey = '清一色';
      g.learnFromLiangdao(() => true);
      assert.strictEqual(g.liangdaoLearn[2].table['清一色'], undefined, '没亮倒不该记');

      // 真打若干局：亮倒过的牌型一定留下了战绩，且倾向在 [min, max] 内
      const g2 = new Game({ seed: 900, speed: 0, rules: R.DEFAULT_RULES });
      g2.players.forEach(p => { p.isAI = true; });
      for (let i = 0; i < 15; i++) await g2.startRound();
      const rows = [];
      [0, 1, 2].forEach(s => AIm.learnSummary(g2.liangdaoLearn[s]).forEach(e => {
        if (e.reveal > 0) rows.push(e);
      }));
      assert.ok(rows.length > 0, '15 局里应该有电脑亮倒过');
      rows.forEach(e => {
        assert.strictEqual(e.win + e.lose, e.reveal, '赢+输 = 亮倒次数：' + JSON.stringify(e));
        assert.ok(e.adj >= AIm.LIANGDAO.learnMin && e.adj <= AIm.LIANGDAO.learnMax,
          '倾向应在 [' + AIm.LIANGDAO.learnMin + ',' + AIm.LIANGDAO.learnMax + ']，实际 ' + e.adj);
      });
      console.log('        15 局亮倒战绩：' +
        rows.map(e => e.key + ' 亮' + e.reveal + ' 赢' + e.win + ' 输' + e.lose +
          ' ×' + e.adj.toFixed(2)).join(' | '));
    });

    await testAsync('碰完牌：只问「要不要亮倒」，绝不能问杠；摸牌后才问杠', async () => {
      let pongAsks = 0, afterPongBadActions = 0, kongsWithoutDraw = 0, pongs = 0;
      for (let i = 0; i < 12; i++) {
        const g = new Game({ seed: 7000 + i * 313, speed: 0, rules: R.DEFAULT_RULES });
        g.players.forEach(p => { p.isAI = p.seat !== 0; });
        g.on('pong', d => { if (d.seat === 0) pongs++; });
        g.on('ask', a => {
          if (a.kind === 'self' && a.seat === 0) {
            const justDrew = g.players[0].lastDraw !== null;
            const types = a.actions.map(x => x.type).sort().join('/');
            const hasKong = types.indexOf('kong') >= 0;
            if (!justDrew) {
              // 碰完之后：只能问亮倒 / 过
              pongAsks++;
              if (types !== 'liangdao/pass' && types !== 'pass') afterPongBadActions++;
            }
            if (hasKong && !justDrew) kongsWithoutDraw++;
          }
          if (a.kind === 'self') g.submit({ type: 'pass' });
          else if (a.kind === 'claim') g.submit({ action: (a.canPong ? 'pong' : 'pass') });
          else g.submit({ type: 'discard', tile: a.allowed[a.allowed.length - 1] });
        });
        await g.startRound();
      }
      assert.ok(pongs > 0, '样本里玩家应该碰过牌，否则测不到这个场景');
      assert.strictEqual(afterPongBadActions, 0,
        afterPongBadActions + ' 次碰完牌后问了「亮倒/过」以外的操作（比如杠）');
      assert.strictEqual(kongsWithoutDraw, 0, '没摸牌时不该问杠');
      console.log('        12 局：玩家碰牌 ' + pongs + ' 次，碰后亮倒询问 ' + pongAsks +
        ' 次，其中含非法操作的 ' + afterPongBadActions + ' 次');
    });

    await testAsync('碰完之后：能听牌时会问亮倒，但不会弹杠', async () => {
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g.playing = true;
      const p0 = g.players[0];
      p0.isAI = false;
      // 碰 1筒 之后就能听牌（丢掉 9条 单骑）
      p0.hand = H('11t 123t 456t 789t 99b');
      g.players[2].discards = [H('1t')[0]];
      g.players[1].hand = H('147b 258b 369b 11z 22z');
      g.players[2].hand = H('147b 258b 369b 11z 22z');

      let ask = null;
      g.on('ask', a => { ask = a; if (a.kind === 'claim') g.submit({ action: 'pong' }); });
      const claim = await g.resolveClaims(H('1t')[0], 2);
      assert.deepStrictEqual(claim, { type: 'pong', seat: 0 }, '玩家应该碰');
      assert.strictEqual(p0.hand.length, 11, '碰完手上应剩 11 张');
      assert.strictEqual(p0.melds.length, 1, '碰完应有 1 副露');

      // 碰完之后主循环会走一遍自身操作询问：应该只问亮倒/过
      let selfAsk = null;
      g.on('ask', a => { selfAsk = a; });
      const pr = g.selfPhase(0, {});
      assert.ok(selfAsk && selfAsk.kind === 'self', '碰完应该问一次自身操作');
      const types = selfAsk.actions.map(a => a.type).sort();
      assert.deepStrictEqual(types, ['liangdao', 'pass'].sort(),
        '碰完只能问亮倒/过，实际 ' + types.join('/'));
      assert.ok(selfAsk.preview && selfAsk.preview.allowed,
        '亮倒询问里应带上「可以打哪些牌」的预览（这样玩家能直接点牌出牌）');
      g.submit({ type: 'pass' });
      await pr;
    });

    await testAsync('听牌是私有信息：对手没亮倒时快照里不暴露', async () => {
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g.playing = true;
      g.players[0].hand = H('123456789t 12b 11b');     // 玩家听牌
      g.players[1].hand = H('123456789b 12t 11t');     // 下家也听牌，但没亮倒
      g.players[2].hand = H('147t 258b 369b 11z 22z');
      const snap = g.snapshot();
      assert.strictEqual(snap.players[0].tenpai, true, '自己的听牌应该知道');
      assert.strictEqual(snap.players[1].tenpai, false, '别人没亮倒不该被看出听牌');

      g.players[1].liangdao = true;                    // 亮倒后手牌公开，听牌也就无所谓了
      const snap2 = g.snapshot();
      assert.strictEqual(snap2.players[1].tenpai, true, '亮倒的对手可以显示听牌');
    });

    await testAsync('亮倒的人打出的牌，屁胡也能胡', async () => {
      const pit = H('123456789t 12b 11b');             // 听 3条，屁胡
      const tile = 9 + 3 - 1;

      // 普通对手打出：屁胡不能胡
      const a = R.canWinOnDiscard(pit, [], tile, { rules: R.DEFAULT_RULES, fromLiangdao: false });
      assert.strictEqual(a, null, '普通对手打出，屁胡不能捉炮');

      // 亮倒的对手打出：屁胡可以胡
      const b = R.canWinOnDiscard(pit, [], tile, { rules: R.DEFAULT_RULES, fromLiangdao: true });
      assert.ok(b, '亮倒的人打出的牌，屁胡应该能胡');
      assert.strictEqual(b.isPitHu, true);

      // 关掉这条规则后又不给胡
      const c = R.canWinOnDiscard(pit, [], tile, {
        rules: Object.assign({}, R.DEFAULT_RULES, { liangdaoDiscardPitHu: false }),
        fromLiangdao: true
      });
      assert.strictEqual(c, null, '关掉规则后应恢复「屁胡不能捉炮」');

      // 走一遍完整流程：亮倒的下家打出 3条 -> 玩家应被询问「胡」
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g.playing = true;
      g.players[0].isAI = false;
      g.players[0].hand = pit;
      g.players[1].hand = H('147t 258b 369t 11z 22z');
      g.players[1].liangdao = true;
      g.players[2].hand = H('147t 258b 369t 11z 22z');
      let askKind = null;
      g.on('ask', payload => {
        askKind = payload.kind;
        if (payload.kind === 'claim') g.submit({ action: 'hu' });
      });
      const r = await g.resolveClaims(tile, 1);
      assert.strictEqual(askKind, 'claim', '应该询问玩家要不要胡');
      assert.strictEqual(r, 'win');
      const w = g.roundResult.winners[0];
      assert.strictEqual(w.seat, 0);
      assert.strictEqual(w.result.isPitHu, true, '这确实是个屁胡');
      // 亮倒者点炮要赔双倍 → 屁胡 ×1 也被赔两份
      assert.strictEqual(g.players[0].score, 2, '屁胡 ×1，但亮倒的下家点炮要赔双倍');
      assert.strictEqual(g.players[1].score, -2);
    });

    await testAsync('亮倒后只能摸打：只允许打出刚摸的那张，听张锁死', async () => {
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g.playing = true;
      const p0 = g.players[0];
      p0.hand = H('123456789t 12b 11b 9b');      // 听 2条/3条，刚摸到 9条
      p0.lastDraw = H('9b')[0];
      p0.liangdao = true;
      p0.liangdaoFresh = false;                   // 不是宣告那一手了
      let ask = null;
      g.on('ask', a => { ask = a; });
      const pr = g.discardPhase(0);
      assert.ok(ask, '应该问玩家出牌');
      assert.deepStrictEqual(ask.allowed, [H('9b')[0]], '只能打刚摸的 9条');
      assert.strictEqual(ask.locked, true, '应标记为「已亮倒·只能摸打」');
      g.submit({ type: 'discard', tile: H('9b')[0] });
      await pr;
      assert.deepStrictEqual(p0.hand, H('123456789t 12b 11b'), '打完还是原来那手听牌，听张没变');

      // 关掉这条规则后又能自由出牌了
      const g2 = new Game({ speed: 0, rules: Object.assign({}, R.DEFAULT_RULES, { liangdaoLockHand: false }) });
      g2.playing = true;
      const q0 = g2.players[0];
      q0.hand = H('123456789t 12b 11b 9b');
      q0.lastDraw = H('9b')[0];
      q0.liangdao = true;
      q0.liangdaoFresh = false;
      let ask2 = null;
      g2.on('ask', a => { ask2 = a; });
      const pr2 = g2.discardPhase(0);
      assert.ok(ask2.allowed.length > 1, '关掉锁定后应能选择多张');
      assert.strictEqual(ask2.locked, false);
      g2.submit({ type: 'discard', tile: ask2.allowed[0] });
      await pr2;
    });

    await testAsync('亮倒之后不能碰、不能直杠（但可以胡）', async () => {
      const mk = (liangdao) => {
        const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
        g.playing = true;
        const p0 = g.players[0];
        p0.isAI = true;                            // 让电脑自己决定，但它不该拿到碰的选项
        // 手上有两个 1筒可以碰；但加上 1筒并不成和，避免撞上「亮倒屁胡可胡」
        p0.hand = H('11t 234t 567t 99t 2b 5b 7b');
        p0.liangdao = liangdao;
        g.players[1].hand = H('147b 258b 369b 11z 22z');
        g.players[2].hand = H('147b 258b 369b 11z 22z');
        g.players[2].discards = [H('1t')[0]];
        return g;
      };
      assert.strictEqual(R.canWinOnDiscard(H('11t 234t 567t 99t 2b 5b 7b'), [], H('1t')[0], {
        rules: R.DEFAULT_RULES, liangdao: true, fromLiangdao: false
      }), null, '这手牌本就不该能胡 1筒');

      const normal = mk(false);
      const r1 = await normal.resolveClaims(H('1t')[0], 2);
      assert.ok(r1 && r1.type === 'pong' && r1.seat === 0, '没亮倒时可以碰');

      const ld = mk(true);
      const r2 = await ld.resolveClaims(H('1t')[0], 2);
      assert.strictEqual(r2, null, '亮倒之后不能碰');
    });

    await testAsync('不许故意放铳：亮倒者的听张打不出去', async () => {
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g.playing = true;
      const p0 = g.players[0];
      p0.isAI = false;
      // 手里有 2条、3条（下家亮倒的听张）和一堆安全牌
      p0.hand = H('11t 234t 567t 99t 2b 3b 5b 7b');
      const p1 = g.players[1];
      p1.liangdao = true;
      p1.hand = H('123456789t 12b 11b');          // 听 2条 / 3条
      g.players[2].hand = H('147t 258b 369t 11z 22z');

      const banned = g.dangerousDiscards(0);
      assert.ok(banned[H('3b')[0]], '3条 应被标记为危险张');
      assert.ok(banned[H('2b')[0]], '2条 应被标记为危险张');
      assert.strictEqual(banned[H('5b')[0]], undefined, '5条 是安全的');
      assert.strictEqual(banned[H('1t')[0]], undefined, '一筒 是安全的');

      let ask = null;
      g.on('ask', a => { ask = a; });
      const pr = g.discardPhase(0);
      assert.ok(ask, '应询问出牌');
      assert.ok(ask.banned.indexOf(H('3b')[0]) >= 0, '危险张应在 banned 列表里');
      assert.ok(ask.allowed.indexOf(H('3b')[0]) < 0, '危险张不该允许打出');
      assert.ok(ask.allowed.indexOf(H('2b')[0]) < 0, '危险张不该允许打出');
      assert.ok(ask.allowed.length > 0 && ask.allowed.length < p0.hand.length,
        '应只剩安全牌可打，实际 ' + ask.allowed.length + '/' + p0.hand.length);
      assert.strictEqual(ask.forced, false);
      g.submit({ type: 'discard', tile: ask.allowed[0] });
      await pr;
    });

    await testAsync('迫不得已：手里全是亮倒者的听张时只能放铳', async () => {
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g.playing = true;
      const p0 = g.players[0];
      p0.isAI = false;
      // 下家亮倒的是九莲宝灯型，1-9 筒全听；玩家手上全是筒，怎么打都是放铳
      p0.hand = H('2233445566778t');
      const p1 = g.players[1];
      p1.liangdao = true;
      p1.hand = H('1112345678999t');
      g.players[2].hand = H('147b 258b 369b 11z 22z');

      const banned = g.dangerousDiscards(0);
      const distinctHand = Array.from(new Set(p0.hand));
      assert.strictEqual(Object.keys(banned).length, distinctHand.length,
        '手上每一种牌都该是危险张（' + distinctHand.length + ' 种），实际 ' + Object.keys(banned).length);

      let ask = null;
      g.on('ask', a => { ask = a; });
      const pr = g.discardPhase(0);
      assert.strictEqual(ask.forced, true, '手里全是危险张，应标记为迫不得已');
      assert.ok(ask.allowed.length > 0, '迫不得已时必须允许出牌');
      g.submit({ type: 'discard', tile: ask.allowed[0] });
      await pr;
      assert.ok(g.log.some(l => l.text.indexOf('被迫打出') >= 0), '应记录被迫放铳');
    });

    await testAsync('关掉「不许放铳」后可自由打危险张', async () => {
      const g = new Game({
        speed: 0,
        rules: Object.assign({}, R.DEFAULT_RULES, { noDealInLiangdao: false })
      });
      g.playing = true;
      const p0 = g.players[0];
      p0.isAI = false;
      p0.hand = H('11t 234t 567t 99t 3b 5b 7b 9b');
      g.players[1].liangdao = true;
      g.players[1].hand = H('123456789t 12b 11b');
      g.players[2].hand = H('147t 258b 369t 11z 22z');
      let ask = null;
      g.on('ask', a => { ask = a; });
      const pr = g.discardPhase(0);
      assert.strictEqual(ask.banned.length, 0, '关掉后不该有危险张限制');
      assert.strictEqual(ask.allowed.length, p0.hand.length, '所有手牌都能打');
      g.submit({ type: 'discard', tile: H('3b')[0] });
      await pr;
    });

    await testAsync('荒局：亮倒的人要赔听牌者（按对方牌型番数）', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8 } });
      g.wall = [];
      g.players[0].hand = H('123456789t 12b 11b');   // 听 2条/3条，屁胡 1 番
      g.players[1].hand = H('123456789b 12t 11t');   // 听 2筒/3筒，屁胡 1 番
      g.players[2].hand = H('123456789b 12t 11t');
      g.players[0].liangdao = true;                  // 只有 0 号亮倒了
      const res = g.finishHuangzhuang();
      assert.strictEqual(res.type, 'huang');
      // 三家都听牌 -> 没有「未听赔听」；只有亮倒者赔其他两家各 1 分
      assert.strictEqual(res.pays.length, 2, '应有 2 笔亮倒赔付，实际 ' + res.pays.length);
      assert.deepStrictEqual(g.players.map(p => p.score), [-2, 1, 1]);
    });

    await testAsync('荒局：未听牌者不必再赔给亮倒者', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8 } });
      g.wall = [];
      g.players[0].hand = H('123456789t 12b 11b');      // 唯一听牌的人还亮倒了
      g.players[0].liangdao = true;
      g.players[1].hand = H('147t 258b 369b 11z 22z');  // 未听
      g.players[2].hand = H('147t 258b 369b 11z 22z');  // 未听
      const res = g.finishHuangzhuang();
      assert.strictEqual(res.pays.length, 0, '未听牌者不用赔亮倒者，也不该有别的赔付');
      assert.deepStrictEqual(g.players.map(p => p.score), [0, 0, 0]);
    });

    await testAsync('荒局：打开开关后未听牌者仍赔亮倒者（收赔番数 ×2）', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8, huangzhuangPeiToLiangdao: true } });
      g.wall = [];
      g.players[0].hand = H('123456789t 12b 11b');
      g.players[0].liangdao = true;
      g.players[1].hand = H('147t 258b 369b 11z 22z');
      g.players[2].hand = H('147t 258b 369b 11z 22z');
      g.finishHuangzhuang();
      // 1、2 各赔 0 号 1×2（亮倒收赔翻倍）= 2 → 0 号 +4
      assert.deepStrictEqual(g.players.map(p => p.score), [4, -2, -2]);
    });

    await testAsync('荒局：未听牌者只赔没亮倒的听牌者', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8 } });
      g.wall = [];
      g.players[0].hand = H('123456789t 12b 11b');       // 听牌 + 亮倒
      g.players[0].liangdao = true;
      g.players[1].hand = H('123456789b 12t 11t');       // 听牌，没亮倒
      g.players[2].hand = H('147t 258b 369b 11z 22z');   // 未听
      g.finishHuangzhuang();
      // 未听的 2 只赔没亮倒的听牌者 1（1 分），不赔亮倒的 0
      // 亮倒的 0 赔其他听牌者 1（1 分）
      assert.deepStrictEqual(g.players.map(p => p.score), [-1, 2, -1]);
    });

    await testAsync('荒局：三家都听牌且无人亮倒 -> 互不赔付', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8 } });
      g.wall = [];
      g.players[0].hand = H('123456789t 12b 11b');
      g.players[1].hand = H('123456789b 12t 11t');
      g.players[2].hand = H('123456789b 12t 11t');
      const res = g.finishHuangzhuang();
      assert.strictEqual(res.pays.length, 0, '不该有任何赔付');
      assert.deepStrictEqual(g.players.map(p => p.score), [0, 0, 0]);
      assert.ok(g.log.some(l => l.text.indexOf('互不赔付') >= 0), '应给出提示');
    });

    await testAsync('杠分倍数：加杠链 1→2→4，暗杠链 2→4→8（每杠单独结算）', async () => {
      // 加杠（碰后补杠）：底 1 倍，杠上杠从第二杠起翻倍
      const g = new Game({ speed: 0, rules: { baseScore: 1 } });
      g.players[0].hand = [4, 5, 6];
      g.players[0].melds = [{ kind: 'pong', tile: 4 }, { kind: 'pong', tile: 5 }, { kind: 'pong', tile: 6 }];
      await g.doKong(0, 4, 'mingkong', null);
      assert.deepStrictEqual(g.players.map(p => p.score), [2, -1, -1], '第一杠：每家 1 倍');
      await g.doKong(0, 5, 'mingkong', null);
      assert.deepStrictEqual(g.players.map(p => p.score), [6, -3, -3], '第二杠：每家 2 倍（杠上杠）');
      await g.doKong(0, 6, 'mingkong', null);
      assert.deepStrictEqual(g.players.map(p => p.score), [14, -7, -7], '第三杠：每家 4 倍');

      // 暗杠：底 2 倍，杠上杠第二杠 4 倍、第三杠 8 倍
      const g2 = new Game({ speed: 0, rules: { baseScore: 1 } });
      g2.players[0].hand = [4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];
      await g2.doKong(0, 4, 'ankong', null);
      assert.deepStrictEqual(g2.players.map(p => p.score), [4, -2, -2], '第一暗杠：每家 2 倍');
      await g2.doKong(0, 5, 'ankong', null);
      assert.deepStrictEqual(g2.players.map(p => p.score), [12, -6, -6], '第二杠：每家 4 倍');
      await g2.doKong(0, 6, 'ankong', null);
      assert.deepStrictEqual(g2.players.map(p => p.score), [28, -14, -14], '第三杠：每家 8 倍');
    });

    await testAsync('杠上炮：屁胡也能胡，且番数和 = 第几杠 × 2', async () => {
      const pit = H('123456789t 12b 11b');       // 听 3条，屁胡
      const tile = 9 + 3 - 1;

      // 普通出牌：屁胡不能胡
      assert.strictEqual(R.canWinOnDiscard(pit, [], tile, {
        rules: R.DEFAULT_RULES, gangPao: false
      }), null, '普通出牌屁胡不能捉炮');

      const gp1 = R.canWinOnDiscard(pit, [], tile, {
        rules: R.DEFAULT_RULES, gangPao: true, gangPaoIndex: 1
      });
      assert.ok(gp1, '杠上炮屁胡也该能胡');
      assert.strictEqual(gp1.isPitHu, true);
      assert.strictEqual(gp1.fan, 2, '第 1 杠杠上炮：番数和 2（不是 1+2=3）');

      const gp2 = R.canWinOnDiscard(pit, [], tile, {
        rules: R.DEFAULT_RULES, gangPao: true, gangPaoIndex: 2
      });
      assert.strictEqual(gp2.fan, 4, '第 2 杠杠上炮：番数和 4');

      const gp3 = R.canWinOnDiscard(pit, [], tile, {
        rules: R.DEFAULT_RULES, gangPao: true, gangPaoIndex: 3
      });
      assert.strictEqual(gp3.fan, 6, '第 3 杠杠上炮：番数和 6');

      // 关掉开关后又不能胡了
      assert.strictEqual(R.canWinOnDiscard(pit, [], tile, {
        rules: Object.assign({}, R.DEFAULT_RULES, { gangPaoPitHu: false }),
        gangPao: true, gangPaoIndex: 1
      }), null, '关掉 gangPaoPitHu 后杠上炮屁胡也不能胡');

      // 走一遍完整结算：底金 2、第 2 杠、屁胡 => 2 × 4 = 8
      const g = new Game({ speed: 0, rules: { baseScore: 2, cap: 8 } });
      const res = R.canWinOnDiscard(pit, [], tile, {
        rules: g.rules, gangPao: true, gangPaoIndex: 2
      });
      await g.settleWin([{ seat: 1, result: res, winTile: tile, fromSeat: 0 }], false, { gangPao: true });
      assert.strictEqual(g.players[1].score, 8, '番数和 4 × 底金 2 = 8');
      assert.strictEqual(g.players[0].score, -8);
      // 底金 5、第 1 杠、屁胡 => 5 × 2 = 10（用户报的那个例子）
      const g5 = new Game({ speed: 0, rules: { baseScore: 5, cap: 8 } });
      const res5 = R.canWinOnDiscard(pit, [], tile, {
        rules: g5.rules, gangPao: true, gangPaoIndex: 1
      });
      await g5.settleWin([{ seat: 1, result: res5, winTile: tile, fromSeat: 0 }], false, { gangPao: true });
      assert.strictEqual(g5.players[1].score, 10, '底金 5 × 杠上炮 2 = 10');
      assert.strictEqual(g5.players[0].score, -10);

      // 杠上炮是乘算：清一色 4 × 第 1 杠 2 = 8 倍，底金 5 => 40
      const qy = H('123t 456t 789t 123t 22t');
      const qyTile = H('3t')[0];
      const qyHand = qy.slice();
      qyHand.splice(qyHand.indexOf(qyTile), 1);
      const gq = new Game({ speed: 0, rules: { baseScore: 5, cap: 8 } });
      const resQy = R.canWinOnDiscard(qyHand, [], qyTile, {
        rules: gq.rules, gangPao: true, gangPaoIndex: 1
      });
      assert.ok(resQy && resQy.items.some(i => i.name === '清一色'), '应是清一色');
      assert.strictEqual(resQy.capped, 8, '清一色 4 × 杠上炮 2 = 8 倍');
      await gq.settleWin([{ seat: 1, result: resQy, winTile: qyTile, fromSeat: 0 }], false, { gangPao: true });
      assert.strictEqual(gq.players[1].score, 40, '底金 5 × 8 = 40');
      assert.strictEqual(gq.players[0].score, -40);
    });

    await testAsync('只有加杠能被抢杠：暗杠、直杠都抢不了', async () => {
      const mk = () => {
        const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
        g.playing = true;
        g.players[1].hand = H('123t 46t 789t 555b 22b');   // 听 5筒（卡五星）
        g.players[2].hand = H('147t 258b 369b 11z 22z');
        return g;
      };

      // 暗杠：抢不了
      const g1 = mk();
      g1.players[0].hand = [4, 4, 4, 4];
      const r1 = await g1.doKong(0, 4, 'ankong', null);
      assert.strictEqual(r1, false, '暗杠不能被抢杠');
      assert.ok(!g1.roundResult || g1.roundResult.type !== 'win', '不该结算胡牌');

      // 补杠：能抢（已有专门用例，这里再确认一次能抢）
      const g2 = mk();
      g2.players[0].hand = [4];
      g2.players[0].melds = [{ kind: 'pong', tile: 4 }];
      const r2 = await g2.doKong(0, 4, 'mingkong', null);
      assert.strictEqual(r2, true, '补杠可以被抢杠');
      assert.strictEqual(g2.roundResult.winners[0].seat, 1);
    });

    await testAsync('杠上炮流程：开杠后打出的牌，屁胡能胡并带对应倍数', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8 } });
      g.playing = true;
      // 座位 2 暗杠一张，然后打出 3条 给座位 0（屁胡听牌）
      g.players[0].isAI = false;
      g.players[0].hand = H('123456789t 12b 11b');     // 听 3条
      g.players[1].hand = H('147t 258b 369t 11z 22z');
      g.players[2].hand = [4, 4, 4, 4];                // 占位，暗杠用
      await g.doKong(2, 4, 'ankong', null);            // gangChain = 1
      assert.strictEqual(g.turnHadKong, true);
      assert.strictEqual(g.turnKongIndex, 1);

      g.players[1].hand = H('147t 258b 369t 11z 22z');
      let askKind = null, huResult = null;
      g.on('ask', a => {
        askKind = a.kind;
        huResult = a.huResult;
        if (a.kind === 'claim' && a.canHu) g.submit({ action: 'hu' });
        else if (a.kind === 'claim') g.submit({ action: 'pass' });
      });
      const tile = 9 + 3 - 1;
      const r = await g.resolveClaims(tile, 2);
      assert.strictEqual(askKind, 'claim', '屁胡听牌应该被询问要不要胡（杠上炮例外）');
      assert.ok(huResult && huResult.items.some(i => i.name === '杠上炮'),
        '应带杠上炮番型：' + JSON.stringify(huResult && huResult.items));
      assert.strictEqual(huResult.capped, 2, '番数和 2（杠上炮 2，屁胡的底 1 不再另加）');
      assert.strictEqual(r, 'win');
    });

    await testAsync('亮倒后仍然可以暗杠 / 补杠 / 直杠，但不能碰', async () => {
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g.playing = true;
      g.wall = [1, 2, 3];
      const p0 = g.players[0];
      p0.isAI = false;
      p0.liangdao = true;
      // 手里 4 张 5筒 -> 可暗杠
      p0.hand = H('5555t 123b 456b 78b 22t');
      p0.lastDraw = H('5t')[0];
      let acts = g.selfActions(0, {});
      assert.ok(acts.some(a => a.type === 'ankong' && a.tile === H('5t')[0]),
        '亮倒后应能暗杠：' + acts.map(a => a.type).join('/'));

      // 碰过 5筒，手里又摸到一张 -> 可补杠
      p0.melds = [{ kind: 'pong', tile: H('5t')[0] }];
      p0.hand = H('5t 123b 456b 789b 22t 34b');
      p0.lastDraw = H('5t')[0];
      acts = g.selfActions(0, {});
      assert.ok(acts.some(a => a.type === 'addkong' && a.tile === H('5t')[0]),
        '亮倒后应能补杠：' + acts.map(a => a.type).join('/'));

      // 别人打出第 4 张 -> 可直杠
      const g2 = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g2.playing = true;
      g2.wall = [1, 2, 3];
      const q0 = g2.players[0];
      q0.isAI = true;
      q0.liangdao = true;
      q0.hand = H('555t 123b 456b 789b 2t');   // 手里三张 5筒
      g2.players[1].hand = H('147b 258b 369b 11z 22z');
      g2.players[2].hand = H('147b 258b 369b 11z 22z');
      g2.players[2].discards = [H('5t')[0]];
      const claim = await g2.resolveClaims(H('5t')[0], 2);
      assert.ok(claim && claim.type === 'kong' && claim.seat === 0,
        '亮倒后应能直杠，实际 ' + JSON.stringify(claim));

      // 但手上两张相同的牌不能碰
      const g3 = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g3.playing = true;
      g3.wall = [1, 2, 3];
      const r0 = g3.players[0];
      r0.isAI = true;
      r0.liangdao = true;
      // 两张 5筒可以碰；但加上 5筒并不成和（免得撞上「亮倒者屁胡可胡」）
      r0.hand = H('55t 123b 456b 789b 2t 4t');
      g3.players[1].hand = H('147b 258b 369b 11z 22z');
      g3.players[2].hand = H('147b 258b 369b 11z 22z');
      g3.players[2].discards = [H('5t')[0]];
      const claim3 = await g3.resolveClaims(H('5t')[0], 2);
      assert.strictEqual(claim3, null, '亮倒后不能碰');
    });

    await testAsync('亮倒只公开「能凑成赢牌的关联牌」', async () => {
      const g = new Game({ speed: 0, rules: R.DEFAULT_RULES });

      // 听 2/5/8 的三面听：只需亮出 34567
      assert.deepStrictEqual(
        R.revealTiles(H('11134567999t 11z'), []), H('34567t'),
        '例1：应只亮 34567');

      // 听 6/9：只需亮出 78
      assert.deepStrictEqual(
        R.revealTiles(H('1223345578t 111z'), []), H('78t'),
        '例2：应只亮 78');

      // 七对亮 1 张、龙七对亮 3 张、双龙七对亮 5 张（单骑离得远 = 纯七对型）
      assert.strictEqual(R.revealTiles(H('112233445566t 9t'), []).length, 1, '七对亮 1 张');
      assert.strictEqual(R.revealTiles(H('1111t 22334455t 9t'), []).length, 3, '龙七对亮 3 张');
      assert.strictEqual(R.revealTiles(H('1111t 2222t 3344t 9t'), []).length, 5, '双龙七对亮 5 张');

      // 单骑只亮那一张
      assert.deepStrictEqual(
        R.revealTiles(H('123456789t 111b 5t'), []), [H('5t')[0]],
        '单骑应只亮那一张');

      // 亮出的牌一定是手里的子集，且不含被藏起来的牌
      const hand = H('11134567999t 11z');
      const rev = R.revealTiles(hand, []);
      const left = hand.slice();
      rev.forEach(function (t) { left.splice(left.indexOf(t), 1); });
      assert.ok(left.length > 0, '应该有藏起来的牌');

      // 游戏里：亮倒玩家对外公开的就是这几张
      const g2 = new Game({ speed: 0, rules: R.DEFAULT_RULES });
      g2.playing = true;
      const p0 = g2.players[0];
      p0.liangdao = true;
      p0.liangdaoReveal = null;
      p0.hand = H('123456789t 12b 11b');
      p0.lastDraw = H('9b')[0];
      const pub = g2.publicHand(0);
      assert.ok(pub.length < p0.hand.length, '只公开一部分，实际 ' + pub.length);
      assert.ok(R.isTenpai(p0.hand.slice(0, 13), []), '这手牌本身是听牌的');

      // 打完一张后锁定，新摸的牌也不公开
      p0.liangdaoReveal = pub.slice();
      p0.hand = H('123456789t 12b 11b 7t');
      p0.lastDraw = H('7t')[0];
      assert.deepStrictEqual(g2.publicHand(0), pub, '锁定后公开的仍是那几张');

      // 没亮倒的玩家不公开
      assert.strictEqual(g2.publicHand(1), null);
    });

    await testAsync('把 pitHuOnlyZimo 关掉后，同一张牌就能捉炮胡了', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, pitHuOnlyZimo: false } });
      g.playing = true;
      g.players[0].isAI = false;
      g.players[0].hand = H('123456789t 12b 11b');
      g.players[1].hand = H('147t 258b 369t 11z 22z');
      g.players[2].hand = H('147t 258b 369t 11z 22z');
      // 注意：ask 事件在 resolveClaims 内部同步触发，必须先挂监听
      g.on('ask', payload => { if (payload.kind === 'claim') g.submit({ action: 'hu' }); });
      const r = await g.resolveClaims(9 + 3 - 1, 1);
      assert.strictEqual(r, 'win');
      assert.strictEqual(g.roundResult.winners[0].seat, 0);
      assert.strictEqual(g.roundResult.winners[0].result.isPitHu, true);
    });
  })();

  /* ------------------------------------------------------------------ */
  group('对局记录 / 统计');

  await (async () => {
    await testAsync('记录的每局输赢零和，累计分数与玩家分数一致', async () => {
      const g = new Game({ seed: 31337, speed: 0, rules: R.DEFAULT_RULES });
      g.players.forEach(p => { p.isAI = true; });
      let ends = 0;
      g.on('roundEnd', () => { ends++; });

      for (let i = 0; i < 8; i++) await g.startRound();

      assert.strictEqual(g.history.length, 8, '应记录 8 局');
      assert.strictEqual(ends, 8, 'roundEnd 应触发 8 次');

      let cumulative = [0, 0, 0];
      g.history.forEach((h, idx) => {
        assert.strictEqual(h.round, idx + 1, '局号应连续');
        const sum = h.deltas.reduce((a, b) => a + b, 0);
        assert.strictEqual(sum, 0, '第 ' + h.round + ' 局输赢应零和，实际 ' + sum);
        h.deltas.forEach((d, k) => { cumulative[k] += d; });
        h.scores.forEach((s, k) => {
          assert.strictEqual(s, cumulative[k],
            '第 ' + h.round + ' 局玩家 ' + k + ' 的累计分应为 ' + cumulative[k] + '，记录里是 ' + s);
        });
        assert.ok(h.type === 'win' || h.type === 'huang');
        if (h.type === 'win') assert.ok(h.winners.length > 0, '胡牌局应有赢家');
      });
      g.players.forEach((p, k) => {
        assert.strictEqual(p.score, cumulative[k], '最终分数应与记录累计一致');
      });
    });

    await testAsync('战绩汇总：局数 / 胡牌 / 胜率 / 总分 自洽', async () => {
      const Stats = require('../js/stats.js');
      const g = new Game({ seed: 909, speed: 0, rules: R.DEFAULT_RULES });
      g.players.forEach(p => { p.isAI = true; });
      for (let i = 0; i < 10; i++) await g.startRound();

      const st = Stats.summary(g.players, g.history);
      assert.strictEqual(st.length, 3);
      let totalWins = 0;
      st.forEach(s => {
        assert.strictEqual(s.rounds, g.history.length, '局数应等于历史条数');
        assert.ok(s.wins <= s.rounds, '胡牌数不应超过局数');
        assert.strictEqual(s.selfDraw + s.dianPao, s.wins, '自摸 + 捉炮 应等于胡牌数');
        assert.ok(Math.abs(s.winRate - s.wins / s.rounds) < 1e-9, '胜率 = 胡牌 / 局数');
        assert.strictEqual(s.score, g.players[s.seat].score, '总分应与玩家分数一致');
        totalWins += s.wins;
      });
      const winRounds = g.history.filter(h => h.type === 'win').length;
      const doubleWins = g.history.filter(h => h.type === 'win' && h.winners.length > 1).length;
      assert.strictEqual(totalWins, winRounds + doubleWins,
        '胡牌次数应等于胡牌局数 + 一炮双响多出来的那次');
    });

    await testAsync('折线图数据：每位玩家一条线，点数 = 局数 + 1，起点为 0', async () => {
      const Stats = require('../js/stats.js');
      const g = new Game({ seed: 555, speed: 0, rules: R.DEFAULT_RULES });
      g.players.forEach(p => { p.isAI = true; });
      for (let i = 0; i < 6; i++) await g.startRound();

      const lines = Stats.seriesData(g.players, g.history);
      assert.strictEqual(lines.length, 3, '三个玩家三条线');
      lines.forEach(ln => {
        assert.strictEqual(ln.points.length, g.history.length + 1, '点数应为局数 + 1');
        assert.strictEqual(ln.points[0], 0, '起点应为 0');
        assert.strictEqual(ln.points[ln.points.length - 1],
          g.players[lines.indexOf(ln)].score, '终点应等于当前总分');
        assert.ok(ln.color, '应分配颜色');
      });
    });

    await testAsync('新对局会清空记录与分数', async () => {
      const g = new Game({ seed: 77, speed: 0, rules: R.DEFAULT_RULES });
      g.players.forEach(p => { p.isAI = true; });
      for (let i = 0; i < 3; i++) await g.startRound();
      assert.ok(g.history.length > 0);
      g.newMatch();
      assert.strictEqual(g.history.length, 0, '记录应清空');
      assert.ok(g.players.every(p => p.score === 0), '分数应清零');
      assert.strictEqual(g.roundNo, 0, '局数应归零');
    });

    await testAsync('荒庄也会记一条记录（带听牌信息）', async () => {
      const g = new Game({ speed: 0, rules: { baseScore: 1, cap: 8 } });
      g.wall = [];
      g.players[0].hand = H('123456789t 12b 11b');
      g.players[1].hand = H('147t 258b 369b 11z 22z');
      g.players[2].hand = H('147t 258b 369b 11z 22z');
      g._scoreBefore = [0, 0, 0];
      g.finishHuangzhuang();
      assert.strictEqual(g.history.length, 1);
      const h = g.history[0];
      assert.strictEqual(h.type, 'huang');
      assert.deepStrictEqual(h.tenpai, [true, false, false], '应记录各家是否听牌');
      assert.strictEqual(h.deltas.reduce((a, b) => a + b, 0), 0, '输赢零和');
    });
  })();

  /* ------------------------------------------------------------------ */
  console.log('\n----------------------------------------');
  console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  if (failed) {
    console.log('\n失败明细：');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
