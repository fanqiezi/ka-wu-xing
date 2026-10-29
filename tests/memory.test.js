/**
 * tests/memory.test.js —— 「成长型」记忆 / 对手模型自测
 * 跑法：node tests/memory.test.js
 */
'use strict';

const assert = require('assert');
const Memory = require('../js/memory.js');

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) {
    failed++; failures.push(name + ' -> ' + e.message);
    console.log('  \u2717 ' + name + '\n        ' + e.message);
  }
}
function group(n) { console.log('\n' + n); }

function fakeStorage() {
  const map = {};
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: k => { delete map[k]; },
    _map: map
  };
}

function rec(o) {
  return Object.assign({
    discards: 20, tsumogiri: 14, pongs: 1, kongs: 0,
    winDiscards: 40, winTile: null, dealInTile: null, fan: 0
  }, o || {});
}

group('基本结构');

test('空白记忆：0 局、先验画像、置信度 0', () => {
  const m = Memory.blank();
  assert.strictEqual(m.version, Memory.VERSION);
  assert.strictEqual(m.games, 0);
  assert.strictEqual(m.human.rounds, 0);
  const p = Memory.profile(m);
  assert.strictEqual(p.rounds, 0);
  assert.strictEqual(p.confidence, 0, '没打过就不该有信任度');
  assert.ok(Math.abs(p.aggression - Memory.PRIOR.aggression) < 1e-9, '没数据时应该等于先验');
  assert.deepStrictEqual(p.hot, [], '没数据时不该有「常胡的牌」');
});

test('空/坏记忆不会让 profile 崩（自动回到先验）', () => {
  [null, undefined, {}, { version: 999, human: {} }].forEach(bad => {
    const p = Memory.profile(bad);
    assert.ok(p && typeof p.aggression === 'number', 'profile 不该崩');
    assert.strictEqual(p.rounds, 0);
  });
});

group('记录与画像');

test('记一局：局数 +1、切牌/摸切/碰杠累加', () => {
  const m = Memory.blank();
  Memory.update(m, rec({ discards: 18, tsumogiri: 12, pongs: 2, kongs: 1 }));
  assert.strictEqual(m.human.rounds, 1);
  assert.strictEqual(m.games, 1);
  assert.strictEqual(m.human.discards, 18);
  assert.strictEqual(m.human.tsumogiri, 12);
  assert.strictEqual(m.human.pongs, 2);
  assert.strictEqual(m.human.kongs, 1);
});

test('信任度随局数上升（20 局封顶），样本少时靠近先验', () => {
  const m = Memory.blank();
  Memory.update(m, rec({ pongs: 3, kongs: 2 }));
  const p1 = Memory.profile(m);
  assert.ok(p1.confidence > 0 && p1.confidence < 0.1, '1 局时信任度应该很小，实际 ' + p1.confidence);
  assert.ok(Math.abs(p1.aggression - Memory.PRIOR.aggression) < 0.15,
    '1 局时就该基本还是先验，实际 ' + p1.aggression);
  for (let i = 0; i < 40; i++) Memory.update(m, rec({ pongs: 3, kongs: 2 }));
  const p2 = Memory.profile(m);
  assert.strictEqual(p2.confidence, 1, '局数够了应该完全信任');
  assert.ok(p2.aggression > p1.aggression, '一直碰杠 → 激进度应该升高：' + p1.aggression + ' → ' + p2.aggression);
});

test('摸切率按实际比例统计，并夹在 0~1', () => {
  const m = Memory.blank();
  for (let i = 0; i < 10; i++) Memory.update(m, rec({ discards: 20, tsumogiri: 18 }));
  const p = Memory.profile(m);
  assert.ok(p.tsumogiri > 0.8 && p.tsumogiri <= 1, '摸了就切的打法应该统计成高摸切率，实际 ' + p.tsumogiri);
});

