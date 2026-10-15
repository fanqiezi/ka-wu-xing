/*
 * 卡五星规则引擎自测
 * 运行： node tests/rules.test.js
 */
'use strict';

const assert = require('assert');
const T = require('../js/tiles.js');
const R = require('../js/rules.js');

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  \u2717 ' + name + '\n        ' + e.message); }
}
function group(name) { console.log('\n' + name); }

/** 牌面简记： '123456789t 123b 111z'  t=筒 b=条 z=字(1中2发3白) */
function H(str) {
  const out = [];
  const parts = String(str).trim().split(/\s+/);
  for (const part of parts) {
    const m = /^([0-9]+)([tbz])$/.exec(part);
    if (!m) throw new Error('bad tile notation: ' + part);
    const suit = m[2];
    for (const ch of m[1]) {
      const n = parseInt(ch, 10);
      if (suit === 't') out.push(n - 1);
      else if (suit === 'b') out.push(9 + n - 1);
      else out.push(17 + n);
    }
  }
  return T.sorted(out);
}

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ================================================================= */
group('牌张 / 牌墙');

test('牌墙 84 张，每种恰好 4 张', () => {
  const wall = T.makeWall();
  assert.strictEqual(wall.length, 84);
  const c = T.countsOf(wall);
  assert.strictEqual(c.length, 21);
  for (let i = 0; i < 21; i++) assert.strictEqual(c[i], 4, 'tile ' + i);
});

test('牌名正确', () => {
  assert.strictEqual(T.nameOf(0), '一筒');
  assert.strictEqual(T.nameOf(4), '五筒');
  assert.strictEqual(T.nameOf(9), '一条');
  assert.strictEqual(T.nameOf(13), '五条');
  assert.strictEqual(T.nameOf(18), '红中');
  assert.strictEqual(T.nameOf(20), '白板');
});

/* ================================================================= */
group('胡牌判定');

test('标准型：123 456 789 筒 + 123 条 + 中中（对倒/顺子混合）', () => {
  const tiles = H('123456789t 123b 11b');       // 14 张
  assert.ok(R.isWinCounts(T.countsOf(tiles), []));
});

test('标准型：字牌只能做刻子，中发白顺子不算和', () => {
  const bad = H('123t 456t 789t 123z 11b');     // 中发白当顺子 -> 诈胡
  assert.strictEqual(R.isWinCounts(T.countsOf(bad), []), false);
  const good = H('123t 456t 789t 111z 11b');    // 中中中 作刻子
  assert.ok(R.isWinCounts(T.countsOf(good), []));
});

test('碰碰胡牌型可和', () => {
  const tiles = H('111t 222t 333t 444t 55b');
  assert.ok(R.isWinCounts(T.countsOf(tiles), []));
});

test('七对可和；未成对不可和', () => {
  assert.ok(R.isWinCounts(T.countsOf(H('1122334455667t 7t')), []));
  assert.strictEqual(R.isWinCounts(T.countsOf(H('1122334455678t 9t')), []), false);
});

test('带副露（1 副碰）的手牌判定', () => {
  // 手上 11 张 + 1 副碰 = 14
  const melds = [{ kind: 'pong', tile: H('5t')[0] }];
  const tiles = H('123t 456t 789t 11b');        // 11 张
  assert.ok(R.isWinCounts(T.countsOf(tiles), melds));
});

test('带 4 副碰的手抓一', () => {
  const melds = [
    { kind: 'pong', tile: H('1t')[0] },
    { kind: 'pong', tile: H('2t')[0] },
    { kind: 'pong', tile: H('3t')[0] },
    { kind: 'pong', tile: H('4t')[0] }
  ];
  assert.ok(R.isWinCounts(T.countsOf(H('5t 5t')), melds));
});

/* ================================================================= */
group('听牌');

test('听牌张识别', () => {
  const tiles = H('123456789t 12b 11b');        // 听 3b（也可听其他）
  const waits = R.waitingTiles(tiles, []);
  assert.ok(waits.includes(H('3b')[0]));
  assert.ok(R.isTenpai(tiles, []));
});

test('未听牌识别', () => {
  const tiles = H('147t 258b 369t 11z 22z');    // 散牌
  assert.strictEqual(R.isTenpai(tiles, []), false);
});

/* ================================================================= */
group('向听数');

test('已和牌向听 -1，听牌向听 0', () => {
  assert.strictEqual(R.shanten(H('123456789t 123b 11b'), []), -1);
  assert.strictEqual(R.shanten(H('123456789t 12b 11b'), []), 0);
});

