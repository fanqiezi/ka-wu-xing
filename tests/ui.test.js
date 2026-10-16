/*
 * 界面层联调测试：用极简 DOM 打桩在 Node 里真实跑 ui.js + game.js
 * 运行： node tests/ui.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createDom } = require('./dom-shim.js');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/tiles.js', 'js/rules.js', 'js/ai.js', 'js/game.js', 'js/stats.js', 'js/ui.js', 'js/main.js'];

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  \u2717 ' + name + '\n        ' + e.message); }
}
function group(n) { console.log('\n' + n); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function boot(seed) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = createDom(html);
  const win = dom.window;
  win.window = win;
  win.self = win;
  win.globalThis = win;
  // 用可复现的随机数替换 Math.random，保证测试稳定
  const fakeMath = Object.create(Math);
  fakeMath.random = seededRng(seed === undefined ? 20250521 : seed);
  win.Math = fakeMath;

  const ctx = vm.createContext(win);
  FILES.forEach(f => {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  });
  return { dom, win, ctx };
}

(async function main() {
  group('页面装配');

  const { dom, win } = boot();

  test('index.html 里的脚本都能加载，且 KWX 命名空间完整', () => {
    assert.ok(win.KWX, 'window.KWX 未挂载');
    ['Tiles', 'Rules', 'AI', 'Game', 'Stats'].forEach(k => assert.ok(win.KWX[k], '缺少 KWX.' + k));
    assert.ok(win.KWX_UI, '缺少 KWX_UI');
  });

  test('ui.js 引用的所有元素 id 都能找到', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
    const ids = new Set();
    const re = /\$\('([^']+)'\)/g;
    let m;
    while ((m = re.exec(src))) ids.add(m[1]);
    const missing = [];
    ids.forEach(id => {
      // index.html 里静态写好，或 ui.js 自己拼的弹窗 HTML 里动态生成
      if (!dom.byId[id] && src.indexOf('id="' + id + '"') < 0) missing.push(id);
    });
    assert.deepStrictEqual(missing, [], '缺少元素：' + missing.join(', '));
  });

  test('加载后停在开始界面，不自动开局；规则/设置按钮可用', () => {
    win.KWX_UI.settings.speed = 0;
    win.dispatch('DOMContentLoaded');
    assert.strictEqual(win.KWX_UI.getGame(), null, '一开始不应该有牌局');
    assert.strictEqual(dom.byId['start-screen'].hidden, false, '应显示开始界面');

    // 开始界面上的规则按钮
    dom.byId['start-rules'].click();
    assert.strictEqual(dom.byId['modal-host'].hidden, false, '开始界面应能打开规则');
    let html = dom.byId['modal-host'].children.map(c => c.innerHTML).join('');
    assert.ok(html.indexOf('卡五星规则') >= 0, '规则内容应已渲染');
    dom.findAll(dom.byId['modal-host'], n => dom.hasClass(n, 'btn'))
      .filter(b => b.textContent === '知道了')[0].click();
    assert.strictEqual(dom.byId['modal-host'].hidden, true, '规则弹窗应能关闭');

    // 开始界面上的设置按钮
    dom.byId['start-settings'].click();
    assert.ok(dom.byId['set-baseScore'], '开始界面应能打开设置');
    dom.findAll(dom.byId['modal-host'], n => dom.hasClass(n, 'btn'))
      .filter(b => b.textContent === '取消')[0].click();
    assert.strictEqual(dom.byId['modal-host'].hidden, true, '设置弹窗应能关闭');

    // 开始界面上的对局记录（还没打，应是空状态）
    dom.byId['start-history'].click();
    html = dom.byId['modal-host'].children.map(c => c.innerHTML).join('');
    assert.ok(html.indexOf('还没有记录') >= 0, '空记录应有提示');
    dom.findAll(dom.byId['modal-host'], n => dom.hasClass(n, 'btn'))
      .filter(b => b.textContent === '知道了')[0].click();
  });

  test('点「开始游戏」才进入牌局并渲染出三家座位', () => {
    dom.byId['start-btn'].click();
    const g = win.KWX_UI.getGame();
    assert.ok(g, '未创建 Game 实例');
    assert.ok(g.playing, '应已开始牌局');
    assert.strictEqual(dom.byId['start-screen'].hidden, true, '开始界面应隐藏');
    ['seat-0', 'seat-1', 'seat-2'].forEach(id => {
      assert.ok(dom.byId[id].children.length > 0, id + ' 未渲染');
    });
    assert.strictEqual(win.KWX_UI.settings.speed, 0);
  });

  /* ------------------------------------------------------------------ */
  group('自动对局（模拟真人点击，跑 ' + 8 + ' 局）');

  const stats = { discardClicks: 0, huClicks: 0, pongClicks: 0, kongClicks: 0, liangdaoClicks: 0, passClicks: 0, rounds: 0, winModals: 0, huangModals: 0, backdropChecks: 0, winTileChecks: 0 };
  let runError = null;

  const ROUNDS = 8;
  const startTime = Date.now();

  while (stats.rounds < ROUNDS && Date.now() - startTime < 60000) {
    try {
      const modalHost = dom.byId['modal-host'];
      if (!modalHost.hidden && modalHost.children.length > 0) {
        const text = modalHost.children.map(c => c.innerHTML).join('');
        const isHuang = text.indexOf('荒庄') >= 0;
        if (isHuang) stats.huangModals++; else stats.winModals++;
        // 结算弹窗点「外面」不该关掉（否则会卡住没法进下一局）
        if (stats.backdropChecks === 0) {
          stats.backdropChecks++;
          modalHost.click();
          assert.ok(!modalHost.hidden && modalHost.children.length > 0,
            '点结算弹窗外面不该把它关掉');
        }
        // 结算弹窗里：赢张不插回手牌，而是空一格单独摆在右边
        if (!isHuang && stats.winTileChecks === 0) {
          stats.winTileChecks++;
          assert.ok(text.indexOf('win-tile') >= 0, '结算弹窗应单独展示赢张');
          assert.ok(text.indexOf('win-gap') >= 0, '赢张前面应有一段间隙（说明没插回手牌）');
          assert.ok(text.indexOf('win-gap') < text.indexOf('win-tile'),
            '赢张的间隙应出现在赢张之前');
        }
        const btns = dom.findAll(modalHost, n => dom.hasClass(n, 'btn'));
        const next = btns.filter(b => b.textContent === '下一局')[0];
        if (next) {
          stats.rounds++;
          next.click();
          await sleep(20);
          continue;
        }
      }
      const ui = win.KWX_UI;
      const g = ui.getGame();
      if (g && g.speed !== 0) g.speed = 0;
      const ask = ui.getPending();
      if (ask) {
        if (ask.kind === 'discard') {
          const tiles = dom.findAll(dom.byId['seat-0'], n => dom.hasClass(n, 'clickable'));
          assert.ok(tiles.length > 0, '轮到自己出牌时手牌应可点击');
          tiles[Math.floor(win.Math.random() * tiles.length)].click();
          stats.discardClicks++;
        } else {
          const bar = dom.byId['actionbar'];
          const acts = dom.findAll(bar, n => dom.hasClass(n, 'act'));
          assert.ok(acts.length > 0, ask.kind + ' 时应渲染操作按钮');
          assert.ok(acts.filter(b => b.textContent === '过').length > 0, '操作栏应有「过」按钮');
          const pick = (txt) => acts.filter(b => b.textContent.indexOf(txt) === 0)[0];
          const hu = pick('胡'), pong = pick('碰');
          const kong = pick('杠') || pick('暗杠') || pick('补杠');
          const ld = pick('亮倒');
          if (hu) { stats.huClicks++; hu.click(); }
          else if (pong) { stats.pongClicks++; pong.click(); }
          else if (kong) { stats.kongClicks++; kong.click(); }
          else if (ld && win.Math.random() < 0.7) { stats.liangdaoClicks++; ld.click(); }
          else { stats.passClicks++; pick('过').click(); }
        }
      }
    } catch (e) {
      runError = e;
      break;
    }
    await sleep(3);
  }

  test('连续 ' + ROUNDS + ' 局自动对局无异常', () => {
    if (runError) throw runError;
    assert.strictEqual(stats.rounds, ROUNDS, '完成的局数不足：' + stats.rounds);
  });

  test('交互路径被真实触发', () => {
    console.log('        出牌 ' + stats.discardClicks + ' 次，胡 ' + stats.huClicks +
      ' 次，碰 ' + stats.pongClicks + ' 次，杠 ' + stats.kongClicks +
      ' 次，亮倒 ' + stats.liangdaoClicks + ' 次，过 ' + stats.passClicks +
      ' 次；胡牌弹窗 ' + stats.winModals + '，荒庄弹窗 ' + stats.huangModals);
    assert.ok(stats.discardClicks > 20, '应多次出牌');
    assert.ok(stats.pongClicks + stats.kongClicks + stats.liangdaoClicks + stats.huClicks + stats.passClicks > 0,
      '应至少触发一次操作按钮');
    assert.ok(stats.winModals + stats.huangModals === ROUNDS, '每局都应有结算弹窗');
    assert.ok(stats.backdropChecks > 0, '应检查过「点结算弹窗外不关闭」');
    assert.ok(stats.winTileChecks > 0, '应检查过「结算弹窗单独展示赢张」');
  });

  test('渲染出的手牌数量与状态一致', () => {
    const g = win.KWX_UI.getGame();
    const s = g.snapshot();
    const tiles = dom.findAll(dom.byId['seat-0'], function (n) {
      return dom.hasClass(n, 'tile') && !dom.hasClass(n, 'back');
    });
    // 手牌 + 副露（碰 3 张 / 杠 4 张）+ 牌河
    let expect = s.players[0].handCount + s.players[0].discards.length;
    s.players[0].melds.forEach(m => { expect += (m.kind === 'pong' ? 3 : 4); });
    assert.strictEqual(tiles.length, expect,
      '座位0 渲染牌数 ' + tiles.length + ' 与期望 ' + expect + ' 不符');
  });

  test('日志有内容且总分守恒', () => {
    const g = win.KWX_UI.getGame();
    assert.ok(dom.byId['log'].children.length > 0, '对局记录不应为空');
    const total = g.players.reduce((a, p) => a + p.score, 0);
    assert.strictEqual(total, 0, '总分应为 0，实际 ' + total);
  });

  /* ------------------------------------------------------------------ */
  group('规则弹窗与设置弹窗');

  test('规则弹窗含「屁胡不能捉炮」说明', () => {
    dom.byId['btn-rules'].click();
    const html = dom.byId['modal-host'].children.map(c => c.innerHTML).join('');
    assert.ok(html.indexOf('屁胡') >= 0, '规则说明应提到屁胡');
    assert.ok(html.indexOf('不能捉炮') >= 0 || html.indexOf('只能自摸') >= 0);
    const btns = dom.findAll(dom.byId['modal-host'], n => dom.hasClass(n, 'btn'));
    btns.filter(b => b.textContent === '知道了')[0].click();
    assert.ok(dom.byId['modal-host'].hidden, '弹窗应已关闭');
  });

  test('设置弹窗可开关「屁胡只能自摸」并生效', () => {
    dom.byId['btn-settings'].click();
    const cb = dom.byId['set-pitHuOnlyZimo'];
    assert.ok(cb, '应有 pitHuOnlyZimo 复选框');
    assert.strictEqual(cb.checked, true, '默认应勾选（屁胡只能自摸）');
    cb.checked = false;
    const btns = dom.findAll(dom.byId['modal-host'], n => dom.hasClass(n, 'btn'));
    btns.filter(b => b.textContent === '保存')[0].click();
    assert.strictEqual(win.KWX_UI.settings.pitHuOnlyZimo, false);
    assert.strictEqual(win.KWX_UI.getGame().rules.pitHuOnlyZimo, false, '应即时作用到当前牌局');
    // 还原
    win.KWX_UI.settings.pitHuOnlyZimo = true;
    win.KWX_UI.getGame().rules.pitHuOnlyZimo = true;
  });

  test('新对局按钮可重开', () => {
    dom.byId['btn-newmatch'].click();
    const g = win.KWX_UI.getGame();
    assert.strictEqual(g.roundNo, 1, '新对局应从第 1 局开始');
    assert.ok(g.players.every(p => p.score === 0), '新对局分数应清零');
    g.stop();
  });

  /* ------------------------------------------------------------------ */
  group('操作按钮渲染与提交（确定性）');

  async function atest(name, fn) {
    try { await fn(); passed++; console.log('  \u2713 ' + name); }
    catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  \u2717 ' + name + '\n        ' + e.message); }
  }

  function labelsOf() {
    return dom.findAll(dom.byId['actionbar'], n => dom.hasClass(n, 'act')).map(b => b.textContent);
  }

  await atest('自身操作：胡 / 暗杠 / 补杠 / 亮倒 / 过 全部渲染，点击后正确回传', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    const p = g.ask({
      kind: 'self', seat: 0, ctx: {}, actions: [
        { type: 'hu', result: { capped: 2, items: [{ name: '碰碰胡', mult: 2 }] } },
        { type: 'ankong', tile: 0 },
        { type: 'addkong', tile: 1 },
        { type: 'liangdao' },
        { type: 'pass' }
      ]
    });
    assert.deepStrictEqual(labelsOf(), ['胡', '暗杠 1筒', '补杠 2筒', '亮倒', '过']);
    const acts = dom.findAll(dom.byId['actionbar'], n => dom.hasClass(n, 'act'));
    acts[1].click();
    const ans = await p;
    assert.strictEqual(ans.type, 'ankong');
    assert.strictEqual(ans.tile, 0);
    assert.strictEqual(dom.byId['actionbar'].children.length, 0, '提交后操作栏应清空');
  });

  await atest('别人打牌时：胡 / 杠 / 碰 / 过 渲染正确', async () => {
    const g = win.KWX_UI.getGame();
    const p = g.ask({
      kind: 'claim', seat: 0, tile: 4,
      canHu: true, huResult: { capped: 4, items: [{ name: '清一色', mult: 4 }] },
      canZhiGang: true, canPong: true
    });
    assert.deepStrictEqual(labelsOf(), ['胡 5筒', '杠 5筒', '碰 5筒', '过']);
    const acts = dom.findAll(dom.byId['actionbar'], n => dom.hasClass(n, 'act'));
    acts[2].click();
    const ans = await p;
    assert.strictEqual(ans.action, 'pong');
  });

  await atest('轮到自己出牌：手牌全部可点，点击回传该张牌', async () => {
    const g = win.KWX_UI.getGame();
    g.players[0].hand = [0, 1, 2, 9, 10, 11, 18, 18, 19, 19, 20, 20, 3];
    g.players[0].lastDraw = 3;
    const p = g.ask({ kind: 'discard', seat: 0, tiles: g.players[0].hand.slice(), allowed: g.players[0].hand.slice() });
    const tiles = dom.findAll(dom.byId['seat-0'], n => dom.hasClass(n, 'clickable'));
    assert.strictEqual(tiles.length, 13, '13 张手牌都应可点击');
    const bar = dom.byId['actionbar'];
    assert.ok(bar.children.length > 0, '应提示点击手牌打出');
    tiles[0].click();
    const ans = await p;
    assert.strictEqual(ans.type, 'discard');
    assert.strictEqual(typeof ans.tile, 'number');
  });

  /* ------------------------------------------------------------------ */
  group('听牌提示');

  function H(str) {
    const out = [];
    String(str).trim().split(/\s+/).forEach(part => {
      const m = /^([0-9]+)([tbz])$/.exec(part);
      for (const ch of m[1]) {
        const n = parseInt(ch, 10);
        if (m[2] === 't') out.push(n - 1);
        else if (m[2] === 'b') out.push(9 + n - 1);
        else out.push(17 + n);
      }
    });
    return out.sort((a, b) => a - b);
  }
  const seat0 = () => dom.byId['seat-0'];

  await atest('轮到自己出牌时：显示「打哪张听什么」+ 手牌角标标出和牌张数', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    const p0 = g.players[0];
    p0.hand = H('123456789t 12b 11b 5t');   // 打 5筒 后听 2条 / 3条
    p0.melds = [];
    p0.lastDraw = H('5t')[0];
    const p = g.ask({ kind: 'discard', seat: 0, tiles: p0.hand.slice(), allowed: p0.hand.slice() });

    const waitRow = dom.findAll(seat0(), n => dom.hasClass(n, 'waits'))[0];
    assert.ok(waitRow, '应渲染听牌提示行');
    const chips = dom.findAll(waitRow, n => dom.hasClass(n, 'wait-chip'));
    assert.strictEqual(chips.length, 2, '应显示 2 种听牌张，实际 ' + chips.length);
    const notes = dom.findAll(waitRow, n => dom.hasClass(n, 'wait-note'));
    assert.ok(notes.length && notes[0].textContent.indexOf('屁胡') >= 0,
      '应提示这是屁胡只能自摸：' + (notes[0] && notes[0].textContent));

    // 手牌上的角标（打这张后还剩几张和牌张）
    const badges = dom.findAll(seat0(), n => dom.hasClass(n, 'badge'));
    assert.ok(badges.length > 0, '手牌上应出现和牌张数角标');
    const nums = badges.map(b => parseInt(b.textContent, 10));
    assert.ok(nums.every(n => n >= 0 && n <= 21), '角标应是很小的数字：' + nums.join(','));
    assert.ok(nums.indexOf(7) >= 0, '打 5筒 后 2条+3条 共 7 张，应出现角标 7：' + nums.join(','));

    // 悬停提示（title）应写明打到哪张、听什么
    const tileWithBadge = dom.findAll(seat0(), n => dom.hasClass(n, 'badge')).map(b => b.parentNode)[0];
    assert.ok(tileWithBadge.title.indexOf('听') >= 0, 'title 应说明听什么：' + tileWithBadge.title);

    g.submit({ type: 'discard', tile: p0.lastDraw });
    await p;
  });

  await atest('问「要不要亮倒」时，也显示「打哪张听什么」', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    const p0 = g.players[0];
    p0.hand = H('123456789t 12b 11b 5t');   // 刚摸到 5筒，打掉就听 2条/3条
    p0.melds = [];
    p0.lastDraw = H('5t')[0];
    const p = g.ask({
      kind: 'self', seat: 0, ctx: {},
      actions: [{ type: 'liangdao' }, { type: 'pass' }]
    });

    // 刚摸到的那张要单独拎出来
    const drawnTiles = dom.findAll(seat0(), n => dom.hasClass(n, 'just-drawn'));
    assert.strictEqual(drawnTiles.length, 1, '刚摸的牌应单独显示');
    // 亮倒/过 按钮
    const labels = dom.findAll(dom.byId['actionbar'], n => dom.hasClass(n, 'act')).map(b => b.textContent);
    assert.deepStrictEqual(labels, ['亮倒', '过']);
    // 听牌行应显示「打 5筒 后听」，而不是「未听牌」
    const waitRow = dom.findAll(seat0(), n => dom.hasClass(n, 'waits'))[0];
    assert.ok(waitRow, '应有听牌提示行');
    const chips = dom.findAll(waitRow, n => dom.hasClass(n, 'wait-chip'));
    assert.strictEqual(chips.length, 2, '应显示 2 种听牌张，实际 ' + chips.length);
    const notes = dom.findAll(waitRow, n => dom.hasClass(n, 'wait-note'));
    assert.ok(notes[0].textContent.indexOf('未听牌') < 0,
      '不该显示未听牌：' + notes[0].textContent);
    assert.ok(notes[0].textContent.indexOf('屁胡') >= 0, '应提示屁胡只能自摸：' + notes[0].textContent);
    // 亮倒按钮的悬停说明要写清风险
    const ld = dom.findAll(dom.byId['actionbar'], n => dom.hasClass(n, 'act'))[0];
    assert.ok(ld.title.indexOf('赔双倍') >= 0, '亮倒按钮应说明风险：' + ld.title);

    g.submit({ type: 'pass' });
    await p;
  });

  await atest('不是自己回合时：只显示当前听牌，不显示落听角标', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    const p0 = g.players[0];
    p0.hand = H('123456789t 12b 11b');       // 13 张，已听 2条/3条
    p0.melds = [];
    p0.lastDraw = null;
    g.emit('change', { evt: 'test' });

    const waitRow = dom.findAll(seat0(), n => dom.hasClass(n, 'waits'))[0];
    assert.ok(waitRow, '应渲染听牌提示行');
    const chips = dom.findAll(waitRow, n => dom.hasClass(n, 'wait-chip'));
    assert.strictEqual(chips.length, 2, '应显示 2 种听牌张');
    const badges = dom.findAll(seat0(), n => dom.hasClass(n, 'badge'));
    assert.strictEqual(badges.length, 0, '非出牌阶段不应显示落听角标');
  });

  await atest('亮倒后出牌：只有刚摸的那张可点，并标注「只能摸打」', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    const p0 = g.players[0];
    p0.hand = H('123456789t 12b 11b 9b');   // 已亮倒，刚摸到 9条
    p0.melds = [];
    p0.lastDraw = H('9b')[0];
    p0.liangdao = true;
    p0.liangdaoFresh = false;
    const p = g.ask({
      kind: 'discard', seat: 0, locked: true,
      tiles: p0.hand.slice(), allowed: [H('9b')[0]]
    });

    const clickable = dom.findAll(seat0(), n => dom.hasClass(n, 'clickable'));
    assert.strictEqual(clickable.length, 1, '只应有 1 张可点，实际 ' + clickable.length);
    const badges = dom.findAll(seat0(), n => dom.hasClass(n, 'badge'));
    assert.strictEqual(badges.length, 1, '只该给刚摸的那张标落听角标');
    const locks = dom.findAll(seat0(), n => dom.hasClass(n, 'locked'));
    assert.strictEqual(locks.length, 1, '应标注「已亮倒·只能摸打」');
    assert.ok(locks[0].textContent.indexOf('只能打刚摸') >= 0, locks[0].textContent);

    g.submit({ type: 'discard', tile: H('9b')[0] });
    await p;
  });

  await atest('亮倒者的听张会被标成危险张且不可点', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    const p0 = g.players[0];
    p0.hand = H('11t 234t 567t 99t 2b 3b 5b 7b');   // 含 2条/3条（下家亮倒的听张）
    p0.melds = [];
    p0.lastDraw = null;
    p0.liangdao = false;
    const p1 = g.players[1];
    p1.liangdao = true;
    p1.hand = H('123456789t 12b 11b');               // 听 2条 / 3条

    const banned = [H('2b')[0], H('3b')[0]];
    const allowed = p0.hand.filter(t => banned.indexOf(t) < 0);
    const p = g.ask({
      kind: 'discard', seat: 0, locked: false, forced: false,
      tiles: p0.hand.slice(), allowed: allowed, banned: banned
    });

    const dangerous = dom.findAll(seat0(), n => dom.hasClass(n, 'dangerous'));
    assert.strictEqual(dangerous.length, banned.length,
      '两张危险张都该被标出来，实际 ' + dangerous.length);
    dangerous.forEach(n => {
      assert.ok(n.title.indexOf('放铳') >= 0, '危险张应有放铳提示：' + n.title);
      assert.ok(!dom.hasClass(n, 'clickable'), '危险张不该可点');
    });
    const clickable = dom.findAll(seat0(), n => dom.hasClass(n, 'clickable'));
    assert.strictEqual(clickable.length, allowed.length,
      '只剩安全牌可点，实际 ' + clickable.length + ' / ' + allowed.length);

    g.submit({ type: 'discard', tile: allowed[0] });
    await p;
  });

  await atest('迫不得已时危险张也能点（并带放铳标记）', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    const p0 = g.players[0];
    p0.hand = H('2233445566778t');                   // 全是筒
    p0.melds = [];
    p0.lastDraw = null;
    const p1 = g.players[1];
    p1.liangdao = true;
    p1.hand = H('1112345678999t');                   // 九莲宝灯，1-9 筒全听

    const banned = Array.from(new Set(p0.hand));
    const p = g.ask({
      kind: 'discard', seat: 0, locked: false, forced: true,
      tiles: p0.hand.slice(), allowed: p0.hand.slice(), banned: banned
    });
    const clickable = dom.findAll(seat0(), n => dom.hasClass(n, 'clickable'));
    assert.ok(clickable.length > 0, '迫不得已时必须能出牌');
    const dangerous = dom.findAll(seat0(), n => dom.hasClass(n, 'dangerous'));
    assert.strictEqual(dangerous.length, p0.hand.length, '每张手牌都该带放铳标记');
    g.submit({ type: 'discard', tile: p0.hand[0] });
    await p;
  });

  await atest('问亮倒时可以直接点手牌出牌（不用先点「过」）', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    const p0 = g.players[0];
    p0.hand = H('123456789t 12b 11b 5t');   // 刚摸 5筒，打掉就听 2条/3条
    p0.melds = [];
    p0.lastDraw = H('5t')[0];
    p0.liangdao = false;

    const selfAsk = g.ask({
      kind: 'self', seat: 0, ctx: {},
      actions: [{ type: 'liangdao' }, { type: 'pass' }],
      preview: { allowed: p0.hand.slice(), banned: [], locked: false, forced: false }
    });

    // 亮倒询问期间手牌应该都能直接点
    const clickable = dom.findAll(seat0(), n => dom.hasClass(n, 'clickable'));
    assert.strictEqual(clickable.length, p0.hand.length,
      '问亮倒时手牌都该可点，实际 ' + clickable.length + ' / ' + p0.hand.length);
    const tips = dom.findAll(dom.byId['actionbar'],
      n => n.textContent && n.textContent.indexOf('直接点手牌') >= 0);
    assert.ok(tips.length > 0, '操作栏应提示「不想亮倒就直接点手牌」');

    // 直接点刚摸的那张（手牌行最后一张）
    const drawnTile = H('5t')[0];
    clickable[clickable.length - 1].click();
    const selfAnswer = await selfAsk;
    assert.strictEqual(selfAnswer.type, 'pass',
      '点手牌时应先把「要不要亮倒」按「过」处理，实际 ' + selfAnswer.type);

    // 接着游戏会问出牌 —— 应该自动把刚才点的那张打出去，不用再点一次
    const discardAsk = g.ask({
      kind: 'discard', seat: 0, tiles: p0.hand.slice(),
      allowed: p0.hand.slice(), banned: [], locked: false, forced: false
    });
    const ans = await discardAsk;
    assert.strictEqual(ans.type, 'discard');
    assert.strictEqual(ans.tile, drawnTile, '应该直接打出刚才点的那张牌');
  });

  await atest('对局记录：汇总表 / 折线图 / 每局明细都能渲染', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    // 自己跑几局全电脑对局，凑出历史记录（与测试顺序无关）
    g.players.forEach(p => { p.isAI = true; });
    for (let i = 0; i < 5; i++) await g.startRound();
    assert.ok(g.history.length >= 5, '应记录至少 5 局，实际 ' + g.history.length);

    dom.byId['btn-history'].click();
    const host = dom.byId['modal-host'];
    assert.strictEqual(host.hidden, false, '应弹出记录窗口');
    const html = host.children.map(c => c.innerHTML).join('');

    assert.ok(html.indexOf('战绩汇总') >= 0, '应有战绩汇总');
    assert.ok(html.indexOf('分数走势') >= 0, '应有分数走势图');
    assert.ok(html.indexOf('每局明细') >= 0, '应有每局明细');
    g.players.forEach(p => assert.ok(html.indexOf(p.name) >= 0, '汇总里应有 ' + p.name));
    assert.ok(html.indexOf('胜率') >= 0, '应有胜率列');
    assert.ok(dom.byId['history-chart'], '应生成 canvas 元素');

    // 每局明细：至少 局数 + 2 个表头 行（桩 DOM 不解析 HTML，直接数标签）
    const trCount = (html.match(/<tr/g) || []).length;
    assert.ok(trCount >= g.history.length + 2,
      '明细行数应不少于局数 + 表头，实际 ' + trCount + '，局数 ' + g.history.length);

    // 汇总数字与 Stats 自洽
    const st = win.KWX.Stats.summary(g.players, g.history);
    st.forEach(s => {
      assert.strictEqual(s.rounds, g.history.length);
      assert.ok(s.wins <= s.rounds);
      assert.strictEqual(s.score, g.players[s.seat].score);
    });

    dom.findAll(host, n => dom.hasClass(n, 'btn'))
      .filter(b => b.textContent === '关闭')[0].click();
    assert.strictEqual(host.hidden, true, '记录窗口应能关闭');
  });

  await atest('对局记录里能看到电脑的亮倒奖惩记忆', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    // 手工塞两条记忆，保证断言稳定
    const AIm = win.KWX.AI;
    AIm.noteLiangdaoResult(g.liangdaoLearn[1], '清一色', true);    // 赢过 → ×1.30
    AIm.noteLiangdaoResult(g.liangdaoLearn[1], '七对', false);      // 输过 → ×0.75

    dom.byId['btn-history'].click();
    const host = dom.byId['modal-host'];
    const html = host.children.map(c => c.innerHTML).join('');
    assert.ok(html.indexOf('亮倒奖惩记忆') >= 0, '应展示奖惩记忆章节');
    assert.ok(html.indexOf('清一色') >= 0 && html.indexOf('七对') >= 0, '应列出牌型');
    assert.ok(html.indexOf('×1.30') >= 0, '赢过的牌型倾向上调');
    assert.ok(html.indexOf('×0.75') >= 0, '输过的牌型倾向下调');

    dom.findAll(host, n => dom.hasClass(n, 'btn'))
      .filter(b => b.textContent === '关闭')[0].click();
    assert.strictEqual(host.hidden, true);
  });

  await atest('返回菜单：能回到开始界面，并能再次开始', async () => {
    win.confirm = function () { return true; };   // 绕过拦截确认
    dom.byId['btn-menu'].click();
    assert.strictEqual(dom.byId['start-screen'].hidden, false, '应回到开始界面');
    dom.byId['start-btn'].click();
    assert.strictEqual(dom.byId['start-screen'].hidden, true, '再次开始后应隐藏');
    const g = win.KWX_UI.getGame();
    assert.ok(g && g.roundNo === 1, '应是新对局（第 1 局）');
    assert.strictEqual(g.history.length, 0, '新对局应清空记录');
    g.stop();
  });

  await atest('亮倒的对手：亮出的牌单独一行，手牌行全盖着', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    g.playing = true;   // 只看「局中」的展示（结束时会全部摊开）
    const p1 = g.players[1];
    p1.liangdao = true;
    p1.melds = [];
    // 听 6/9，只需要亮出 78
    p1.liangdaoReveal = H('78t');
    p1.hand = H('1223345578t 111z');
    p1.lastDraw = null;
    g.players[2].hand = H('147b 258b 369b 11z 22z');
    g.emit('change', { evt: 'test' });

    const seat1 = dom.byId['seat-1'];
    const handRow = dom.findAll(seat1, n => dom.hasClass(n, 'hand-row'))[0];
    assert.ok(handRow, '应有手牌行');
    // 手牌行：13 张全盖着
    const handFaces = dom.findAll(handRow, n => dom.hasClass(n, 'tile') && !dom.hasClass(n, 'back'));
    const handBacks = dom.findAll(handRow, n => dom.hasClass(n, 'back'));
    assert.strictEqual(handFaces.length, 0, '手牌行不该露出牌面，实际 ' + handFaces.length);
    assert.strictEqual(handBacks.length, 13, '手牌行应全是牌背，实际 ' + handBacks.length);

    // 单独的「亮倒」行：只有 78 两张
    const revRow = dom.findAll(seat1, n => dom.hasClass(n, 'reveal-row'))[0];
    assert.ok(revRow, '应有单独的亮倒行');
    const revFaces = dom.findAll(revRow, n => dom.hasClass(n, 'tile') && !dom.hasClass(n, 'back'));
    assert.strictEqual(revFaces.length, 2, '亮倒行应有 2 张，实际 ' + revFaces.length);
    const names = revFaces.map(el => el.title.replace('亮倒的牌：', '')).sort();
    const expect = [win.KWX.Tiles.nameOf(H('7t')[0]), win.KWX.Tiles.nameOf(H('8t')[0])].sort();
    assert.deepStrictEqual(names, expect, '亮倒行应是 7筒 8筒，实际 ' + names.join('/'));
  });

  await atest('亮倒的对手会公开听牌信息，未亮倒的不会', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    g.players[1].hand = H('123456789t 12b 11b');
    g.players[1].liangdao = false;
    g.emit('change', { evt: 'test' });
    const before = dom.findAll(dom.byId['seat-1'], n => dom.hasClass(n, 'waits')).length;
    assert.strictEqual(before, 0, '未亮倒对手不应显示听牌');

    g.players[1].liangdao = true;
    g.emit('change', { evt: 'test' });
    const after = dom.findAll(dom.byId['seat-1'], n => dom.hasClass(n, 'waits'));
    assert.strictEqual(after.length, 1, '亮倒后应显示对手听牌');
    assert.strictEqual(dom.findAll(after[0], n => dom.hasClass(n, 'wait-chip')).length, 2);
  });

  /* ------------------------------------------------------------------ */
  group('结算弹窗');

  await atest('赢张不插回手牌，单独摆在手牌右侧', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    await sleep(700);          // 等牌局里可能在跑的那一手彻底停下（避免它插进来重渲染）
    g.playing = false;
    const T = win.KWX.Tiles;
    const hand = H('123456789t 111b 22b');
    const winTile = hand[hand.length - 1];
    const modalHost = dom.byId['modal-host'];
    modalHost.hidden = true;
    modalHost.innerHTML = '';

    const result = {
      type: 'win',
      winners: [{
        seat: 0, name: g.players[0].name, selfDraw: true, winTile: winTile,
        qiangGang: false, gangPao: false, amount: 12,
        hand: hand, melds: [],
        pays: [{ seat: 1, amount: 6 }, { seat: 2, amount: 6 }],
        result: {
          items: [{ name: '卡五星', mult: 2, kind: 'type' }, { name: '清一色', mult: 4, kind: 'type' }],
          sum: 6, cappedSum: 6, capped: 12, liangdaoMul: 2
        }
      }]
    };
    // 自摸赢家的手牌就是 14 张（含赢张），看看牌桌上怎么画
    g.players[0].hand = hand.slice();
    g.players[0].lastDraw = winTile;
    g.players[0].melds = [];
    g.roundResult = result;
    g.emit('roundEnd', result);
    await sleep(500);

    assert.ok(!modalHost.hidden, '应弹出结算弹窗');
    const html = modalHost.children.map(c => c.innerHTML).join('');
    // 赢张单独展示：手牌 + 空档 + 赢张，而不是 14 张连排
    assert.ok(html.indexOf('<span class="win-gap"></span><span class="tile sm win-tile"') >= 0,
      '赢张应紧跟空档单独展示，实际：' + html.slice(html.indexOf('row melds'), html.indexOf('row melds') + 260));
    assert.strictEqual(html.split('win-tile').length - 1, 1, '只应有一个赢张标记');
    // 加算明细仍然正确展示
    assert.ok(html.indexOf('卡五星 +2') >= 0 && html.indexOf('清一色 +4') >= 0, '应列出番型加算');
    assert.ok(html.indexOf('番数和 6') >= 0, '番数和应为 6');
    assert.ok(html.indexOf('亮倒 最后 ×2') >= 0, '亮倒应单独展示为最后 ×2');
    assert.ok(html.indexOf('合计 12 分') >= 0, '合计应为 12 分，实际弹窗：' + html.replace(/<[^>]+>/g, ' ').slice(0, 200));

    // 牌桌上也一样：赢张单独一格摆在手牌右侧
    const seat0 = dom.byId['seat-0'];
    const handRow = dom.findAll(seat0, n => dom.hasClass(n, 'hand-row'))[0];
    assert.ok(handRow, '应有手牌行');
    const winTiles = dom.findAll(handRow, n => dom.hasClass(n, 'win-tile'));
    assert.strictEqual(winTiles.length, 1, '牌桌上应只有 1 张赢张单列，实际 ' + winTiles.length);
    const faces = dom.findAll(handRow, n => dom.hasClass(n, 'tile') && !dom.hasClass(n, 'win-tile') && !dom.hasClass(n, 'back'));
    assert.strictEqual(faces.length, 13, '赢张之外手牌应剩 13 张，实际 ' + faces.length);
    const kids = handRow.children;
    const last = kids[kids.length - 1], prev = kids[kids.length - 2];
    assert.ok(dom.hasClass(last, 'win-tile'), '赢张应排在整行的最右边');
    assert.ok(dom.hasClass(prev, 'gap'), '赢张前面应有一个空档');
    assert.strictEqual(T.nameOf(winTile), last.title.replace('本局赢张：', ''), '单列的应是本局赢张');
  });

  await atest('结算弹窗点外面不关，点「下一局」才关', async () => {
    const g = win.KWX_UI.getGame();
    const modalHost = dom.byId['modal-host'];
    assert.ok(!modalHost.hidden, '结算弹窗应还在（上一项测试留下的）');

    modalHost.click();                       // 点背景
    await sleep(10);
    assert.ok(!modalHost.hidden && modalHost.children.length > 0,
      '点弹窗外面不该把结算弹窗关掉（否则会卡住进不了下一局）');

    const btns = dom.findAll(modalHost, n => dom.hasClass(n, 'btn'));
    const next = btns.filter(b => b.textContent === '下一局')[0];
    assert.ok(next, '结算弹窗应有「下一局」按钮');
    next.click();
    await sleep(10);
    assert.ok(modalHost.hidden, '点「下一局」后弹窗应关闭');
    g.stop();
  });

  await atest('底金 5 的屁胡被杠上炮：弹窗是 番数和 2 / 合计 10 分（不是 15）', async () => {
    const g = win.KWX_UI.getGame();
    g.stop();
    await sleep(700);          // 同样等牌局里在跑的那一手停下
    g.playing = false;
    const baseBefore = g.rules.baseScore;
    g.rules.baseScore = 5;
    try {
      const pit = H('123456789t 12b 11b');         // 听 3条，屁胡
      const tile = H('3b')[0];
      const res = win.KWX.Rules.canWinOnDiscard(pit, [], tile, {
        rules: g.rules, gangPao: true, gangPaoIndex: 1
      });
      assert.strictEqual(res.isPitHu, true, '这手牌本身还是屁胡');
      assert.strictEqual(res.capped, 2, '番数和应为 2（杠上炮 2，不再加屁胡的底 1）');

      const modalHost = dom.byId['modal-host'];
      modalHost.hidden = true;
      modalHost.innerHTML = '';
      const result = {
        type: 'win',
        winners: [{
          seat: 0, name: g.players[0].name, selfDraw: false, fromSeat: 1, winTile: tile,
          qiangGang: false, gangPao: true, amount: 10,
          hand: pit, melds: [],
          pays: [{ seat: 1, amount: 10 }],
          result: res
        }]
      };
      g.players[0].hand = pit.slice();
      g.players[0].lastDraw = null;
      g.roundResult = result;
      g.emit('roundEnd', result);
      await sleep(500);

      const html = modalHost.children.map(c => c.innerHTML).join('');
      assert.ok(html.indexOf('杠上炮 ×2') >= 0, '应把杠上炮显示成乘算 ×2');
      assert.ok(html.indexOf('番数和 2') >= 0, '番数和应为 2，实际：' + html.replace(/<[^>]+>/g, ' ').slice(0, 160));
      assert.ok(html.indexOf('合计 10 分') >= 0, '合计应为 10 分（底金 5 × 2 倍底金）');
      assert.ok(html.indexOf('底 +1') < 0, '有番时不该再显示「底 +1」');
    } finally {
      g.rules.baseScore = baseBefore;
      dom.byId['modal-host'].hidden = true;
      dom.byId['modal-host'].innerHTML = '';
    }
  });

  /* ------------------------------------------------------------------ */
  group('手机版布局（竖屏 / 横屏）');

  await atest('setLayout：竖屏把四个方框搬进中间空当，横屏/桌面搬回顶栏', async () => {
    const ui = win.KWX_UI;
    const g = ui.getGame();
    if (g) g.stop();
    const body = dom.byId['body'] || win.document.body;

    ui.setLayout('portrait');
    assert.strictEqual(ui.getLayout(), 'portrait', '布局应切到竖屏');
    assert.ok(dom.hasClass(body, 'layout-mobile') && dom.hasClass(body, 'layout-portrait'),
      'body 应带 layout-mobile layout-portrait，实际 "' + body.className + '"');
    assert.strictEqual(dom.byId['hud'].parentNode, dom.byId['center-col'],
      '竖屏：四个方框应搬进中间空当 center-col');

    ui.setLayout('landscape');
    assert.ok(dom.hasClass(body, 'layout-landscape') && !dom.hasClass(body, 'layout-portrait'),
      'body 应切成 layout-landscape');
    assert.strictEqual(dom.byId['hud'].parentNode, dom.byId['topbar'], '横屏：四个方框应回到顶栏');

    ui.setLayout('desktop');
    assert.strictEqual(ui.getLayout(), 'desktop');
    assert.ok(!dom.hasClass(body, 'layout-mobile'), '桌面版 body 不该有任何 layout class');
    assert.strictEqual(dom.byId['hud'].parentNode, dom.byId['topbar']);
  });

  await atest('手机版二次点击出牌：第一次选中、第二次才真的打出', async () => {
    const ui = win.KWX_UI;
    const g = ui.getGame();
    g.stop();
    ui.setLayout('portrait');
    const p0 = g.players[0];
    p0.hand = H('123456789t 123b 11b');
    p0.melds = [];
    p0.lastDraw = null;
    const p = g.ask({
      kind: 'discard', seat: 0, locked: false,
      tiles: p0.hand.slice(), allowed: p0.hand.slice(), banned: []
    });
    const tiles = dom.findAll(dom.byId['seat-0'], n => dom.hasClass(n, 'clickable'));
    assert.ok(tiles.length > 0, '轮到自己出牌时手牌应可点');
    const t = tiles[0];
    const code = Number(t.dataset.tile);

    t.click();                                    // 第一次：只选中，不打出
    assert.ok(dom.hasClass(t, 'picked'), '第一次点应抬起（picked）');
    assert.strictEqual(ui.getMobilePicked(), t, '应记住选中的这张');
    assert.ok(dom.hasClass(dom.byId['confirm-bar'], 'show'), '应出现顶部确认条');
    const barBtns = dom.findAll(dom.byId['confirm-bar'], n => n.tagName === 'BUTTON');
    assert.ok(barBtns.some(b => b.textContent === '打出'), '确认条应有「打出」按钮');
    assert.ok(barBtns.some(b => b.textContent === '取消'), '确认条应有「取消」按钮');
    assert.ok(g.pending, '第一次点不该真的出牌');

    t.click();                                    // 第二次：真打
    await p;
    assert.ok(!dom.hasClass(dom.byId['confirm-bar'], 'show'), '打出后确认条应消失');
    // 这一问被消费掉 = 确实提交了出牌（引擎那边的落子由 game.test.js 覆盖）
    assert.ok(!g.pending, '第二次点之后应已提交出牌');
    assert.strictEqual(ui.getMobilePicked(), null, '选中态应清掉');
  });

  await atest('手机版长按手牌：显示「打这张听什么」，且那一下不算点选', async () => {
    const ui = win.KWX_UI;
    const g = ui.getGame();
    g.stop();
    ui.setLayout('portrait');
    const p0 = g.players[0];
    p0.hand = H('123456789t 123b 11b');
    p0.melds = [];
    p0.lastDraw = null;
    const p = g.ask({
      kind: 'discard', seat: 0, locked: false,
      tiles: p0.hand.slice(), allowed: p0.hand.slice(), banned: []
    });
    const t = dom.findAll(dom.byId['seat-0'], n => dom.hasClass(n, 'clickable'))[0];
    t.dispatchEvent({ type: 'pointerdown', target: t });
    await sleep(420);
    const info = dom.byId['tile-info'];
    assert.ok(dom.hasClass(info, 'show'), '长按后应出现信息条');
    assert.ok(info.innerHTML.length > 0, '信息条应有内容：' + info.innerHTML);

    t.click();                                    // 长按结束的那一下不该出牌
    assert.ok(g.pending, '长按之后紧接着的点击不该出牌');
    assert.ok(!dom.hasClass(t, 'picked'), '也不该被选中');

    g.submit({ type: 'discard', tile: Number(t.dataset.tile) });
    await p;
    ui.setLayout('desktop');                      // 还原，别影响别的用例
  });

  /* ------------------------------------------------------------------ */
  console.log('\n----------------------------------------');
  console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  if (failed) {
    console.log('\n失败明细：');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
