/*
 * 手机版样张的冒烟测试（开发用，不是游戏本体的自测）
 * 用 jsdom 真的把 preview/*.html 跑起来：加载真实 tiles.js、执行 preview.js，
 * 然后断言「手牌/牌背/牌河/亮倒行/危险张/抽屉/点选确认」这些结构都对。
 *
 * 需要 jsdom（仓库本体不带依赖，所以缺了就跳过）：
 *   npm i jsdom            # 或者在别处装了以后： NODE_PATH=<那个 node_modules> node tests/preview.smoke.js
 * 运行：
 *   node tests/preview.smoke.js               # 两个样张都测
 *   node tests/preview.smoke.js portrait      # 只测竖屏
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

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
    // jsdom 的 cssom 解析不了 d vh / env() 这类新语法，跟样张逻辑无关，忽略
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
  // 等外链脚本（tiles.js / preview.js）与内联的 PREVIEW.render() 真的跑完
  for (let i = 0; i < 100 && !win.PREVIEW; i++) await sleep(20);
  await sleep(20);
  return { dom, win, doc: win.document, errors };
}

function count(root, sel) { return root.querySelectorAll(sel).length; }
function click(win, el) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function check(name, file) {
  console.log('\n' + name + '（' + file + '）');
  const env = await load(file);
  const { win, doc, errors } = env;
  const $ = sel => doc.querySelector(sel);
  const $$ = sel => Array.from(doc.querySelectorAll(sel));

  test('脚本没有抛异常', () => {
    assert(errors.length === 0, errors.join(' | '));
    assert(win.PREVIEW, 'window.PREVIEW 不存在（preview.js 没跑起来？）');
  });

  test('手牌：13 张 + 刚摸的那张单独拎出来（金边 + 角标）', () => {
    const hand = $('#mHand');
    eq(hand.querySelectorAll('.tile').length, 14, '手牌总数');
    eq(hand.querySelectorAll('.tile.just-drawn').length, 1, '刚摸的牌数量');
    eq(hand.querySelectorAll('.sep').length, 1, '刚摸牌前面的空档');
    const drawn = hand.querySelector('.tile.just-drawn');
    const badge = drawn.querySelector('.badge');
    assert(badge, '刚摸的那张应有「打这张后还剩几张」角标');
    eq(badge.textContent, '5', '角标数字应是 5（四筒×2 + 七筒×3）');
    assert(badge.classList.contains('warn'), '屁胡的角标应是金色（warn）');
    assert(hand.classList.contains('compact'), '默认应是紧凑档');
  });

  test('听牌条：写清「打 九筒 → 听 四筒×2、七筒×3」', () => {
    const t = $('#mWaits').textContent.replace(/\s+/g, '');
    assert(/打九筒/.test(t), '应写「打 九筒」，实际：' + t);
    assert(/四筒/.test(t) && /七筒/.test(t), '应列出 四筒/七筒 两个听张，实际：' + t);
    assert(/屁胡/.test(t), '应标明屁胡只能自摸，实际：' + t);
  });

  test('对手面板：牌背数量 + 副露 + 未亮倒标签', () => {
    const top = $('[data-opp="top"]');
    eq(top.querySelectorAll('.tile.back').length, 13, '上家牌背数');
    assert(/未亮倒/.test(top.textContent), '上家初始应显示未亮倒');
    const bot = $('[data-opp="bottom"]');
    eq(bot.querySelectorAll('.tile.back').length, 10, '下家牌背数（碰过一副）');
    eq(bot.querySelectorAll('.meld-group .tile').length, 3, '下家副露应是 1 副碰 = 3 张');
  });

  test('牌河：上家 18 张、下家 18 张、自己 12 张，最新的那张有金框', () => {
    eq(count($('[data-river="top"]'), '.tile'), 18, '上家牌河');
    eq(count($('[data-river="bottom"]'), '.tile'), 18, '下家牌河');
    eq(count($('[data-river="self"]'), '.tile'), 12, '自己牌河');
    eq(count($('[data-river="top"]'), '.tile.newest'), 1, '最新一张的标记');
  });

  test('中央信息：剩余张数 + 最近打出', () => {
    const t = $('#mCenter').textContent.replace(/\s+/g, '');
    assert(/剩余42张/.test(t), '应显示剩余张数，实际：' + t);
    assert(/打出/.test(t), '应显示最近谁打出了什么，实际：' + t);
    assert(count($('#mCenter'), '.tile') === 1, '最近打出的牌应显示 1 张');
  });

  test('正常状态：按钮是 暗杠/补杠/亮倒/过', () => {
    const acts = $$('#mActions .act').map(b => b.textContent.replace(/\s+/g, ''));
    eq(acts.length, 4, '按钮数量');
    assert(acts[2].indexOf('亮倒') === 0, '第 3 个应是亮倒，实际 ' + acts.join('/'));
    assert(count($('#mActions'), '.act.pass') === 1, '应有「过」');
  });

  // ---- 切到「上家亮倒」----
  test('切到「上家亮倒」：亮倒行只亮 45678条 + 公开听牌 + 你手里 3 张铳牌', () => {
    click(win, $('[data-view="state:danger"]'));
    const top = $('[data-opp="top"]');
    assert(/已亮倒/.test(top.textContent), '上家应显示已亮倒');
    eq(count(top, '.m-reveal .tile'), 5, '亮出的牌应是 5 张（45678条）');
    eq(count(top, '.waits .wait-chip'), 3, '公开听牌应是 3 种（3/6/9条）');
    const rev = Array.from(top.querySelectorAll('.m-reveal .tile')).map(t => t.dataset.tile).join(',');
    eq(rev, '12,13,14,15,16', '亮出的应是 4~8条');
    eq(count($('#mHand'), '.tile.dangerous'), 3, '我手里应有 3 张铳牌（3/6/9条）');
    assert($('#mHand').querySelector('.tile.dangerous').dataset.guard === '1', '铳牌应被标记 guard');
    const acts = $$('#mActions .act').map(b => b.textContent.replace(/\s+/g, ''));
    assert(acts.some(a => a.indexOf('胡') === 0), '应出现胡（上家打出的牌能胡）');
  });

  test('点铳牌：不选中，只弹提示', () => {
    const guard = $('#mHand .tile.dangerous');
    click(win, guard);
    assert(!guard.classList.contains('picked'), '铳牌不该被选中');
    assert($('#toast').classList.contains('show'), '应弹出提示');
    assert(/放铳/.test($('#toast').textContent), '提示应说明会放铳，实际：' + $('#toast').textContent);
  });

  // ---- 切到「我亮倒」----
  test('切到「我亮倒」：听张锁死、手牌变灰、只有刚摸那张可点', () => {
    click(win, $('[data-view="state:selfLd"]'));
    assert($('#mWaits .lock'), '听牌条应有「已亮倒」标签');
    assert(/只能打刚摸的那张/.test($('#mWaits').textContent), '应提示只能摸打');
    const hand = $('#mHand');
    eq(count(hand, '.tile.disabled'), 13, '13 张手牌应变灰');
    const drawn = hand.querySelector('.tile.just-drawn');
    assert(!drawn.classList.contains('disabled'), '刚摸的那张不该变灰');
    assert(drawn.dataset.pickable === '1', '刚摸的那张应可点');
    const acts = $$('#mActions .act').map(b => b.textContent.replace(/\s+/g, ''));
    eq(acts.length, 2, '亮倒后只剩 胡/过');
  });

  // ---- 回到正常，测点选确认与抽屉 ----
  test('点手牌 → 抬起 + 顶部确认条；再点一次取消', () => {
    click(win, $('[data-view="state:normal"]'));
    const tile = $('#mHand .tile.just-drawn');
    click(win, tile);
    assert(tile.classList.contains('picked'), '点一下应抬起（picked）');
    assert($('#confirmBar').classList.contains('show'), '应出现顶部确认条');
    assert(/打出/.test($('#confirmBar').textContent), '确认条应有「打出」按钮');
    click(win, tile);
    assert(!$('#confirmBar').classList.contains('show'), '再点一次应收起确认条');
    assert(!tile.classList.contains('picked'), '再点一次应落回');
  });

  test('确认条上的「打出」能点，并给出反馈', () => {
    click(win, $('#mHand .tile.just-drawn'));
    click(win, $('#confirmBar [data-confirm="go"]'));
    assert(!$('#confirmBar').classList.contains('show'), '打出后确认条应消失');
    assert($('#toast').classList.contains('show'), '应给出反馈');
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

  test('点「亮倒」→ 风险确认抽屉；取消能关掉', () => {
    click(win, $('#mActions [data-act="liangdao"]'));
    assert($('#sheet').classList.contains('show'), '应弹出抽屉');
    assert(/确定亮倒/.test($('#sheet').textContent), '抽屉标题应是确定亮倒');
    assert(/只能摸打/.test($('#sheet').textContent) && /翻倍/.test($('#sheet').textContent),
      '抽屉里应列出风险（只能摸打 / 输钱翻倍）');
    click(win, $('#sheet [data-sheet-act="cancel"]'));
    assert(!$('#sheet').classList.contains('show'), '取消后抽屉应关闭');
  });

  test('点「胡」→ 结算抽屉（赢张单独摆出来 + 番型和）', () => {
    click(win, $('[data-view="state:danger"]'));   // 这个状态下才有「胡」按钮
    const hu = $('#mActions [data-act="hu"]');
    assert(hu, '应出现「胡」按钮');
    click(win, hu);
    const t = $('#sheet').textContent;
    assert(/自摸|胡牌/.test(t), '结算抽屉应有结果');
    assert(/亮倒/.test(t) && /×2/.test(t), '应显示亮倒整体 ×2');
    eq(count($('#sheet'), '.win-tile'), 1, '赢张应单独摆出来（1 张）');
    assert(count($('#sheet'), '.pay-table') >= 1, '应有结算表');
    click(win, $('#sheet [data-sheet-act="close"], #sheet [data-sheet-act="next"]'));
  });

  test('顶部「记录」抽屉：汇总表 + 折线图位 + 亮倒奖惩记忆', () => {
    click(win, $('[data-sheet="history"]'));
    const t = $('#sheet').textContent;
    assert(/对局记录/.test(t), '应有对局记录');
    assert(/战绩汇总/.test(t), '应有汇总');
    assert(/分数走势/.test(t), '应有折线图区');
    assert(/亮倒奖惩记忆/.test(t), '应有亮倒奖惩记忆');
    click(win, $('#sheet [data-sheet-act="close"]'));
  });

  test('「牌河精简」档位生效', () => {
    click(win, $('[data-view="river:short"]'));
    eq(count($('[data-river="top"]'), '.tile'), 9, '精简后上家牌河应只剩最后 9 张');
    click(win, $('[data-view="river:full"]'));
    eq(count($('[data-river="top"]'), '.tile'), 18, '切回完整应是 18 张');
  });

  test('手牌大小档位能切（紧凑/标准/大字/两行）', () => {
    const hand = $('#mHand');
    click(win, $('[data-view="handSize:standard"]'));
    assert(hand.classList.contains('standard'), '应切到标准档');
    click(win, $('[data-view="handSize:big"]'));
    assert(hand.classList.contains('big'), '应切到大字档');
    click(win, $('[data-view="handSize:twoRows"]'));
    assert(hand.classList.contains('two-rows'), '应切到两行档，实际 class=' + hand.className);
    eq(hand.querySelectorAll('.tile').length, 14, '两行档也得是 14 张');
    click(win, $('[data-view="handSize:compact"]'));
    assert(hand.classList.contains('compact'), '应切回紧凑档');
  });

  env.dom.window.close();
}

(async () => {
  const only = (process.argv[2] || '').toLowerCase();
  if (!only || only === 'portrait' || only === 'all') {
    await check('竖屏样张', 'portrait.html');
  }
  if (!only || only === 'landscape' || only === 'all') {
    await check('横屏样张', 'landscape.html');
  }
  console.log('\n----------------------------------------');
  console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  if (failed) {
    console.log('\n失败明细：');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})();