test('向听数 == 0 当且仅当有听牌（随机 400 手校验）', () => {
  const rng = seededRng(20240521);
  let checked = 0;
  for (let iter = 0; iter < 400; iter++) {
    const wall = T.riffle(T.makeWall(), rng);
    const hand = T.sorted(wall.slice(0, 13));
    const s = R.shanten(hand, []);
    const hasWait = R.waitingTiles(hand, []).length > 0;
    assert.strictEqual(s === 0, hasWait,
      '手牌 ' + hand.map(T.shortOf).join('') + ' 向听=' + s + ' 听牌=' + hasWait);
    checked++;
  }
  assert.strictEqual(checked, 400);
});

test('向听数随进张单调不增', () => {
  const rng = seededRng(777);
  for (let iter = 0; iter < 120; iter++) {
    const wall = T.riffle(T.makeWall(), rng);
    const hand = T.sorted(wall.slice(0, 13));
    const base = R.shanten(hand, []);
    const counts = T.countsOf(hand);
    for (let t = 0; t < 21; t++) {
      if (counts[t] >= 4) continue;
      counts[t]++;
      const ns = R.shanten(T.tilesOfCounts(counts), []);
      counts[t]--;
      assert.ok(ns <= base + 0, '进张 ' + T.shortOf(t) + ' 后向听变大: ' + base + ' -> ' + ns);
    }
  }
});

/* ================================================================= */
group('番型计分');

function scoreOf(str, winTileStr, extra) {
  const tiles = H(str);
  const winTile = H(winTileStr)[0];
  assert.ok(tiles.includes(winTile), '手牌中应含胡牌张');
  return R.scoreWin(Object.assign({
    tiles: tiles, melds: [], winTile: winTile, selfDraw: true, rules: { cap: 8 }
  }, extra || {}));
}

test('屁胡：底 ×1，无牌型番', () => {
  const s = scoreOf('123456789t 123b 11b', '3b');
  assert.strictEqual(s.isPitHu, true);
  assert.strictEqual(s.typeFan, 1);
  assert.strictEqual(s.capped, 1);
});

test('碰碰胡 ×2', () => {
  const s = scoreOf('111t 222t 333t 444t 55b', '5b');
  assert.strictEqual(s.isPitHu, false);
  assert.ok(s.items.some(i => i.name === '碰碰胡'));
  assert.strictEqual(s.typeFan, 2);
});

test('清一色 ×4', () => {
  const s = scoreOf('123456789t 123t 11t', '3t');
  assert.ok(s.items.some(i => i.name === '清一色'));
  assert.strictEqual(s.typeFan, 4);
});

test('七对 ×4', () => {
  const s = scoreOf('1122334455t 6677b', '7b');
  assert.strictEqual(s.typeFan, 4);
  assert.ok(s.items.some(i => i.name === '七对'));
});

test('龙七对 ×8、双龙七对 ×16', () => {
  const long = scoreOf('1111t 22t 33t 44b 55b 66b', '6b');   // 1111 当作两对 + 5 对
  assert.ok(long.items.some(i => i.name === '龙七对'), JSON.stringify(long.items));
  assert.strictEqual(long.typeFan, 8);

  const dbl = scoreOf('1111t 2222t 33b 44b 55b', '5b');      // 两个四张
  assert.ok(dbl.items.some(i => i.name === '双龙七对'), JSON.stringify(dbl.items));
  assert.strictEqual(dbl.typeFan, 16);
  assert.strictEqual(dbl.capped, 16);                        // 双龙七对封顶 16
});

test('大三元 ×8 / 小三元 ×4', () => {
  const da = scoreOf('111z 222z 333z 123t 44t'.replace('123t', '123t'), '3t');
  // 111z=中中中 222z=发发发 333z=白白白
  assert.ok(da.items.some(i => i.name === '大三元'), JSON.stringify(da.items));
  assert.strictEqual(da.typeFan, 8);

  const xiao = scoreOf('111z 222z 33z 123t 456t', '6t');
  assert.ok(xiao.items.some(i => i.name === '小三元'), JSON.stringify(xiao.items));
  assert.strictEqual(xiao.typeFan, 4);
});

test('卡五星 ×2：胡 5 筒且为 456 嵌张', () => {
  const s = scoreOf('123t 456t 789t 555b 22b', '5t');
  assert.ok(s.items.some(i => i.name === '卡五星'), JSON.stringify(s.items));
  assert.strictEqual(s.typeFan, 2);
  assert.strictEqual(s.isPitHu, false);
});

