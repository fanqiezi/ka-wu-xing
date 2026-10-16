/*
 * 手机版样张的冒烟测试（开发用，不是游戏本体的自测）
 * 用 jsdom 把 preview/*.html 真的跑起来：加载真实 tiles.js、执行 preview.js，
 * 断言结构（四个方框的位置、牌背/副露/牌河、亮倒行、危险张、抽屉、二次点击出牌…）
 *
 * 需要 jsdom（仓库本体不带依赖，缺了自动跳过）：
 *   npm i jsdom        # 或 NODE_PATH=<装了 jsdom 的 node_modules> node tests/preview.smoke.js
 * 运行：
 *   node tests/preview.smoke.js              # 竖屏 + 横屏
 *   node tests/preview.smoke.js portrait     # 只测竖屏
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM = null, VirtualConsole = null;
try {
  const jd = require('jsdom');
  JSDOM = jd.JSDOM;
  VirtualConsole = jd.VirtualConsole;
} catch (e) {
  console.log('（跳过样张冒烟测试：没有安装 jsdom。装了再跑：npm i jsdom）');
  process.exit(0);
}

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  ✗ ' + name + '\n        ' + e.message); }
}
function assert(ok, msg) { if (!ok) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + '：期望 ' + b + '，实际 ' + a); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function load(file) {
  const target = path.join(__dirname, '..', 'preview', file);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    // jsdom 的 cssom 解析不了 dvh / env() 这类新语法，跟样张逻辑无关，忽略
    if (/Could not parse CSS|Error: Could not parse CSS/.test(e.message)) return;
    errors.push(e.message);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = await JSDOM.fromFile(target, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc
  });
  const win = dom.window;
  if (win.document.readyState !== 'complete') {
    await new Promise(r => win.addEventListener('load', r));
  }
  for (let i = 0; i < 100 && !win.PREVIEW; i++) await sleep(20);
  await sleep(20);
  return { dom, win, doc: win.document, errors };
}

function click(win, el) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function check(name, file) {
  const isPortrait = file.indexOf('portrait') === 0;
  console.log('\n' + name + '（' + file + '）');
  const env = await load(file);
  const { win, doc, errors } = env;
  const $ = sel => doc.querySelector(sel);
  const $$ = sel => Array.from(doc.querySelectorAll(sel));
  const count = sel => doc.querySelectorAll(sel).length;

  test('脚本没有抛异常', () => {
    assert(errors.length === 0, errors.join(' | '));
    assert(win.PREVIEW, 'window.PREVIEW 不存在（preview.js 没跑起来？）');
  });

  test('顶部一行不换行：CSS 里 nowrap，且标题副标题在手机上隐藏', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'preview', 'preview.css'), 'utf8');
    assert(/white-space:\s*nowrap/.test(css), 'preview.css 应有 white-space: nowrap（顶部不换行）');
    assert(/\.brand\s+\.sub\s*\{\s*display:\s*none/.test(css), '手机版应隐藏品牌副标题（省一行）');
    assert(!$('.brand .sub') || /display:\s*none/.test(css), '副标题不该占位');
  });

  test('四个方框：局数/底金/剩余牌/庄家', () => {
    const items = $$('.hud .hud-item');
    eq(items.length, 4, '方框数量');
    const txt = $$('.hud .hud-item').map(n => n.textContent.replace(/\s+/g, '')).join('|');
    ['局数', '底金', '剩余牌', '庄家'].forEach(k => assert(txt.indexOf(k) >= 0, '缺 ' + k + '：' + txt));
    eq($('#hud-round').textContent, '12', '局数');
    eq($('#hud-base').textContent, '5', '底金');
    eq($('#hud-wall').textContent, '42', '剩余牌');
    eq($('#hud-dealer').textContent, '你', '庄家');
  });

  if (isPortrait) {
    test('竖屏：四个方框在中间空当（.center-col 里），右侧对局记录收进按钮', () => {
      assert($('.center-col .hud'), '竖屏的四个方框应放在 .center-col（中间空当）');
      assert(!$('.topbar .hud'), '竖屏顶栏不该再放四个方框');
      assert($('[data-sheet="history"]'), '竖屏应有「对局记录」按钮（折叠入口）');
      const css = fs.readFileSync(path.join(__dirname, '..', 'preview', 'preview.css'), 'utf8');
      assert(/body\.portrait\s+\.sidebar\s*\{\s*display:\s*none/.test(css), '竖屏应隐藏右侧记录栏');
    });
  } else {
    test('横屏：等同电脑版 —— 四个方框在顶栏、右侧保留对局记录栏', () => {
      assert($('.topbar .hud'), '横屏的四个方框应在顶栏');
      assert($('.sidebar .log'), '横屏应保留右侧对局记录栏');
      assert($('[data-sheet="history"]'), '横屏也保留「对局记录」按钮（开悬浮窗）');
    });
  }

  test('上家面板：13 张牌背 + 未亮倒标签 + 分数', () => {
    const top = $('[data-opp="top"]');
    eq(top.querySelectorAll('.tile.back').length, 13, '上家牌背数');
    assert(/未亮倒/.test(top.textContent), '初始应显示未亮倒');
    assert(/上家/.test(top.textContent), '应有名字');
  });

  test('下家面板：10 张牌背 + 1 副碰（3 张）', () => {
    const bot = $('[data-opp="bottom"]');
    eq(bot.querySelectorAll('.tile.back').length, 10, '下家牌背数');
    eq(bot.querySelectorAll('.meld-group .tile').length, 3, '副露应是 3 张');
  });

  test('牌河：上家 18、下家 18、自己 12，最新一张有金框', () => {
    eq($('[data-opp="top"] .row.discards .discards-list').querySelectorAll('.tile').length, 18, '上家牌河');
    eq($('[data-opp="bottom"] .row.discards .discards-list').querySelectorAll('.tile').length, 18, '下家牌河');
    eq($('[data-opp="self"] .row.discards .discards-list').querySelectorAll('.tile').length, 12, '自己牌河');
    eq($('[data-opp="top"] .row.discards .tile.newest').length === undefined ? 1 : 1, 1, '');
    eq($('[data-opp="top"] .row.discards .discards-list').querySelectorAll('.tile.newest').length, 1, '最新一张');
  });

  test('手牌：13 张 + 刚摸的那张单独拎出来（金边 + 角标 + 空档）', () => {
    const hand = $('#mHand');
    eq(hand.querySelectorAll('.tile').length, 14, '手牌总数');
    eq(hand.querySelectorAll('.tile.just-drawn').length, 1, '刚摸的牌');
    eq(hand.querySelectorAll('.gap').length, 1, '刚摸牌前的空档');
    const drawn = hand.querySelector('.tile.just-drawn');
    const badge = drawn.querySelector('.badge');
    assert(badge, '刚摸的那张应有角标');
    eq(badge.textContent, '5', '角标数字（四筒×2 + 七筒×3）');
    assert(badge.classList.contains('warn'), '屁胡角标应是金色 warn');
    assert(hand.classList.contains('compact'), '默认应是紧凑档');
  });

  test('听牌行：写清「打 九筒 → 听 四筒×2、七筒×3（共 5 张 · 屁胡只能自摸）」', () => {
    const t = $('[data-opp="self"] .row.waits').textContent.replace(/\s+/g, '');
    assert(/打九筒/.test(t), '应写「打 九筒」，实际：' + t);
    assert(/四筒/.test(t) && /七筒/.test(t), '应列出两个听张，实际：' + t);
    assert(/屁胡/.test(t), '应标明屁胡只能自摸，实际：' + t);
  });

  test('中央信息：轮到谁 + 最近打出 + 剩余张数', () => {
    assert(/轮到/.test($('#turnIndicator').textContent), '应有轮次提示');
    eq($('#centerTiles').querySelectorAll('.tile').length, 1, '最近打出的牌应显示 1 张');
    assert(/剩余/.test($('#centerMeta').textContent), '应显示剩余张数');
  });

  test('正常状态：操作栏是 暗杠/补杠/亮倒/过', () => {
    const acts = $$('#actionbar .act').map(b => b.textContent.replace(/\s+/g, ''));
    eq(acts.length, 4, '按钮数量');
    assert(acts[2].indexOf('亮倒') === 0, '第 3 个应是亮倒，实际 ' + acts.join('/'));
    assert(count('#actionbar .act.pass') === 1, '应有「过」');
  });

  // ---------- 上家亮倒 ----------
  test('切「上家亮倒」：亮倒行只亮 45678条 + 公开听牌 + 手里 3 张铳牌', () => {
    click(win, $('[data-view="state:danger"]'));
    const top = $('[data-opp="top"]');
    assert(/已亮倒/.test(top.textContent), '上家应显示已亮倒');
    eq(top.querySelectorAll('.row.reveal-row .tile').length, 5, '亮出的应是 5 张');
    eq(top.querySelectorAll('.row.reveal-row .wait-chip').length, 3, '公开听牌应是 3 种');
    eq(top.querySelectorAll('.row.reveal-row .tile')[0].dataset.tile, '12', '第一张应是 4条');
    eq(count('#mHand .tile.dangerous'), 3, '手里应有 3 张铳牌');
    assert($('#mHand .tile.dangerous').dataset.guard === '1', '铳牌应标记 guard');
    assert($$('#actionbar .act').map(b => b.textContent).join('').indexOf('胡') >= 0, '应出现「胡」');
  });

  test('点铳牌：不选中，只弹提示', () => {
    const guard = $('#mHand .tile.dangerous');
    click(win, guard);
    assert(!guard.classList.contains('picked'), '铳牌不该被选中');
    assert($('#toast').classList.contains('show'), '应有提示');
    assert(/放铳/.test($('#toast').textContent), '提示应说明会放铳');
  });

  // ---------- 我亮倒 ----------
  test('切「我亮倒」：听张锁死、手牌变灰、只有刚摸那张可点', () => {
    click(win, $('[data-view="state:selfLd"]'));
    const waits = $('[data-opp="self"] .row.waits');
    assert(/已亮倒/.test(waits.textContent) && /只能打刚摸的那张/.test(waits.textContent),
      '听牌行应提示已亮倒只能摸打，实际：' + waits.textContent);
    eq(count('#mHand .tile.disabled'), 13, '13 张手牌应变灰');
    const drawn = $('#mHand .tile.just-drawn');
    assert(!drawn.classList.contains('disabled'), '刚摸的那张不该变灰');
    assert(drawn.dataset.pickable === '1', '刚摸的那张应可点');
    eq($$('#actionbar .act').length, 2, '亮倒后只剩 胡/过');
  });

  // ---------- 二次点击出牌 ----------
  test('二次点击出牌：点一下抬起 + 顶部确认条，再点一次取消', () => {
    click(win, $('[data-view="state:normal"]'));
    const tile = $('#mHand .tile.just-drawn');
    click(win, tile);
    assert(tile.classList.contains('picked'), '点一下应抬起');
    assert($('#confirmBar').classList.contains('show'), '应出现顶部确认条');
    assert(/打出/.test($('#confirmBar').textContent), '确认条应有「打出」');
    click(win, tile);
    assert(!$('#confirmBar').classList.contains('show'), '再点一次应收起');
    assert(!tile.classList.contains('picked'), '再点一次应落回');
  });

  test('确认条「打出」能点，并给出反馈', () => {
    click(win, $('#mHand .tile.just-drawn'));
    click(win, $('#confirmBar [data-confirm="go"]'));
    assert(!$('#confirmBar').classList.contains('show'), '打出后确认条应消失');
    assert($('#toast').classList.contains('show'), '应有反馈');
  });

  test('长按手牌 → 底部信息条说明「打这张听什么」', async () => {
    const tile = $('#mHand .tile.just-drawn');
    const bar = $('#infoBar');
    assert(tile && bar, '手牌/信息条节点应存在');
    tile.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await sleep(480);
    assert(bar.classList.contains('show'), '长按后应出现信息条');
    assert(/听/.test(bar.textContent), '信息条应说明听什么，实际：' + bar.textContent);
  });

  test('点「亮倒」→ 风险确认悬浮窗；取消能关掉', () => {
    click(win, $('#actionbar [data-act="liangdao"]'));
    assert($('#sheet').classList.contains('show'), '应弹出悬浮窗');
    assert(/确定亮倒/.test($('#sheet').textContent), '标题应是确定亮倒');
    assert(/只能摸打/.test($('#sheet').textContent) && /翻倍/.test($('#sheet').textContent), '应列出风险');
    click(win, $('#sheet [data-sheet-act="cancel"]'));
    assert(!$('#sheet').classList.contains('show'), '取消后应关闭');
  });

  test('点「胡」→ 结算悬浮窗（赢张单独摆出 + 亮倒 ×2）', () => {
    click(win, $('[data-view="state:danger"]'));
    click(win, $('#actionbar [data-act="hu"]'));
    const t = $('#sheet').textContent;
    assert(/自摸|胡牌/.test(t), '应有结果');
    assert(/×2/.test(t), '应显示亮倒整体 ×2');
    eq($('#sheet').querySelectorAll('.win-tile').length, 1, '赢张应单独摆出');
    assert($('#sheet').querySelectorAll('.pay-table').length >= 1, '应有结算表');
    click(win, $('#sheet [data-sheet-act="close"], #sheet [data-sheet-act="next"]'));
  });

  test('「对局记录」按钮 → 悬浮窗（汇总 + 折线图位 + 亮倒奖惩记忆）', () => {
    click(win, $('[data-sheet="history"]'));
    const t = $('#sheet').textContent;
    assert(/对局记录/.test(t) && /战绩汇总/.test(t), '应有汇总');
    assert(/分数走势/.test(t), '应有折线图区');
    assert(/亮倒奖惩记忆/.test(t), '应有亮倒奖惩记忆');
    assert($('#sheet').classList.contains('wide'), '手机上记录应做成悬浮窗（wide）');
    click(win, $('#sheet [data-sheet-act="close"]'));
  });

  test('「牌河精简」档位生效', () => {
    click(win, $('[data-view="river:short"]'));
    eq($('[data-opp="top"] .row.discards .discards-list').querySelectorAll('.tile').length, 9, '精简后应剩 9 张');
    click(win, $('[data-view="river:full"]'));
    eq($('[data-opp="top"] .row.discards .discards-list').querySelectorAll('.tile').length, 18, '切回应是 18 张');
  });

  test('手牌大小档位能切（紧凑/标准/大字/两行）', () => {
    const hand = () => $('#mHand');
    click(win, $('[data-view="handSize:standard"]'));
    assert(hand().classList.contains('standard'), '应切到标准档');
    click(win, $('[data-view="handSize:big"]'));
    assert(hand().classList.contains('big'), '应切到大字档');
    click(win, $('[data-view="handSize:twoRows"]'));
    assert(hand().classList.contains('two-rows'), '应切到两行档，实际 ' + hand().className);
    eq(hand().querySelectorAll('.tile').length, 14, '两行档也得是 14 张');
    click(win, $('[data-view="handSize:compact"]'));
    assert(hand().classList.contains('compact'), '应切回紧凑档');
  });

  env.dom.window.close();
}

(async () => {
  const only = (process.argv[2] || '').toLowerCase();
  if (!only || only === 'portrait' || only === 'all') await check('竖屏样张', 'portrait.html');
  if (!only || only === 'landscape' || only === 'all') await check('横屏样张', 'landscape.html');
  console.log('\n----------------------------------------');
  console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  if (failed) {
    console.log('\n失败明细：');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})();
