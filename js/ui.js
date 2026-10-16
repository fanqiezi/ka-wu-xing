/*
 * 卡五星麻将 —— 界面与交互
 */
(function () {
  'use strict';

  var T = window.KWX.Tiles;
  var R = window.KWX.Rules;
  var AI = window.KWX.AI;
  var Game = window.KWX.Game;

  var SETTING_DEFS = [
    { key: 'baseScore', label: '底金', type: 'select', options: [[1, '1 分'], [2, '2 分'], [5, '5 分']] },
    { key: 'cap', label: '封顶倍数', type: 'select', options: [[8, '×8 封顶'], [16, '×16 封顶'], [0, '不封顶']] },
    {
      key: 'pitHuOnlyZimo', label: '屁胡（小胡）只能自摸，不能捉炮', type: 'checkbox',
      note: '卡五星通行规则。关闭后屁胡也能胡别人打出的牌（即网上常见的那版“bug”玩法）。'
    },
    {
      key: 'liangdaoPitHuCanDianPao', label: '自己亮倒后，屁胡也能捉别人的炮', type: 'checkbox',
      note: '默认开启：亮倒后牌已摊开，屁胡也能胡别人打出的牌。'
    },
    { key: 'liangdaoEnabled', label: '允许亮倒（听牌后亮牌，番数 ×2）', type: 'checkbox' },
    {
      key: 'liangdaoLockHand', label: '亮倒后只能摸打，不能再改听张', type: 'checkbox',
      note: '亮倒之后每巡只能打出刚摸到的那张牌，不能再换听、也不能碰；补杠/暗杠/直杠仍然允许。'
    },
    {
      key: 'liangdaoDianPaoAsZimo', label: '点炮亮倒者按「相当于自摸」算两份', type: 'checkbox',
      note: '默认关闭：亮倒的 ×2 已经算在番数里，点炮者只出一份。打开则回到旧玩法（点炮者一人出两份）。'
    },
    {
      key: 'noDealInLiangdao', label: '不许故意打出亮倒者的听张（迫不得已除外）', type: 'checkbox',
      note: '别人亮倒后，你就不能往他的听张上打——哪怕这样会让你自己听不了牌。手里全是危险张时才被迫放铳。'
    },
    {
      key: 'liangdaoPayDouble', label: '亮倒者输钱一律翻倍', type: 'checkbox',
      note: '只要你自己亮倒了，输钱就翻倍：点炮翻倍，别人自摸时你也要付双倍（不看赢家有没有亮倒）。'
    },
    {
      key: 'liangdaoDiscardPitHu', label: '亮倒的人打出的牌，屁胡也能胡', type: 'checkbox',
      note: '摊了牌就得认：亮倒之后你的弃牌对所有人都是危险牌，连屁胡都能胡你。'
    },
    {
      key: 'liangdaoHuangPei', label: '荒局时亮倒的人要赔听牌者（按其牌型番数）', type: 'checkbox',
      note: '亮倒的人哪怕自己也听牌，荒局时仍要赔给每个听牌对手「底金 × 对方牌型番数」。'
    },
    {
      key: 'huangzhuangPeiToLiangdao', label: '荒局时未听牌者仍要赔给亮倒者', type: 'checkbox',
      note: '默认关闭：亮倒的人自己有赔听义务，别人就不必再赔给他了。'
    },
    {
      key: 'gangPaoPitHu', label: '杠后打出的牌（杠上炮），屁胡也能胡', type: 'checkbox',
      note: '杠完那一手打出来的牌，即使赢家只是屁胡也能胡；倍数按「第几杠 × 2」算。'
    },
    { key: 'gangScore', label: '结算杠分（暗杠 2 倍 / 明杠 1 倍 / 直杠 2 倍）', type: 'checkbox' },
    { key: 'huangzhuangPei', label: '荒庄赔听（查大叫：未听牌赔听牌）', type: 'checkbox' },
    { key: 'speed', label: '电脑思考速度', type: 'select', options: [[200, '快'], [520, '正常'], [900, '慢']] }
  ];

  var settings = {
    baseScore: 1,
    cap: 8,
    pitHuOnlyZimo: true,
    liangdaoPitHuCanDianPao: true,
    liangdaoEnabled: true,
    liangdaoLockHand: true,
    liangdaoDianPaoAsZimo: false,
    noDealInLiangdao: true,
    liangdaoPayDouble: true,
    liangdaoDiscardPitHu: true,
    liangdaoHuangPei: true,
    huangzhuangPeiToLiangdao: false,
    gangPaoPitHu: true,
    gangScore: true,
    huangzhuangPei: true,
    speed: 520
  };

  var game = null;
  var state = null;
  var pendingAsk = null;
  var el = {};
  var toastTimer = null;
  var queuedDiscard = null;   // 在「问亮倒」时先点好的那张牌

  /* ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }

  function init() {
    el.seat0 = $('seat-0');
    el.seat1 = $('seat-1');
    el.seat2 = $('seat-2');
    el.actionbar = $('actionbar');
    el.log = $('log');
    el.modalHost = $('modal-host');
    el.turnIndicator = $('turn-indicator');
    el.centerTiles = $('center-tiles');
    el.centerMeta = $('center-meta');
    el.hudRound = $('hud-round');
    el.hudBase = $('hud-base');
    el.hudWall = $('hud-wall');
    el.hudDealer = $('hud-dealer');
    el.startScreen = $('start-screen');

    $('btn-newmatch').addEventListener('click', function () {
      if (confirm('开始新对局？当前分数会清零。')) newMatch();
    });
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-rules').addEventListener('click', openRules);
    $('btn-history').addEventListener('click', openHistory);
    $('btn-menu').addEventListener('click', function () {
      if (game && game.playing && !confirm('返回开始菜单？这一局会中断（可随时点「开始游戏」重开）。')) return;
      showStartScreen();
    });
    $('btn-clear-log').addEventListener('click', function () { el.log.innerHTML = ''; });

    // 开始界面上的按钮
    $('start-btn').addEventListener('click', startGame);
    $('start-history').addEventListener('click', openHistory);
    $('start-rules').addEventListener('click', openRules);
    $('start-settings').addEventListener('click', openSettings);

    el.modalHost.addEventListener('click', function (e) {
      // 对局结算弹窗点外面不关，免得卡住没法进下一局
      if (e.target === el.modalHost && !modalPersistent) closeModal();
    });

    // 手机版：顶部确认条（二次点击出牌）
    var cbar = $('confirm-bar');
    if (cbar) {
      cbar.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-confirm]') : null;
        if (!b) return;
        var tile = mobilePicked && mobilePicked.dataset ? Number(mobilePicked.dataset.tile) : null;
        if (b.dataset.confirm === 'go') {
          clearMobilePick();
          if (tile !== null && !isNaN(tile)) answer({ type: 'discard', tile: tile });
        } else {
          clearMobilePick();
        }
      });
    }

    // 手机版布局：自动判定 + 转屏/改窗口时重新判定
    applyLayout();
    if (window.addEventListener) {
      var relayout = function () {
        clearTimeout(relayout._t);
        relayout._t = setTimeout(function () { applyLayout(); }, 150);
      };
      window.addEventListener('resize', relayout);
      window.addEventListener('orientationchange', relayout);
    }

    // 先停在开始界面，不自动开局
    showStartScreen();
  }

  /* ------------------------------------------------------------------ */
  /* 开始游戏界面                                                        */

  function renderStartModes() {
    var host = $('start-modes');
    if (!host) return;
    host.innerHTML = '';
    var card = document.createElement('div');
    card.className = 'mode-card active';
    card.innerHTML = '<b>1 人对战</b><span>你 vs 2 个电脑</span>';
    host.appendChild(card);
    var tip = document.createElement('div');
    tip.className = 'mode-more';
    tip.textContent = '2 人 / 三人 / 四人对战（含四家轮换）稍后加入';
    host.appendChild(tip);
  }

  function showStartScreen() {
    if (game && game.playing) game.stop();
    closeModal();
    pendingAsk = null;
    queuedDiscard = null;
    el.actionbar.innerHTML = '';
    renderStartModes();
    var tip = $('start-tip');
    if (tip) {
      var s = settings;
      tip.textContent = '当前设置：底金 ' + s.baseScore + ' · 封顶 ' +
        (s.cap > 0 ? '×' + s.cap : '不封顶') + ' · 屁胡' +
        (s.pitHuOnlyZimo ? '只能自摸' : '可以捉炮') + ' · 亮倒' +
        (s.liangdaoEnabled ? '开启' : '关闭') + pwaTip();
    }
    el.startScreen.hidden = false;
    render();
  }

  /** 手机上给一句「怎么装到桌面」的提示（装了就不再提示） */
  function pwaTip() {
    try {
      var ua = navigator.userAgent || '';
      var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        navigator.standalone === true;
      if (standalone || location.protocol === 'file:') return '';
      var iOS = /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (iOS) return '\n装到桌面：点底部分享 → 添加到主屏幕（全屏、断网也能玩）';
      if (/Android/.test(ua) && window.innerWidth <= 820) {
        return '\n装到桌面：浏览器菜单 → 安装应用 / 添加到主屏幕（全屏、断网也能玩）';
      }
      return '';
    } catch (e) { return ''; }
  }

  function startGame() {
    el.startScreen.hidden = true;
    newMatch();   // 每次从菜单进入都开一局新的对局
  }

  /* ------------------------------------------------------------------ */

  function newMatch() {
    if (game) game.stop();
    closeModal();
    el.log.innerHTML = '';
    pendingAsk = null;
    queuedDiscard = null;
    el.actionbar.innerHTML = '';
    game = new Game({ rules: settings, speed: settings.speed });
    bindGame(game);
    render();
    runRound(game);
  }

  function runRound(g) {
    g.startRound().catch(function (err) {
      console.error(err);
      toast('出错了：' + err.message, 4000);
    });
  }

  function bindGame(g) {
    g.on('change', function () {
      if (g !== game) return;
      render();
    });
    g.on('ask', function (payload) {
      if (g !== game) return;
      // 刚才在「问亮倒」时玩家已经点了某张牌 -> 这一问直接按那张出，不用再点一次
      if (payload.kind === 'discard' && queuedDiscard !== null) {
        var t = queuedDiscard;
        queuedDiscard = null;
        if (payload.allowed.indexOf(t) >= 0) {
          pendingAsk = payload;
          render();
          setTimeout(function () {
            if (pendingAsk === payload) answer({ type: 'discard', tile: t });
          }, 0);
          return;
        }
        toast('这张牌现在不能打（' + T.nameOf(t) + '），请重新选一张', 2400);
      }
      pendingAsk = payload;
      render();
    });
    g.on('askEnd', function () {
      if (g !== game) return;
      pendingAsk = null;
      render();
    });
    g.on('log', function (entry) {
      if (g !== game) return;
      var d = document.createElement('div');
      d.className = entry.cls || '';
      d.textContent = entry.text;
      el.log.appendChild(d);
      el.log.scrollTop = el.log.scrollHeight;
      while (el.log.childNodes.length > 300) el.log.removeChild(el.log.firstChild);
    });
    g.on('pitHuBlocked', function (d) {
      if (g !== game) return;
      toast('屁胡不能捉炮：' + T.nameOf(d.tile) + ' 只能自摸', 2600);
    });
    g.on('roundEnd', function (result) {
      if (g !== game) return;
      pendingAsk = null;
      render();   // 先把牌面摊开（赢家的赢张会单独摆在手牌右侧）
      setTimeout(function () { showRoundResult(result); }, 420);
    });
    g.on('liangdao', function (d) {
      if (g !== game) return;
      toast(g.players[d.seat].name + ' 亮倒！', 1800);
    });
  }

  function answer(ans) {
    if (!game || !pendingAsk) return;
    pendingAsk = null;
    el.actionbar.innerHTML = '';
    game.submit(ans);
    render();
  }

  /**
   * 玩家点了一张手牌。
   * 如果当前正在问「要不要亮倒/杠」，就先把那一问按「过」处理，
   * 然后等出牌询问到了直接把这张打出去 —— 不用先点「过」再出牌。
   */
  function pickTile(tile, node) {
    if (!pendingAsk) return;
    if (pendingAsk.kind === 'self') {
      queuedDiscard = tile;
      answer({ type: 'pass' });
      return;
    }
    // 手机版：二次点击出牌（第一次选中、第二次才真打），防误触
    if (isMobileLayout()) { mobilePick(tile, node); return; }
    answer({ type: 'discard', tile: tile });
  }

  /* ------------------------------------------------------------------ */
  /* 手机版布局：桌面版完全不受影响（body 上不加任何 class，行为不变）   */
  /* ------------------------------------------------------------------ */

  var layoutMode = 'desktop';        // 'desktop' | 'portrait' | 'landscape'
  var mobilePicked = null;           // 手机版二次点击出牌：已经选中的那张

  function isMobileLayout() { return layoutMode !== 'desktop'; }

  /** 判断该用哪套布局：优先 ?layout=，其次看指针类型与屏幕大小 */
  function detectLayoutMode() {
    var qs = (window.location && window.location.search) || '';
    var forced = /[?&]layout=(desktop|mobile|portrait|landscape)/.exec(qs);
    var f = forced ? forced[1] : '';
    if (f === 'desktop') return 'desktop';
    var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    var w = window.innerWidth || 0, h = window.innerHeight || 0;
    var small = (w > 0 && w <= 820) || (h > 0 && h <= 560);
    if (f === 'portrait') return 'portrait';
    if (f === 'landscape') return 'landscape';
    if (f === 'mobile') return h >= w ? 'portrait' : 'landscape';
    if (!coarse && !small) return 'desktop';
    return h >= w ? 'portrait' : 'landscape';
  }

  /** 竖屏：把四个方框搬到中间空当；其它布局搬回顶栏 */
  function placeHud(mode) {
    var hud = $('hud'), centerCol = $('center-col'), topbar = $('topbar'), topbtns = document.querySelector
      ? document.querySelector('.topbtns') : null;
    if (!hud || !centerCol || !topbar) return;
    if (mode === 'portrait') {
      if (hud.parentNode !== centerCol && centerCol.insertBefore) {
        centerCol.insertBefore(hud, centerCol.firstChild || null);
      }
    } else if (hud.parentNode !== topbar && topbar.insertBefore) {
      topbar.insertBefore(hud, topbtns || null);
    }
  }

  /** 切换布局：加 body class（CSS 全靠它）+ 搬四个方框 + 重渲染 */
  function applyLayout(mode) {
    layoutMode = mode || detectLayoutMode();
    if (document.body && document.body.classList) {
      document.body.classList.remove('layout-mobile', 'layout-portrait', 'layout-landscape');
      if (layoutMode !== 'desktop') {
        document.body.classList.add('layout-mobile');
        document.body.classList.add(layoutMode === 'portrait' ? 'layout-portrait' : 'layout-landscape');
      }
    }
    clearMobilePick();
    placeHud(layoutMode);
    if (game) render();
  }

  /** 清掉手机版的选中态与确认条 */
  function clearMobilePick() {
    if (mobilePicked && mobilePicked.classList) mobilePicked.classList.remove('picked');
    mobilePicked = null;
    var bar = $('confirm-bar');
    if (bar && bar.classList) { bar.classList.remove('show'); bar.innerHTML = ''; }
  }

  /** 手机版长按：显示这张牌的说明（桌面版靠 title 悬停，手机没有 hover） */
  function showTileInfo(node, tile) {
    var box = $('tile-info');
    if (!box || !node) return;
    var code = tile !== undefined ? tile : Number(node.dataset ? node.dataset.tile : NaN);
    var name = isNaN(code) ? '' : T.nameOf(code) + ' —— ';
    box.innerHTML = '<b>' + name + '</b>' + (node.title || '');
    box.classList.add('show');
    clearTimeout(showTileInfo._t);
    showTileInfo._t = setTimeout(function () { box.classList.remove('show'); }, 3200);
  }

  /** 手机版二次点击出牌：第一次点=选中（抬起+确认条），第二次点=打出 */
  function mobilePick(tile, node) {
    if (mobilePicked && node && mobilePicked === node) {
      clearMobilePick();
      answer({ type: 'discard', tile: tile });
      return;
    }
    clearMobilePick();
    if (node) {
      node.classList.add('picked');
      mobilePicked = node;
    }
    var bar = $('confirm-bar');
    if (!bar) { answer({ type: 'discard', tile: tile }); return; }
    bar.innerHTML = '';
    var txt = document.createElement('span');
    txt.textContent = '已选 ' + T.nameOf(tile) + '（' + (node && node.title ? node.title : '再点一次打出') + '）';
    bar.appendChild(txt);
    var sp = document.createElement('span');
    sp.className = 'sp';
    bar.appendChild(sp);
    var go = document.createElement('button');
    go.textContent = '打出';
    go.dataset.confirm = 'go';
    var no = document.createElement('button');
    no.className = 'ghost';
    no.textContent = '取消';
    no.dataset.confirm = 'cancel';
    bar.appendChild(go);
    bar.appendChild(no);
    bar.classList.add('show');
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                                */
  /* ------------------------------------------------------------------ */

  function makeTile(tile, size, opts) {
    opts = opts || {};
    var d = document.createElement('div');
    d.className = 'tile ' + size;
    if (opts.cls) d.className += ' ' + opts.cls;
    d.dataset.tile = String(tile);
    d.title = opts.title || T.nameOf(tile);
    // 大牌（玩家手牌）额外显示数字角标，方便快速读数
    d.innerHTML = T.faceSvg(tile, { numeral: size === 'lg' || size === 'md' });
    if (opts.badge !== undefined && opts.badge !== null) {
      var b = document.createElement('span');
      b.className = 'badge' + (opts.badgeWarn ? ' warn' : '');
      b.textContent = opts.badge;
      d.appendChild(b);
    }
    if (opts.onClick) {
      d.classList.add('clickable');
      // 手机版：长按 380ms 看这张牌的说明（相当于桌面版的悬停提示）
      if (isMobileLayout()) {
        var lp = null;
        d.addEventListener('pointerdown', function () {
          clearTimeout(lp);
          lp = setTimeout(function () {
            d._suppressClick = true;
            showTileInfo(d, tile);
          }, 380);
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
          d.addEventListener(ev, function () { clearTimeout(lp); });
        });
      }
      d.addEventListener('click', function (e) {
        if (d._suppressClick) { d._suppressClick = false; return; }   // 长按结束的那一下不算点选
        opts.onClick.call(d, e);
      });
    }
    return d;
  }

  function makeBack(size, opts) {
    opts = opts || {};
    var d = document.createElement('div');
    d.className = 'tile ' + size + ' back';
    if (opts.cls) d.className += ' ' + opts.cls;
    d.innerHTML = T.backSvg();
    return d;
  }

  function meldGroup(meld, size) {
    var g = document.createElement('div');
    g.className = 'meld-group' + (meld.kind === 'pong' ? '' : ' kong');
    var n = meld.kind === 'pong' ? 3 : 4;
    for (var i = 0; i < n; i++) {
      g.appendChild(makeTile(meld.tile, size));
    }
    return g;
  }

  function seatHead(p, isSelf) {
    var head = document.createElement('div');
    head.className = 'seat-head';
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = p.name + (isSelf ? '（你）' : '');
    head.appendChild(who);

    if (state.dealer === p.seat) {
      var t = document.createElement('span');
      t.className = 'tag dealer';
      t.textContent = '庄';
      head.appendChild(t);
    }
    if (p.liangdao) {
      var t2 = document.createElement('span');
      t2.className = 'tag liangdao';
      t2.textContent = '亮倒';
      head.appendChild(t2);
    } else if (isSelf && p.tenpai) {
      // 听牌是私有信息：只显示自己的，别人没亮倒就不该被看出来
      var t3 = document.createElement('span');
      t3.className = 'tag tenpai';
      t3.textContent = '听牌';
      head.appendChild(t3);
    }
    var sc = document.createElement('span');
    sc.className = 'score' + (p.score < 0 ? ' neg' : '');
    sc.textContent = (p.score > 0 ? '+' : '') + p.score;
    head.appendChild(sc);
    return head;
  }

  function isAsking(seat, kind) {
    return pendingAsk && pendingAsk.kind === kind && pendingAsk.seat === seat;
  }

  /* ------------------------------------------------------------------ */
  /* 听牌提示                                                            */
  /* ------------------------------------------------------------------ */

  var waitCache = { key: '', value: null };

  /** 从某个座位视角看到的剩余牌（扣除自己手牌 + 所有牌河 + 所有副露） */
  function remainFor(seat) {
    return AI.buildRemain({
      hand: state.players[seat].hand,
      discards: state.players.map(function (p) { return p.discards; }),
      meldsByPlayer: state.players.map(function (p) { return p.melds; })
    });
  }

  /** 一副 13 张手牌的听牌信息：听哪些张、各剩几张、最大牌型番数 */
  function waitInfoOf(hand13, melds, remain, rules) {
    var waits = R.waitingTiles(hand13, melds);
    if (!waits.length) return null;
    var counts = T.countsOf(hand13);
    var fan = 1;
    var list = [];
    var total = 0;
    for (var i = 0; i < waits.length; i++) {
      var w = waits[i];
      var rem = remain ? remain[w] : 4;
      list.push({ tile: w, remain: rem });
      total += rem;
      if (counts[w] < 4) {
        counts[w]++;
        var res = R.scoreWin({
          tiles: T.tilesOfCounts(counts), melds: melds, winTile: w, selfDraw: true, rules: rules
        });
        counts[w]--;
        if (res && res.typeFan > fan) fan = res.typeFan;
      }
    }
    return { waits: list, total: total, fan: fan, isPitHu: fan === 1 };
  }

  /**
   * 玩家（座位 0）的听牌提示：
   *   current   —— 当前 13 张手牌的听牌
   *   byDiscard —— 出牌阶段每个可打张「打出去之后会听什么」
   */
  function playerWaitHints() {
    var p = state.players[0];
    // 「刚摸完牌」的两种询问（该你出牌 / 问你要不要杠·亮倒）都要算落听
    var acting = !!pendingAsk && (pendingAsk.kind === 'discard' || pendingAsk.kind === 'self');
    var key = p.hand.join(',') + '|' + p.melds.map(function (m) { return m.kind + ':' + m.tile; }).join(',') +
      '|' + (acting ? 'act' : 'rest') + '|' + state.players.map(function (q) {
        return q.discards.length + '/' + q.melds.length;
      }).join(',');
    if (waitCache.key === key) return waitCache.value;

    var remain = remainFor(0);
    var out = {
      current: waitInfoOf(p.hand, p.melds, remain, state.rules),
      byDiscard: {}, best: null, bestTile: null,
      locked: !!(pendingAsk && (pendingAsk.locked ||
        (pendingAsk.preview && pendingAsk.preview.locked)))
    };
    if (acting) {
      // 亮倒之后只能摸打，那就只在「允许打出的牌」里算落听
      var allowedList = null;
      if (pendingAsk && pendingAsk.allowed) allowedList = pendingAsk.allowed;
      else if (pendingAsk && pendingAsk.preview) allowedList = pendingAsk.preview.allowed;
      var seen = {};
      p.hand.forEach(function (t) {
        if (seen[t]) return;
        seen[t] = 1;
        if (allowedList && allowedList.indexOf(t) < 0) return;
        var info = waitInfoOf(Game.without(p.hand, t, 1), p.melds, remain, state.rules);
        if (!info) return;
        out.byDiscard[t] = info;
        if (!out.best || info.total > out.best.total) { out.best = info; out.bestTile = t; }
      });
    }
    waitCache = { key: key, value: out };
    return out;
  }

  function describeWaits(info) {
    return info.waits.map(function (w) {
      return T.shortOf(w.tile) + '×' + w.remain;
    }).join('、');
  }

  /** 一行「听什么」的展示 */
  function makeWaitRow(info, opt) {
    opt = opt || {};
    var row = document.createElement('div');
    row.className = 'row waits';
    var lab = document.createElement('span');
    lab.className = 'row-label';
    lab.textContent = opt.label || '听牌';
    row.appendChild(lab);

    if (!info) {
      var none = document.createElement('span');
      none.className = 'wait-note';
      none.textContent = opt.emptyText || '未听牌';
      row.appendChild(none);
      return row;
    }
    info.waits.forEach(function (w) {
      var chip = document.createElement('span');
      chip.className = 'wait-chip' + (w.remain <= 0 ? ' empty' : '');
      chip.title = T.nameOf(w.tile) + '　还剩 ' + w.remain + ' 张';
      chip.appendChild(makeTile(w.tile, 'xs'));
      var cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = '×' + w.remain;
      chip.appendChild(cnt);
      row.appendChild(chip);
    });
    var note = document.createElement('span');
    note.className = 'wait-note' + (info.isPitHu ? ' danger' : ' good');
    note.textContent = info.isPitHu
      ? '共 ' + info.total + ' 张 · 屁胡只能自摸'
      : '共 ' + info.total + ' 张 · ' + info.fan + ' 倍牌型（可捉炮）';
    row.appendChild(note);
    if (opt.locked) {
      var lock = document.createElement('span');
      lock.className = 'wait-note locked';
      lock.textContent = '已亮倒 · 只能打刚摸的那张';
      row.appendChild(lock);
    }
    return row;
  }

  /** 本局的结果里，这个座位是不是赢家 */
  function isRoundWinner(seat) {
    if (!game || !game.roundResult || game.roundResult.type !== 'win') return false;
    return game.roundResult.winners.some(function (w) { return w.seat === seat; });
  }

  function renderSeat(seat, container, isSelf, size) {
    var p = state.players[seat];
    container.innerHTML = '';
    container.classList.toggle('active', state.playing && state.currentSeat === seat);
    container.appendChild(seatHead(p, isSelf));

    // 手牌
    var handRow = document.createElement('div');
    handRow.className = 'hand-row';
    var hand = p.hand.slice().sort(function (a, b) { return a - b; });
    var drawn = null;
    var isWinTile = false;
    // 摸完牌之后（无论是「该你出牌」还是「问你要不要杠/亮倒」）都把刚摸的牌单独拎出来，
    // 这样玩家一眼能看出「这张是我刚摸到的」
    var afterDraw = isSelf && p.lastDraw !== null &&
      (isAsking(0, 'discard') || isAsking(0, 'self'));
    // 本局结束时：自摸赢家的手牌是 14 张，把赢张单独拎到右手边展示（不插回手牌）
    if (isRoundWinner(seat) && p.lastDraw !== null && p.hand.length % 3 === 2) {
      afterDraw = true;
      isWinTile = true;
    }
    if (afterDraw) {
      drawn = p.lastDraw;
      var idx = hand.lastIndexOf(drawn);
      if (idx >= 0) hand.splice(idx, 1);
    }
    // 出牌询问、以及亮倒询问（带 preview）时，手牌都可以直接点
    var askingDiscard = isAsking(seat, 'discard');
    var askingSelf = isAsking(seat, 'self');
    var preview = (askingSelf && pendingAsk.preview) ? pendingAsk.preview : null;
    var allowed = askingDiscard ? pendingAsk.allowed : (preview ? preview.allowed : null);
    var banned = askingDiscard ? pendingAsk.banned : (preview ? preview.banned : null);
    var canPick = (askingDiscard || (askingSelf && preview)) && allowed;
    var reveal = isSelf || p.liangdao || !state.playing;
    // 亮倒的对手：亮出的那几张单独拿一行展示，手牌行一律盖着
    var showRevealRow = !isSelf && p.liangdao && state.playing && !!p.reveal;
    // 自己出牌时给出「打这张会听什么」的角标
    var hints = (isSelf && (askingDiscard || askingSelf)) ? playerWaitHints() : null;

    hand.forEach(function (t) {
      if (reveal && !showRevealRow) {
        var dis = allowed && allowed.indexOf(t) < 0;
        var danger = banned && banned.indexOf(t) >= 0;
        var info = hints ? hints.byDiscard[t] : null;
        var opts = {
          cls: dis ? 'disabled' : '',
          badge: info ? info.total : null,
          badgeWarn: info ? info.isPitHu : false,
          title: info
            ? '打 ' + T.nameOf(t) + ' → 听 ' + describeWaits(info) +
              (info.isPitHu ? '（屁胡，只能自摸）' : '（' + info.fan + ' 倍牌型，可捉炮）')
            : null,
          onClick: (canPick && !dis) ? function () { pickTile(t, this); } : null
        };
        if (danger) {
          opts.cls = (opts.cls ? opts.cls + ' ' : '') + 'dangerous';
          opts.title = '这是亮倒者的听张，打出去就是放铳' + (opts.title ? '\n' + opts.title : '');
        }
        handRow.appendChild(makeTile(t, size, opts));
      } else {
        handRow.appendChild(makeBack(size));
      }
    });
    if (drawn !== null) {
      var gap = document.createElement('div');
      gap.className = 'gap';
      handRow.appendChild(gap);
      var dis2 = allowed && allowed.indexOf(drawn) < 0;
      var info2 = hints ? hints.byDiscard[drawn] : null;
      handRow.appendChild(makeTile(drawn, size, {
        cls: (isWinTile ? 'win-tile' : 'just-drawn') + (dis2 ? ' disabled' : ''),
        badge: info2 ? info2.total : null,
        badgeWarn: info2 ? info2.isPitHu : false,
        title: isWinTile
          ? '本局赢张：' + T.nameOf(drawn)
          : (info2
            ? '打 ' + T.nameOf(drawn) + ' → 听 ' + describeWaits(info2) +
              (info2.isPitHu ? '（屁胡，只能自摸）' : '（' + info2.fan + ' 倍牌型，可捉炮）')
            : null),
        onClick: (canPick && !dis2) ? function () { pickTile(drawn, this); } : null
      }));
    }
    // 副露与牌河
    var meldRow = document.createElement('div');
    meldRow.className = 'row melds';
    var lab1 = document.createElement('span');
    lab1.className = 'row-label';
    lab1.textContent = '副露';
    meldRow.appendChild(lab1);
    p.melds.forEach(function (m) { meldRow.appendChild(meldGroup(m, size)); });

    var discRow = document.createElement('div');
    discRow.className = 'row discards';
    var lab2 = document.createElement('span');
    lab2.className = 'row-label';
    lab2.textContent = '牌河';
    discRow.appendChild(lab2);
    // 牌河里的牌包一层 .discards-list：手机版靠它做「限高 + 上下滑动」
    var discList = document.createElement('div');
    discList.className = 'discards-list';
    p.discards.forEach(function (t, i) {
      var newest = state.lastDiscard && state.lastDiscard.seat === seat &&
        i === p.discards.length - 1;
      discList.appendChild(makeTile(t, size, { cls: newest ? 'newest' : '' }));
    });
    discRow.appendChild(discList);

    if (isSelf) {
      // 听牌提示放在手牌正上方；摸完牌后直接显示「打哪张听什么」
      var selfHints = playerWaitHints();
      var acting = isAsking(0, 'discard') || isAsking(0, 'self');
      var showBest = acting && selfHints.best;
      container.appendChild(meldRow);
      container.appendChild(discRow);
      container.appendChild(makeWaitRow(showBest ? selfHints.best : selfHints.current, {
        label: showBest ? ('打 ' + T.shortOf(selfHints.bestTile) + ' 后听') : '听牌',
        emptyText: acting
          ? '未听牌（手牌角标数字＝打这张后共剩几张和牌张）'
          : '未听牌',
        locked: selfHints.locked
      }));
      container.appendChild(handRow);
    } else {
      container.appendChild(handRow);
      // 亮倒的牌单独一行展示（不在手牌原位）
      if (showRevealRow) {
        var revRow = document.createElement('div');
        revRow.className = 'row reveal-row';
        var rlab = document.createElement('span');
        rlab.className = 'row-label';
        rlab.textContent = '亮倒';
        revRow.appendChild(rlab);
        p.reveal.forEach(function (t) {
          revRow.appendChild(makeTile(t, size, { title: '亮倒的牌：' + T.nameOf(t) }));
        });
        container.appendChild(revRow);
      }
      // 亮倒的对手手牌已经公开，顺便把他的听牌也标出来
      if (p.liangdao && p.hand.length % 3 === 1) {
        var info = waitInfoOf(p.hand, p.melds, remainFor(seat), state.rules);
        if (info) container.appendChild(makeWaitRow(info, { label: '听牌' }));
      }
      container.appendChild(meldRow);
      container.appendChild(discRow);
    }
  }

  function render() {
    if (!game) return;
    state = game.snapshot();
    state.currentSeat = currentTurnSeat();
    renderSeat(0, el.seat0, true, 'lg');
    renderSeat(1, el.seat1, false, 'sm');
    renderSeat(2, el.seat2, false, 'sm');
    renderCenter();
    renderActions();
    el.hudRound.textContent = state.roundNo;
    el.hudBase.textContent = state.rules.baseScore;
    el.hudWall.textContent = state.wallCount;
    el.hudDealer.textContent = state.players[state.dealer].name;
  }

  function currentTurnSeat() {
    if (pendingAsk) return pendingAsk.seat;
    return -1;
  }

  function renderCenter() {
    el.centerTiles.innerHTML = '';
    el.centerMeta.textContent = '牌墙剩余 ' + state.wallCount + ' 张' +
      (state.gangChain > 0 ? ' · 杠上杠 ×' + Math.pow(2, state.gangChain - 1) : '');

    if (state.lastDiscard) {
      el.centerTiles.appendChild(makeTile(state.lastDiscard.tile, 'md'));
      var note = document.createElement('div');
      note.style.fontSize = '11px';
      note.style.color = '#a8c2b6';
      note.style.marginLeft = '8px';
      note.textContent = state.players[state.lastDiscard.seat].name + ' 打出 ' + T.nameOf(state.lastDiscard.tile);
      el.centerTiles.appendChild(note);
    }

    var text = '准备开始';
    if (state.playing) {
      if (pendingAsk) {
        if (pendingAsk.kind === 'discard') text = '轮到你出牌';
        else if (pendingAsk.kind === 'self') text = '你可以操作';
        else if (pendingAsk.kind === 'claim') text = '可以吃碰杠胡（卡五星不能吃）';
      } else {
        var seat = state.nextSeat;
        text = seat >= 0 ? state.players[seat].name + ' 行动中…' : '进行中…';
      }
    } else {
      text = '本局结束';
    }
    el.turnIndicator.textContent = text;
  }

  function renderActions() {
    el.actionbar.innerHTML = '';
    if (!pendingAsk || !game) return;

    if (pendingAsk.kind === 'discard') {
      var hint = document.createElement('div');
      hint.style.cssText = 'font-size:13px;color:#a8c2b6;padding:8px 6px;';
      hint.textContent = '点击手牌打出';
      el.actionbar.appendChild(hint);
      return;
    }

    if (pendingAsk.kind === 'self') {
      var ldHint = null;
      if (pendingAsk.actions.some(function (a) { return a.type === 'liangdao'; })) {
        var h = playerWaitHints();
        ldHint = '亮倒：番数 ×2，但手牌公开、且亮倒后点炮要赔双倍。';
        if (h.best) {
          ldHint += '\n当前打 ' + T.nameOf(h.bestTile) + ' 可听 ' + describeWaits(h.best) +
            '（' + h.best.fan + ' 倍牌型' + (h.best.isPitHu ? '，屁胡只能自摸' : '，可捉炮') + '）';
        } else if (h.current) {
          ldHint += '\n当前听 ' + describeWaits(h.current) +
            '（' + h.current.fan + ' 倍牌型' + (h.current.isPitHu ? '，屁胡只能自摸' : '，可捉炮') + '）';
        }
      }
      pendingAsk.actions.forEach(function (a) {
        if (a.type === 'hu') {
          el.actionbar.appendChild(actBtn('胡', 'hu', function () { answer({ type: 'hu', result: a.result }); }));
        } else if (a.type === 'ankong') {
          el.actionbar.appendChild(actBtn('暗杠 ' + T.shortOf(a.tile), 'kong', function () { answer(a); }));
        } else if (a.type === 'addkong') {
          el.actionbar.appendChild(actBtn('补杠 ' + T.shortOf(a.tile), 'kong', function () { answer(a); }));
        } else if (a.type === 'liangdao') {
          el.actionbar.appendChild(actBtn('亮倒', 'liangdao', function () { answer(a); }, ldHint));
        } else if (a.type === 'pass') {
          el.actionbar.appendChild(actBtn('过', 'pass', function () { answer({ type: 'pass' }); }));
        }
      });
      // 提示：不想亮倒/杠的话，直接点手牌就能出牌，不用先点「过」
      if (pendingAsk.preview) {
        var tip = document.createElement('div');
        tip.style.cssText = 'font-size:12px;color:#a8c2b6;padding:8px 6px;';
        tip.textContent = '（不想亮倒？直接点手牌就能出牌）';
        el.actionbar.appendChild(tip);
      }
      return;
    }

    if (pendingAsk.kind === 'claim') {
      if (pendingAsk.canHu) {
        el.actionbar.appendChild(actBtn('胡 ' + T.shortOf(pendingAsk.tile), 'hu', function () {
          answer({ action: 'hu' });
        }));
      }
      if (pendingAsk.canZhiGang) {
        el.actionbar.appendChild(actBtn('杠 ' + T.shortOf(pendingAsk.tile), 'kong', function () {
          answer({ action: 'kong' });
        }));
      }
      if (pendingAsk.canPong) {
        el.actionbar.appendChild(actBtn('碰 ' + T.shortOf(pendingAsk.tile), 'pong', function () {
          answer({ action: 'pong' });
        }));
      }
      el.actionbar.appendChild(actBtn('过', 'pass', function () { answer({ action: 'pass' }); }));
    }
  }

  function actBtn(text, cls, onClick, title) {
    var b = document.createElement('button');
    b.className = 'act ' + cls;
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* 弹窗                                                                */
  /* ------------------------------------------------------------------ */

  var modalPersistent = false;   // true = 点弹窗外不关闭（对局结算弹窗）

  function openModal(html, actions, opts) {
    opts = opts || {};
    modalPersistent = !!opts.persistent;
    el.modalHost.hidden = false;
    el.modalHost.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = html;
    var bar = document.createElement('div');
    bar.className = 'modal-actions';
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn ' + (a.cls || '');
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      bar.appendChild(b);
    });
    box.appendChild(bar);
    el.modalHost.appendChild(box);
    return box;
  }

  function closeModal() {
    modalPersistent = false;
    el.modalHost.hidden = true;
    el.modalHost.innerHTML = '';
  }

  function toast(msg, ms) {
    var t = document.createElement('div');
    t.className = 'toast show';
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, ms || 2000);
  }

  function tilesHtml(tiles, sizeCls, extraCls) {
    return tiles.map(function (t) {
      return '<span class="tile ' + sizeCls + (extraCls ? ' ' + extraCls : '') +
        '" title="' + T.nameOf(t) + '">' + T.faceSvg(t) + '</span>';
    }).join('');
  }

  /** 手牌（不含胡牌张）+ 把胡牌张单独放在右边 */
  function handWithWinTileHtml(hand, winTile, sizeCls) {
    var rest = hand.slice();
    var i = rest.indexOf(winTile);
    if (i >= 0) rest.splice(i, 1);
    return tilesHtml(rest, sizeCls) +
      '<span class="win-gap"></span>' +
      tilesHtml([winTile], sizeCls, 'win-tile');
  }

  function showRoundResult(result) {
    if (result.type === 'huang') {
      showHuangResult(result);
    } else {
      showWinResult(result);
    }
  }

  function showWinResult(result) {
    var html = '';
    html += '<h2>' + (result.selfDraw ? '自摸！' : '胡牌！') + '</h2>';
    html += '<p class="muted">' + (result.winners.length > 1 ? '一炮双响 · ' : '') +
      '底金 ' + state.rules.baseScore + ' 分</p>';

    result.winners.forEach(function (w) {
      html += '<div class="win-block">';
      html += '<div class="title">' + w.name +
        (w.selfDraw ? ' 自摸 ' : ' 胡 ' + state.players[w.fromSeat].name + ' 打出的牌 ') +
        T.nameOf(w.winTile) +
        (w.qiangGang ? '（抢杠胡）' : '') + (w.gangPao ? '（杠上炮）' : '') +
        '　<b style="color:#ffd97a">+' + w.amount + '</b></div>';
      html += '<div class="row melds">' + handWithWinTileHtml(w.hand, w.winTile, 'sm') + '</div>';
      if (w.melds.length) {
        var mh = '';
        w.melds.forEach(function (m) {
          var n = m.kind === 'pong' ? 3 : 4;
          for (var i = 0; i < n; i++) {
            mh += '<span class="tile xs" title="' + T.nameOf(m.tile) + '">' + T.faceSvg(m.tile) + '</span>';
          }
          mh += '<span style="display:inline-block;width:8px"></span>';
        });
        html += '<div class="row melds"><span class="row-label">副露</span>' + mh + '</div>';
      }
      var rr = w.result;
      var sum = (rr.sum !== undefined) ? rr.sum : rr.capped;
      var cappedSum = (rr.cappedSum !== undefined) ? rr.cappedSum : rr.capped;
      var ldMul = (rr.liangdaoMul !== undefined) ? rr.liangdaoMul : 1;
      html += '<div class="fan-list">';
      var hasFan = false;
      rr.items.forEach(function (it) {
        if (it.kind === 'final') return;   // 亮倒不参与加算，单独展示
        hasFan = true;
        // 杠上炮是乘算项，显示成「×2」而不是「+2」
        html += '<span class="fan-chip">' + it.name +
          (it.mode === 'mul' ? ' ×' : ' +') + it.mult + '</span>';
      });
      // 「底 ×1」是屁胡的兜底：有番的时候不再加这个 1
      if (!hasFan) html += '<span class="fan-chip base">底 +1（屁胡）</span>';
      html += '<span class="fan-chip" style="background:rgba(255,255,255,.08)">番数和 ' + sum + '</span>';
      if (cappedSum !== sum) {
        html += '<span class="fan-chip base">封顶到 ' + cappedSum + '</span>';
      }
      if (ldMul > 1) {
        html += '<span class="fan-chip" style="background:rgba(232,197,106,.35)">亮倒 最后 ×' + ldMul + '</span>';
      }
      html += '<span class="fan-chip" style="background:rgba(232,197,106,.3)">合计 ' +
        (rr.capped * state.rules.baseScore) + ' 分（' + rr.capped + ' 倍底金）</span>';
      html += '</div>';
      html += '<table class="pay-table"><tr><th>结算</th><th style="text-align:right">分数</th></tr>';
      w.pays.forEach(function (p) {
        html += '<tr><td>' + (w.selfDraw ? state.players[p.seat].name + ' 付' :
          state.players[p.seat].name + ' 付' + (p.note ? '（' + p.note + '）' : '')) +
          '</td><td class="num neg">-' + p.amount + '</td></tr>';
      });
      html += '<tr><td><b>' + w.name + ' 得</b></td><td class="num pos"><b>+' +
        w.pays.reduce(function (s, p) { return s + p.amount; }, 0) + '</b></td></tr>';
      html += '</table>';
      html += '</div>';
    });

    html += '<h3>当前总分</h3><table class="pay-table"><tr><th>玩家</th><th style="text-align:right">总分</th></tr>';
    state.players.forEach(function (p) {
      html += '<tr><td>' + p.name + '</td><td class="num ' + (p.score >= 0 ? 'pos' : 'neg') + '">' +
        (p.score > 0 ? '+' : '') + p.score + '</td></tr>';
    });
    html += '</table>';

    openModal(html, [
      { label: '新对局', cls: 'ghost', onClick: function () { newMatch(); } },
      { label: '下一局', cls: 'primary', onClick: function () { closeModal(); runRound(game); } }
    ], { persistent: true });
  }

  function showHuangResult(result) {
    var html = '<h2>荒庄</h2><p class="muted">牌墙摸完，无人胡牌。荒庄不荒杠，杠钱照算。</p>';
    html += '<table class="pay-table"><tr><th>玩家</th><th>是否听牌</th><th>听牌张</th><th style="text-align:right">赔听</th></tr>';
    result.tenpai.forEach(function (t) {
      var paid = result.pays.filter(function (p) { return p.from === t.seat; })
        .reduce(function (s, p) { return s + p.amount; }, 0);
      var got = result.pays.filter(function (p) { return p.to === t.seat; })
        .reduce(function (s, p) { return s + p.amount; }, 0);
      var net = got - paid;
      html += '<tr><td>' + state.players[t.seat].name + '</td>' +
        '<td>' + (t.tenpai ? '<span style="color:#8ef0b8">听牌</span>' : '<span style="color:#ff9d92">未听</span>') + '</td>' +
        '<td>' + (t.tenpai ? T.nameOf(t.tile) + '（' + t.fan + ' 倍）' : '—') + '</td>' +
        '<td class="num ' + (net >= 0 ? 'pos' : 'neg') + '">' + (net > 0 ? '+' : '') + net + '</td></tr>';
    });
    html += '</table>';
    html += '<h3>当前总分</h3><table class="pay-table">';
    state.players.forEach(function (p) {
      html += '<tr><td>' + p.name + '</td><td class="num ' + (p.score >= 0 ? 'pos' : 'neg') + '">' +
        (p.score > 0 ? '+' : '') + p.score + '</td></tr>';
    });
    html += '</table>';

    openModal(html, [
      { label: '新对局', cls: 'ghost', onClick: function () { newMatch(); } },
      { label: '下一局', cls: 'primary', onClick: function () { closeModal(); runRound(game); } }
    ], { persistent: true });
  }

  /* ------------------------------------------------------------------ */
  /* 对局记录                                                            */
  /* ------------------------------------------------------------------ */

  function pct(v) { return (v * 100).toFixed(0) + '%'; }
  function signed(v) { return (v > 0 ? '+' : '') + v; }

  function openHistory() {
    var g = game;
    var players = g ? g.players : [];
    var history = g ? g.history : [];
    var S = window.KWX.Stats;

    var html = '<h2>对局记录</h2>';
    if (!history.length) {
      html += '<p class="muted">还没有记录，先打一局吧。</p>';
      openModal(html, [{ label: '知道了', cls: 'primary', onClick: closeModal }]);
      return;
    }

    var stats = S.summary(players, history);
    html += '<p class="muted">共 ' + history.length + ' 局 · 底金 ' +
      (g.rules.baseScore) + ' · 封顶 ' + (g.rules.cap > 0 ? '×' + g.rules.cap : '不封顶') + '</p>';

    // 汇总
    html += '<h3>战绩汇总</h3><table class="pay-table"><tr>' +
      '<th>玩家</th><th>局数</th><th>胡牌</th><th>自摸</th><th>捉炮</th><th>放铳</th>' +
      '<th>荒庄</th><th>胜率</th><th style="text-align:right">总分</th></tr>';
    stats.forEach(function (s) {
      html += '<tr>' +
        '<td><span class="dot" style="background:' + S.LINE_COLORS[s.seat % S.LINE_COLORS.length] + '"></span>' +
        s.name + '</td>' +
        '<td>' + s.rounds + '</td>' +
        '<td>' + s.wins + '</td>' +
        '<td>' + s.selfDraw + '</td>' +
        '<td>' + s.dianPao + '</td>' +
        '<td>' + s.fangPao + '</td>' +
        '<td>' + s.huang + '</td>' +
        '<td>' + pct(s.winRate) + '</td>' +
        '<td class="num ' + (s.score >= 0 ? 'pos' : 'neg') + '"><b>' + signed(s.score) + '</b></td>' +
        '</tr>';
    });
    html += '</table>';

    // 折线图
    html += '<h3>分数走势</h3>';
    html += '<div class="chart-wrap"><canvas id="history-chart" class="chart"></canvas></div>';
    html += '<div class="chart-legend">';
    stats.forEach(function (s) {
      html += '<span class="legend-item"><span class="dot" style="background:' +
        S.LINE_COLORS[s.seat % S.LINE_COLORS.length] + '"></span>' + s.name + '</span>';
    });
    html += '<span class="legend-item muted">（横轴=局数，纵轴=累计分数）</span></div>';

    // 每局明细
    html += '<h3>每局明细</h3><table class="pay-table"><tr><th>局</th><th>庄家</th><th>结果</th>';
    players.forEach(function (p) { html += '<th style="text-align:right">' + p.name + '</th>'; });
    html += '</tr>';
    history.slice().reverse().forEach(function (h) {
      html += '<tr><td>' + h.round + '</td><td>' + (players[h.dealer] ? players[h.dealer].name : '-') + '</td>' +
        '<td class="round-desc">' + S.describeRound(h, players) + '</td>';
      h.deltas.forEach(function (d) {
        html += '<td class="num ' + (d > 0 ? 'pos' : (d < 0 ? 'neg' : '')) + '">' +
          (d === 0 ? '0' : signed(d)) + '</td>';
      });
      html += '</tr>';
    });
    html += '</table>';

    // 电脑的亮倒奖惩记忆（按牌型）
    var learnRows = [];
    players.forEach(function (p) {
      if (!p.isAI || !g.liangdaoLearn) return;
      AI.learnSummary(g.liangdaoLearn[p.seat]).forEach(function (e) {
        if (e.reveal > 0) learnRows.push({ name: p.name, e: e });
      });
    });
    if (learnRows.length) {
      html += '<h3>电脑的亮倒奖惩记忆</h3>' +
        '<p class="muted">电脑每亮倒一次就按「赢了/输了」调整该牌型的倾向：' +
        '赢过 → 门槛降低（更敢亮），输过 → 门槛抬高（更保守）。' +
        '记忆在这次对局内累计，点「新对局」会清空。</p>';
      html += '<table class="pay-table"><tr><th>玩家</th><th>牌型</th><th>亮倒</th>' +
        '<th>赢</th><th>输</th><th style="text-align:right">倾向</th></tr>';
      learnRows.sort(function (a, b) { return b.e.reveal - a.e.reveal; });
      learnRows.slice(0, 12).forEach(function (r) {
        var adj = r.e.adj;
        var cls = adj > 1.02 ? 'pos' : (adj < 0.98 ? 'neg' : '');
        html += '<tr><td>' + r.name + '</td><td>' + r.e.key + '</td>' +
          '<td>' + r.e.reveal + '</td><td>' + r.e.win + '</td><td>' + r.e.lose + '</td>' +
          '<td class="num ' + cls + '">×' + adj.toFixed(2) + '</td></tr>';
      });
      html += '</table>';
    }

    var box = openModal(html, [
      { label: '关闭', cls: 'primary', onClick: closeModal }
    ]);
    var canvas = $('history-chart');
    if (canvas && box) {
      try { S.drawChart(canvas, players, history); }
      catch (e) { console.error('画折线图失败', e); }
    }
  }

  function openSettings() {
    var html = '<h2>规则设置</h2><p class="muted">改动会立即生效，从下一巡起按新规则判定。</p><div class="settings-grid">';
    SETTING_DEFS.forEach(function (def) {
      html += '<div class="setting-row"><label for="set-' + def.key + '">' + def.label + '</label>';
      if (def.type === 'checkbox') {
        html += '<input type="checkbox" id="set-' + def.key + '"' + (settings[def.key] ? ' checked' : '') + '>';
      } else {
        html += '<select id="set-' + def.key + '">';
        def.options.forEach(function (o) {
          html += '<option value="' + o[0] + '"' + (String(settings[def.key]) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>';
        });
        html += '</select>';
      }
      html += '</div>';
      if (def.note) html += '<div class="setting-note">' + def.note + '</div>';
    });
    html += '</div>';

    openModal(html, [
      { label: '取消', cls: 'ghost', onClick: closeModal },
      {
        label: '保存', cls: 'primary', onClick: function () {
          SETTING_DEFS.forEach(function (def) {
            var node = $('set-' + def.key);
            if (def.type === 'checkbox') settings[def.key] = node.checked;
            else settings[def.key] = parseInt(node.value, 10);
          });
          if (game) {
            game.rules = Object.assign({}, R.DEFAULT_RULES, settings);
            game.speed = settings.speed;
          }
          closeModal();
          render();
          toast('设置已保存');
        }
      }
    ]);
  }

  function openRules() {
    var html = [
      '<h2>卡五星规则</h2>',
      '<p class="muted">湖北随州/襄阳一带的三人麻将，共 84 张牌：筒 1-9、条 1-9 各 4 张，中/发/白各 4 张。</p>',
      '<h3>基本玩法</h3><ul>',
      '<li>三人对战，<b>没有万子、没有风牌</b>，字牌只有中发白。</li>',
      '<li><b>只能碰、杠，不能吃。</b></li>',
      '<li>任意对子都可作将；牌摸完仍无人胡牌即荒庄，荒庄不荒杠。</li>',
      '<li>庄家首局随机，之后由上一局胡牌者坐庄。</li>',
      '</ul>',
      '<h3>番型（<b>加算</b>：底金 ×（各番相加），×8 封顶；亮倒最后整体 ×2）</h3><ul>',
      '<li>屁胡（小胡）＝ <b>底 ×1</b>：<b>只有「一个番都没有」时才是 1 倍</b>，有番就不再另加这个 1。</li>',
      '<li>碰碰胡 +2　明四归一 +2　暗四归一 +4</li>',
      '<li>七对 +4　龙七对 +8　双龙七对 +16</li>',
      '<li>清一色 +4　大三元 +8　小三元 +4　手抓一 +4</li>',
      '<li>卡五星 +2（胡 5 筒 / 5 条，且是 456 的嵌张）</li>',
      '<li>杠上开花 +2　抢杠胡 +2　海底捞 +2</li>',
      '<li><b>杠上炮是乘算</b>：（牌型番 + 加算时机番）×（第几杠 × 2），乘完再封顶。</li>',
      '<li>例：底金 5、捉炮、卡五星 + 清一色 → 5 ×（2+4）= 30 分；' +
      '再加亮倒 → 5 ×（2+4）× 2 = 60 分。</li>',
      '<li>例：底金 5 的屁胡被杠上炮（第 1 杠）→ 5 × 1 × 2 = <b>10 分</b>；' +
      '清一色被杠上炮（第 1 杠）→ 5 × 4 × 2 = <b>40 分</b>。</li>',
      '</ul>',
      '<h3>亮倒：收益与风险</h3><ul>',
      '<li><b>收益</b>：亮倒后胡牌番数整体 ×2；' +
      '<b>亮倒之后屁胡也能捉别人的炮</b>（平时屁胡只能自摸）。</li>',
      '<li><b>只能摸打</b>：亮倒之后每巡只能打出刚摸到的那张牌，<b>听张不能再改</b>，也不能碰；' +
      '但<b>补杠 / 暗杠 / 直杠仍然可以</b>。</li>',
      '<li><b>只亮关联牌</b>：亮倒时只亮出「能凑成赢牌的关联牌」——把手上已经成型的整段藏起来，' +
      '只露还在等牌的那一段。例：11134567999 + 中中 听 2/5/8 只亮 <b>34567</b>；' +
      '1223345578 + 中中中 听 6/9 只亮 <b>78</b>；七对亮 1 张、龙七对亮 3 张、双龙七对亮 5 张。</li>',
      '<li><b>谁都不能故意放铳</b>：只要有人亮倒，其他人就<b>不能打出他的听张</b>——' +
      '哪怕这样会让你自己听不了牌；手里全是危险张时才被迫放铳。</li>',
      '<li><b>输钱翻倍</b>：只要你自己亮倒了，输钱一律翻倍——点炮翻倍，别人自摸时你也要付双倍。' +
      '（不看赢家有没有亮倒）</li>',
      '<li><b>亮倒者的弃牌谁都危险</b>：亮倒之后你打出的牌连屁胡都能胡。</li>',
      '<li><b>荒局双赔</b>：荒局时亮倒的人哪怕自己也听牌，仍要赔给每个听牌对手「底金 × 对方牌型番数」；' +
      '反过来，未听牌的人<b>不必再赔给亮倒者</b>。</li>',
      '<li>所以番数低的牌（尤其是屁胡 ×1）翻倍也多赚不了多少，却要承担一样的风险 —— ' +
      '电脑是按期望值算分决定亮不亮倒的，会同时看<b>剩余抽牌数、听张宽度、剩余和牌张数、放铳风险</b>，' +
      '<b>屁胡基本不亮</b>，而且每种牌型还会按「亮倒赢过/输过」自己调整倾向（对局记录里能看到）。</li>',
      '<li>亮倒可以在自己摸完牌之后宣布，也可以在碰 / 杠 / 加杠之后刚听牌时宣布。</li>',
      '</ul>',
      '<h3>什么时候会问你要不要亮倒</h3><ul>',
      '<li>自己摸完牌之后；以及<b>碰 / 杠 / 加杠之后能听牌时</b>也会问。</li>',
      '<li><b>不想亮倒的话，直接点手牌就能出牌</b>，不用先点「过」。</li>',
      '</ul>',
      '<h3>杠分（立即结算）</h3><ul>',
      '<li>暗杠：其他两家各付 2 倍底金。</li>',
      '<li>明杠（碰后加杠/补杠）：其他两家各付 1 倍底金。</li>',
      '<li>直杠：点杠者单独付 2 倍底金。</li>',
      '<li><b>杠上杠从第二杠起翻倍</b>：加杠链是 1 → 2 → 4 倍底金；' +
      '暗杠/直杠链是 2 → 4 → 8 倍底金，以此类推。<b>每一杠都单独结算</b>，不是只算最后一杠。</li>',
      '<li><b>只有加杠（碰后补杠）能被抢杠胡</b>；暗杠和直杠都抢不了。</li>',
      '</ul>',
      '<h3>杠上炮</h3><ul>',
      '<li>杠后打出的那张牌被别人胡，就是杠上炮：<b>番数和 =（牌型番 + 加算时机番）×（第几杠 × 2）</b>，' +
      '结算 = 底金 × 番数和。</li>',
      '<li>第 1 杠 ×2、第 2 杠 ×4、第 3 杠 ×6 —— <b>杠上炮是乘算</b>，乘完再封顶（默认 ×8）。</li>',
      '<li>例：底金 5 的屁胡被杠上炮（第 1 杠）→ 5 × 1 × 2 = <b>10 分</b>；' +
      '清一色被杠上炮（第 1 杠）→ 5 × 4 × 2 = <b>40 分</b>。</li>',
      '<li><b>杠上炮连屁胡也能胡</b>（普通出牌时屁胡只能自摸）。</li>',
      '</ul>',
      '<h3>结算</h3><ul>',
      '<li>自摸：两家各出一份；点炮：由点炮者出一份。</li>',
      '<li>点炮<b>亮倒</b>的人：默认只出一份（亮倒的 ×2 已经算在番数里了）；' +
      '可在设置里改回「相当于亮倒者自摸，点炮者一人出两份」。</li>',
      '<li><b>亮倒的人输钱一律翻倍</b>：点炮翻倍，别人自摸时他也付双倍（不看赢家是否亮倒）。</li>',
      '<li><b>亮倒的人打出的牌：屁胡也能胡。</b></li>',
      '<li>荒庄查大叫：未听牌者赔给每位<b>没亮倒的</b>听牌者（按其最大牌型的番数）；' +
      '<b>亮倒者即使听牌也要赔给其他听牌者</b>；三家都听牌且无人亮倒则互不赔付。</li>',
      '</ul>',
      '<h3 style="color:#ffd97a">★ 关于「屁胡不能捉炮」</h3>',
      '<p>本版本按通行规则实现：<b>屁胡（小胡，底金 ×1）只能自摸，不能胡别人打出的牌</b>。' +
      '只有当牌型本身有番（碰碰胡 / 清一色 / 七对 / 卡五星 / 四归一 ……）时才允许捉炮。' +
      '因此在牌桌上你会看到：听的是屁胡牌，别人打出来也胡不了，系统会给出提示；' +
      '只有自摸才能成胡。这一条可以在「设置」里关闭，就变成网上常见的那种可以屁胡捉炮的玩法。</p>',
      '<h3>操作</h3><ul>',
      '<li>轮到你时点击手牌即可打出（刚摸到的牌会单独放在右侧并高亮）。</li>',
      '<li>出现按钮时可选 碰 / 杠 / 胡 / 亮倒 / 过。</li>',
      '<li>亮倒后手牌对全场公开，番数 ×2，且只能打保持听牌的牌。</li>',
      '</ul>'
    ].join('');
    openModal(html, [{ label: '知道了', cls: 'primary', onClick: closeModal }]);
  }

  window.addEventListener('DOMContentLoaded', init);
  window.KWX_UI = {
    init: init,
    settings: settings,
    getGame: function () { return game; },
    getPending: function () { return pendingAsk; },
    // 布局：桌面版不加 class；手机版给 body 加 layout-mobile + 方向
    getLayout: function () { return layoutMode; },
    setLayout: function (mode) { applyLayout(mode); return layoutMode; },
    detectLayout: detectLayoutMode,
    // 手机版二次点击出牌的选中态（测试用）
    getMobilePicked: function () { return mobilePicked; },
    clearMobilePick: clearMobilePick
  };
})();