test('非嵌张的 5 筒不算卡五星', () => {
  // 555t 作刻子，5t 不是 456 的嵌张
  const s = scoreOf('123t 789t 555t 456b 22b', '5t');
  assert.ok(!s.items.some(i => i.name === '卡五星'), JSON.stringify(s.items));
});

test('明四归一 ×2 / 暗四归一 ×4', () => {
  const meldTile = H('5t')[0];
  const ming = R.scoreWin({
    tiles: H('123t 678t 999t 22b'), melds: [{ kind: 'pong', tile: meldTile }],
    winTile: meldTile, selfDraw: false, rules: { cap: 8 }
  });
  assert.ok(ming, '明四归一牌型应可和');
  assert.ok(ming.items.some(i => i.name === '明四归一'), JSON.stringify(ming.items));
  assert.strictEqual(ming.typeFan, 2);

  const an = scoreOf('5555t 67t 123b 456b 22t', '5t');
  assert.ok(an.items.some(i => i.name === '暗四归一'), JSON.stringify(an.items));
  assert.strictEqual(an.typeFan, 4);
});

test('手抓一 ×4（加算：手抓一 4 + 碰碰胡 2 = 6）', () => {
  const melds = [
    { kind: 'pong', tile: H('1t')[0] },
    { kind: 'pong', tile: H('2t')[0] },
    { kind: 'pong', tile: H('3b')[0] },
    { kind: 'pong', tile: H('4b')[0] }
  ];
  const s = R.scoreWin({ tiles: H('5t 5t'), melds: melds, winTile: H('5t')[0], selfDraw: true, rules: { cap: 8 } });
  assert.ok(s.items.some(i => i.name === '手抓一'), JSON.stringify(s.items));
  assert.ok(s.items.some(i => i.name === '碰碰胡'));
  assert.strictEqual(s.typeFan, 6);
});

test('时机番加算：杠上开花/抢杠胡/海底捞 各 +2（屁胡的底 1 不再另加）；亮倒最后整体 ×2', () => {
  const base = scoreOf('123456789t 123b 11b', '3b');
  assert.strictEqual(base.fan, 1, '屁胡 = 1 倍底金（一个番都没有时才这样算）');
  // 有了番就不再额外加屁胡的 1：番数和就是那个番本身
  const g = scoreOf('123456789t 123b 11b', '3b', { gangFlower: true });
  assert.strictEqual(g.fan, 2, '杠上开花：番数和 2，不是 1+2=3');
  assert.strictEqual(g.isPitHu, true, '牌型本身仍是屁胡');
  const q = scoreOf('123456789t 123b 11b', '3b', { qiangGang: true });
  assert.strictEqual(q.fan, 2);
  const h = scoreOf('123456789t 123b 11b', '3b', { haidi: true });
  assert.strictEqual(h.fan, 2);
  // 有牌型番时也不加底 1：清一色 + 海底捞 = 4+2 = 6（不是 4+1+2）
  const qy = scoreOf('123t 456t 789t 123t 22t', '3t', { haidi: true });
  assert.ok(qy.items.some(i => i.name === '清一色'), JSON.stringify(qy.items));
  assert.strictEqual(qy.sum, 6, '清一色 4 + 海底捞 2 = 6');
  // 亮倒不参与加算，而是最后把得分整体翻倍
  const l = scoreOf('123456789t 123b 11b', '3b', { liangdao: true });
  assert.strictEqual(l.fan, base.fan * 2);
  assert.strictEqual(l.cappedSum, base.fan, '加算部分不含亮倒');
});

test('加算计分：底金 5、卡五星 + 清一色 = 5 × (2+4) = 30', () => {
  // 14 张手牌 123t 456t 789t 456t 22t，胡的那张 5筒 是 456 的嵌张 → 卡五星 2 + 清一色 4
  const hand = '123t 456t 789t 456t 22t';
  const s = scoreOf(hand, '5t', { rules: { baseScore: 5, cap: 99 } });
  assert.deepStrictEqual(s.items.map(i => i.name).sort(), ['卡五星', '清一色'],
    '不该有别的番：' + JSON.stringify(s.items));
  assert.strictEqual(s.sum, 6, '加算和应为 2+4=6');
  assert.strictEqual(s.fan, 6);
  assert.strictEqual(s.fan * 5, 30, '底金 5 × 6 = 30');

  // 加上亮倒：5 × (2+4) × 2 = 60
  const l = scoreOf(hand, '5t', { rules: { baseScore: 5, cap: 99 }, liangdao: true });
  assert.strictEqual(l.sum, 6, '亮倒不参与加算');
  assert.strictEqual(l.fan, 12, '亮倒后整体 ×2 = 12');
  assert.strictEqual(l.fan * 5, 60, '底金 5 × 6 × 2 = 60');
});