test('「他常胡的牌」按次数排序，最多 8 张', () => {
  const m = Memory.blank();
  for (let i = 0; i < 5; i++) Memory.update(m, rec({ winTile: 3 }));
  for (let i = 0; i < 3; i++) Memory.update(m, rec({ winTile: 11 }));
  const p = Memory.profile(m);
  assert.strictEqual(p.hot[0].tile, 3, '出现最多的应该排第一');
  assert.ok(p.hot[0].count > p.hot[1].count);
  for (let t = 0; t < 30; t++) Memory.update(m, rec({ winTile: t }));
  assert.ok(Memory.profile(m).hot.length <= 8, '最多只记 8 张');
});

test('旧记忆会衰减（老习惯不会永远绑着玩家）', () => {
  const m = Memory.blank();
  Memory.update(m, rec({ winTile: 3 }));
  const before = m.human.winTiles['3'];
  for (let i = 0; i < 30; i++) Memory.update(m, rec({}));
  const after = m.human.winTiles['3'];
  assert.ok(after < before, '30 局后老记录应该变淡：' + before + ' → ' + after);
});

test('describe 给的是可读中文行，能直接贴到界面上', () => {
  const m = Memory.blank();
  for (let i = 0; i < 25; i++) Memory.update(m, rec({ pongs: 2 }));
  const rows = Memory.describe(m);
  assert.ok(rows.length >= 4);
  rows.forEach(r => {
    assert.ok(typeof r.label === 'string' && r.label.length > 0);
    assert.ok(typeof r.value === 'string' && r.value.length > 0);
  });
  assert.ok(rows.some(r => r.label.indexOf('局数') >= 0), '应该有「累计局数」');
  assert.ok(rows.some(r => r.label.indexOf('摸切') >= 0), '应该有「摸切率」');
});

group('持久化');

test('save / load 往返：记忆能存下来再读回', () => {
  const ls = fakeStorage();
  const m = Memory.blank();
  Memory.update(m, rec({ winTile: 7, fan: 4 }));
  assert.strictEqual(Memory.save(ls, m), true);
  const back = Memory.load(ls);
  assert.strictEqual(back.human.rounds, 1);
  assert.strictEqual(back.human.winTiles['7'], 1);
  assert.strictEqual(back.games, 1);
});

test('没有存储 / 坏数据 / 版本不对 → 返回空白记忆而不是崩', () => {
  assert.strictEqual(Memory.load(null).games, 0, '没有 localStorage 时返回空记忆');
  const ls = fakeStorage();
  ls.setItem(Memory.KEY, '{oops');
  assert.strictEqual(Memory.load(ls).games, 0, '坏 JSON 应该被丢掉');
  ls.setItem(Memory.KEY, JSON.stringify({ version: 999, human: { rounds: 5 } }));
  assert.strictEqual(Memory.load(ls).games, 0, '版本不对应该重置');
});

test('clear 会真的删掉记忆', () => {
  const ls = fakeStorage();
  const m = Memory.blank();
  Memory.update(m, rec({}));
  Memory.save(ls, m);
  assert.ok(ls.getItem(Memory.KEY), '先确认存进去了');
  Memory.clear(ls);
  assert.strictEqual(ls.getItem(Memory.KEY), null);
  assert.strictEqual(Memory.load(ls).games, 0);
});

test('save 在存储抛异常时返回 false（隐私模式也能继续玩）', () => {
  const bad = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceeded'); },
    removeItem: () => {}
  };
  const m = Memory.blank();
  Memory.update(m, rec({}));
  assert.strictEqual(Memory.save(bad, m), false, '写不进去应该返回 false 而不是抛');
  Memory.clear(bad);              // 也不该抛
});

console.log('\n' + '-'.repeat(40));
if (failed === 0) {
  console.log('通过 ' + passed + ' 项，失败 0 项');
} else {
  console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  console.log('\n失败明细：');
  failures.forEach(f => console.log('  - ' + f));
  process.exitCode = 1;
}