test('杠上炮是乘算：清一色 4 × 第 1 杠 2 = 8 → 底金 5 = 40', () => {
  const s = scoreOf('123t 456t 789t 123t 22t', '3t', {
    rules: { baseScore: 5, cap: 8 }, gangPao: true, gangPaoIndex: 1
  });
  assert.ok(s.items.some(i => i.name === '清一色'), JSON.stringify(s.items));
  const gp = s.items.filter(i => i.name === '杠上炮')[0];
  assert.ok(gp, '应有杠上炮');
  assert.strictEqual(gp.mode, 'mul', '杠上炮是乘算项');
  assert.strictEqual(gp.mult, 2, '第 1 杠 ×2');
  assert.strictEqual(s.baseSum, 4, '加算部分只有清一色 4');
  assert.strictEqual(s.sum, 8, '4 × 2 = 8');
  assert.strictEqual(s.fan * 5, 40, '底金 5 × 8 = 40');

  // 屁胡 + 杠上炮：加算部分是屁胡兜底的 1，乘完就是 2 倍
  const pit = scoreOf('123456789t 123b 11b', '3b', {
    rules: { baseScore: 5, cap: 8 }, gangPao: true, gangPaoIndex: 1
  });
  assert.strictEqual(pit.baseSum, 1, '屁胡兜底 1');
  assert.strictEqual(pit.sum, 2, '1 × 2 = 2');
  assert.strictEqual(pit.fan * 5, 10, '底金 5 × 2 = 10');
  assert.strictEqual(pit.isPitHu, true, '有杠上炮也还是屁胡（所以平时不能捉炮）');

  // 第 2 杠 = ×4：清一色 → 16，被默认 ×8 封顶
  const s2 = scoreOf('123t 456t 789t 123t 22t', '3t', {
    rules: { baseScore: 5, cap: 8 }, gangPao: true, gangPaoIndex: 2
  });
  assert.strictEqual(s2.sum, 16, '清一色 4 × 第 2 杠 4 = 16');
  assert.strictEqual(s2.capped, 8, '默认 ×8 封顶');
});

test('封顶 ×8：加算后 七对4 + 清一色4 = 8', () => {
  const s = scoreOf('1122334455667t 7t', '7t');
  assert.strictEqual(s.typeFan, 8, '加算 4+4=8');
  assert.strictEqual(s.capped, 8);
  assert.strictEqual(s.sum, 8);
});/* ================================================================= */
group('★ 屁胡不能捉炮（规则修复点）');

const PIT_HAND = '123456789t 12b 11b';   // 13 张，听 3b，屁胡

test('屁胡自摸可以胡', () => {
  const tiles = H(PIT_HAND);
  const res = R.canWinOnDraw(tiles, [], H('3b')[0], {});
  assert.ok(res, '自摸应可胡');
  assert.strictEqual(res.isPitHu, true);
});

test('屁胡捉炮被拒绝（默认规则）', () => {
  const tiles = H(PIT_HAND);
  const res = R.canWinOnDiscard(tiles, [], H('3b')[0], { rules: R.DEFAULT_RULES });
  assert.strictEqual(res, null, '屁胡不应能捉炮');
});

test('关闭 pitHuOnlyZimo 后屁胡可以捉炮（可配置）', () => {
  const tiles = H(PIT_HAND);
  const res = R.canWinOnDiscard(tiles, [], H('3b')[0], {
    rules: Object.assign({}, R.DEFAULT_RULES, { pitHuOnlyZimo: false })
  });
  assert.ok(res, '关闭限制后应可捉炮');
});

test('亮倒的屁胡默认可以捉炮；关掉开关后不行', () => {
  const tiles = H(PIT_HAND);
  // 自己没亮倒 -> 屁胡不能捉炮
  assert.strictEqual(
    R.canWinOnDiscard(tiles, [], H('3b')[0], { rules: R.DEFAULT_RULES, liangdao: false }),
    null, '没亮倒时屁胡不能捉炮');
  // 自己亮倒了 -> 默认就能捉炮
  const on = R.canWinOnDiscard(tiles, [], H('3b')[0], { rules: R.DEFAULT_RULES, liangdao: true });
  assert.ok(on, '亮倒后屁胡默认可以捉别人的炮');
  assert.strictEqual(on.fan, 2); // 亮倒 ×2
  // 关掉开关 -> 又不给胡
  const off = R.canWinOnDiscard(tiles, [], H('3b')[0], {
    rules: Object.assign({}, R.DEFAULT_RULES, { liangdaoPitHuCanDianPao: false }),
    liangdao: true
  });
  assert.strictEqual(off, null, '关掉 liangdaoPitHuCanDianPao 后亮倒屁胡也不能捉炮');
});

test('大胡（碰碰胡/卡五星/清一色）可以捉炮', () => {
  // 碰碰胡听牌
  const pph = R.canWinOnDiscard(H('111t 222t 333t 44b 55b'), [], H('4b')[0], {
    rules: R.DEFAULT_RULES, melds: []
  });
  assert.ok(pph && !pph.isPitHu, '碰碰胡应可捉炮');

  // 卡五星听牌：手上 13 张，胡 5 筒
  const kwx13 = H('123t 46t 789t 555b 22b');   // 缺 5t
  const kwx = R.canWinOnDiscard(kwx13, [], H('5t')[0], { rules: R.DEFAULT_RULES });
  assert.ok(kwx, '卡五星应可捉炮');
  assert.ok(kwx.items.some(i => i.name === '卡五星'));
});

test('杠上炮：屁胡也能胡（默认），关掉开关后不允许', () => {
  const on = R.canWinOnDiscard(H(PIT_HAND), [], H('3b')[0], {
    rules: R.DEFAULT_RULES, gangPao: true, gangPaoIndex: 1
  });
  assert.ok(on, '杠后打出的牌，屁胡也能胡');
  assert.strictEqual(on.isPitHu, true);
  assert.strictEqual(on.fan, 2, '第 1 杠杠上炮 = 番数和 2（屁胡的底 1 不再另加）');

  const off = R.canWinOnDiscard(H(PIT_HAND), [], H('3b')[0], {
    rules: Object.assign({}, R.DEFAULT_RULES, { gangPaoPitHu: false }),
    gangPao: true, gangPaoIndex: 1
  });
  assert.strictEqual(off, null, '关掉 gangPaoPitHu 后仍按小胡处理');
});

/* ================================================================= */
group('★ 亮倒只亮「能推出听张的关联牌」');

function revealIsDerivable(hand, melds) {
  const waits = R.waitingTiles(hand, melds || []);
  if (!waits.length) return null;
  const rev = R.revealTiles(hand, melds || []);
  // 亮出的必须是手里的子集
  const left = hand.slice();
  for (const t of rev) {
    const i = left.indexOf(t);
    if (i < 0) return '亮出的牌不在手里：' + T.shortOf(t);
    left.splice(i, 1);
  }
  if (!R.revealWorks(T.countsOf(hand), rev, waits)) {
    return '推不出听张。亮=' + rev.map(T.shortOf).join('') +
      ' 听=' + waits.map(T.shortOf).join('') + ' 手牌=' + hand.map(T.shortOf).join('');
  }
  return null;
}

test('11134567999+中中 听 2/5/8 -> 只亮 34567', () => {
  const hand = H('11134567999t 11z');
  assert.deepStrictEqual(R.revealTiles(hand, []), H('34567t'));
  assert.strictEqual(revealIsDerivable(hand, []), null);
});

test('1223345578+中中中 听 6/9 -> 只亮 78', () => {
  const hand = H('1223345578t 111z');
  assert.deepStrictEqual(R.revealTiles(hand, []), H('78t'));
  assert.strictEqual(revealIsDerivable(hand, []), null);
});

test('45678 条三面听 3/6/9 -> 亮 45678', () => {
  const hand = H('45678b 111t 999t 11z');
  assert.deepStrictEqual(R.waitingTiles(hand, []), H('369b'));
  assert.deepStrictEqual(R.revealTiles(hand, []), H('45678b'));
  assert.strictEqual(revealIsDerivable(hand, []), null);
});

test('七对亮 1 张、龙七对亮 3 张、双龙七对亮 5 张', () => {
  // 单骑那张离得远 -> 纯七对型，只按七对推
  const seven = H('112233445566t 9t');
  assert.deepStrictEqual(R.waitingTiles(seven, []), [H('9t')[0]], '只单骑 9筒');
  assert.strictEqual(R.revealTiles(seven, []).length, 1, '七对亮 1 张');
  assert.strictEqual(revealIsDerivable(seven, []), null);

  const long = H('1111t 22334455t 9t');
  assert.strictEqual(R.revealTiles(long, []).length, 3, '龙七对亮 3 张');
  assert.strictEqual(revealIsDerivable(long, []), null);

  const dbl = H('1111t 2222t 3344t 9t');
  assert.strictEqual(R.revealTiles(dbl, []).length, 5, '双龙七对亮 5 张');
  assert.strictEqual(revealIsDerivable(dbl, []), null);
});

test('七对型如果同时还能普通多面听，就退回普通算法（保证推得出全部听张）', () => {
  // 1122334455667 同时听 1/4/7（普通牌型），只亮 1 张会漏掉另外两个听张
  const mixed = H('112233445566t 7t');
  const waits = R.waitingTiles(mixed, []);
  assert.ok(waits.length > 1, '这手牌确实有多个听张：' + waits.map(T.shortOf).join(''));
  const rev = R.revealTiles(mixed, []);
  assert.ok(rev.length > 1, '不能只亮 1 张，实际 ' + rev.length);
  assert.strictEqual(revealIsDerivable(mixed, []), null, '亮出的牌必须能推出全部听张');
});

test('随机 400 手听牌：亮出的牌都能推出全部听张', () => {
  const rng = seededRng(24680);
  let checked = 0;
  for (let iter = 0; iter < 4000 && checked < 400; iter++) {
    // 随机造一副和牌，再拿掉一张 -> 必定听牌
    const counts = new Array(21).fill(0);
    const put = (t, n) => { counts[t] += n; };
    let ok = true;
    for (let s = 0; s < 4 && ok; s++) {
      let done = false;
      for (let tries = 0; tries < 40 && !done; tries++) {
        const t = Math.floor(rng() * 21);
        if (t >= 18) {                      // 字牌只能做刻子
          if (counts[t] + 3 <= 4) { put(t, 3); done = true; }
        } else {
          const r = t % 9;
          if (rng() < 0.5) {
            if (counts[t] + 3 <= 4) { put(t, 3); done = true; }
          } else if (r <= 6 && counts[t] < 4 && counts[t + 1] < 4 && counts[t + 2] < 4) {
            put(t, 1); put(t + 1, 1); put(t + 2, 1); done = true;
          }
        }
      }
      if (!done) ok = false;
    }
    for (let tries = 0; tries < 40 && ok; tries++) {
      const t = Math.floor(rng() * 21);
      if (counts[t] + 2 <= 4) { put(t, 2); break; }
      if (tries === 39) ok = false;
    }
    if (!ok) continue;
    const full = T.tilesOfCounts(counts);
    // 拿掉一张 -> 13 张听牌手牌
    const idx = Math.floor(rng() * full.length);
    const hand = full.slice(0, idx).concat(full.slice(idx + 1));
    if (hand.length !== 13) continue;
    if (!R.isTenpai(hand, [])) continue;
    const err = revealIsDerivable(hand, []);
    assert.strictEqual(err, null, err || '');
    checked++;
  }
  assert.ok(checked >= 200, '样本太少：' + checked);
  console.log('        抽查了 ' + checked + ' 手随机听牌手牌');
});

/* ================================================================= */
group('副露可用性');

test('碰 / 暗杠 / 补杠 / 直杠', () => {
  assert.ok(R.canPong(H('55t 123b'), H('5t')[0]));
  assert.strictEqual(R.canPong(H('5t 123b'), H('5t')[0]), false);
  assert.deepStrictEqual(R.canAnKongList(H('5555t 123b')), [H('5t')[0]]);
  assert.deepStrictEqual(R.canAddKong(H('5t 123b'), [{ kind: 'pong', tile: H('5t')[0] }]), [H('5t')[0]]);
  assert.ok(R.canZhiGang(H('555t 123b'), H('5t')[0]));
  assert.strictEqual(R.canZhiGang(H('55t 123b'), H('5t')[0]), false);
});

/* ================================================================= */
group('荒庄赔听');

test('听牌者最大牌型番可计算', () => {
  const best = R.maxFanForTenpai(H('1122334455667t'), []);
  assert.ok(best, '七对听牌应有最大番');
  assert.ok(best.fan >= 4);
  assert.strictEqual(R.maxFanForTenpai(H('147t 258b 369t 11z 22z'), []), null);
});

/* ================================================================= */
console.log('\n----------------------------------------');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
if (failed) {
  console.log('\n失败明细：');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
