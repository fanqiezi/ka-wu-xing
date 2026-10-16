/* ============================================================
   手机版样张 —— 共用脚本（假数据 + 触摸交互演示，不接游戏逻辑）
   牌面用的是真实的 js/tiles.js（同样的 SVG），所以样张里的牌就是最终效果。
   交互演示：点选抬起→再点打出 / 长按看「打这张听什么」/ 底部抽屉 / 危险张提示
   ============================================================ */
(function () {
  'use strict';

  var T = window.KWX.Tiles;

  /* ---------- 牌编码：0-8 筒、9-17 条、18 中 / 19 发 / 20 白 ---------- */
  function TONG(n) { return n - 1; }
  function TIAO(n) { return 9 + n - 1; }
  var ZHONG = 18, FA = 19, BAI = 20;

  /* ---------- 假数据 ---------- */
  var D = {
    round: 12, base: 5, wall: 42, gangChain: 2, dealer: 0,
    // 我的手牌 13 张：123456789条 + 4456筒；刚摸 9筒，打掉就听 4筒/7筒
    hand: [TIAO(1), TIAO(2), TIAO(3), TIAO(4), TIAO(5), TIAO(6), TIAO(7), TIAO(8), TIAO(9),
      TONG(4), TONG(4), TONG(5), TONG(6)],
    drawn: TONG(9),
    waits: [{ t: TONG(4), n: 2 }, { t: TONG(7), n: 3 }],   // 打 9筒 后听 4筒×2、7筒×3
    selfDiscards: [TIAO(9), TONG(2), FA, TIAO(4), TONG(7), BAI, TIAO(1), TONG(6), ZHONG, TIAO(8), TONG(3), BAI],
    lastDiscard: { seat: 'bottom', tile: TIAO(5) },
    top: {
      name: '上家', score: -35, backs: 13, melds: [], liangdao: true,
      reveal: [TIAO(4), TIAO(5), TIAO(6), TIAO(7), TIAO(8)],          // 亮倒只亮 45678条
      waits: [{ t: TIAO(3), n: 3 }, { t: TIAO(6), n: 1 }, { t: TIAO(9), n: 2 }],  // 听 3/6/9条
      discards: [TONG(1), TIAO(5), ZHONG, TONG(9), TIAO(3), TONG(7), TIAO(2), BAI,
        TONG(6), TIAO(4), TONG(8), FA, TIAO(1), TONG(5), TIAO(9), TONG(2), ZHONG, TIAO(7)]
    },
    bottom: {
      name: '下家', score: 12, backs: 10, melds: [{ kind: 'pong', tile: ZHONG }], liangdao: false,
      reveal: null, waits: null,
      discards: [TIAO(6), TONG(4), FA, TIAO(8), TONG(3), TIAO(1), ZHONG, TONG(9), TIAO(5),
        TONG(2), TIAO(7), BAI, TONG(6), TIAO(3), TONG(8), TIAO(2), TONG(1), BAI]
    },
    self: { name: '你', score: 23 }
  };

  /* ---------- 元素构造 ---------- */
  function tile(code, opt) {
    opt = opt || {};
    var el = document.createElement('span');
    el.className = 'tile ' + (opt.cls || '');
    el.innerHTML = T.faceSvg(code);
    el.dataset.tile = String(code);
    el.title = opt.title === undefined ? T.nameOf(code) : opt.title;
    if (opt.badge != null) {
      var b = document.createElement('span');
      b.className = 'badge' + (opt.warn ? ' warn' : '');
      b.textContent = opt.badge;
      el.appendChild(b);
    }
    return el;
  }

  function back(cls) {
    var el = document.createElement('span');
    el.className = 'tile back ' + (cls || '');
    return el;
  }

  function clearAndFill(host, nodes) {
    if (!host) return;
    host.innerHTML = '';
    nodes.forEach(function (n) { host.appendChild(n); });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- 状态机（只影响展示，不涉及规则） ---------- */
  var view = { state: 'normal', handSize: 'compact', river: 'full' };
  var picked = null;
  var DANGER = [TIAO(3), TIAO(6), TIAO(9)];   // 上家（亮倒）的听张，我手里正好有这三张

  function isDanger(code) {
    if (view.state !== 'danger') return false;
    return DANGER.indexOf(code) >= 0;
  }
  function waitTotal() {
    return D.waits.reduce(function (a, w) { return a + w.n; }, 0);
  }
  function isSelfLiangdao() { return view.state === 'selfLd'; }
  function topLiangdao() { return view.state === 'danger'; }

  /* ---------- 渲染 ---------- */
  function renderTop() {
    var host = document.querySelector('[data-fill="top"]');
    if (!host) return;
    host.innerHTML = '';
    var line = el('div', 'm-line');
    line.appendChild(el('span', 'who', D.self.name));
    if (D.dealer === 0) line.appendChild(el('span', 'tag dealer', '庄'));
    if (isSelfLiangdao()) line.appendChild(el('span', 'tag liangdao', '已亮倒'));
    line.appendChild(el('span', 'sp'));
    var sc = el('span', 'm-score pos', '+' + D.self.score);
    line.appendChild(sc);
    host.appendChild(line);

    var line2 = el('div', 'm-line');
    var hud = el('span', 'hud-item');
    hud.appendChild(el('label', null, '第'));
    hud.appendChild(el('b', null, String(D.round)));
    hud.appendChild(el('label', null, '局 · 底金'));
    hud.appendChild(el('b', null, String(D.base)));
    line2.appendChild(hud);
    line2.appendChild(el('span', 'sp'));
    var b1 = el('button', 'm-btn', '记录');
    b1.dataset.sheet = 'history';
    var b2 = el('button', 'm-btn', '设置');
    b2.dataset.sheet = 'settings';
    line2.appendChild(b1);
    line2.appendChild(b2);
    host.appendChild(line2);
  }

  function renderOpp(key) {
    var p = D[key];
    var host = document.querySelector('[data-opp="' + key + '"]');
    if (!host) return;
    host.innerHTML = '';

    var head = el('div', 'seat-head');
    head.appendChild(el('span', 'who', p.name));
    if (p.liangdao && topLiangdao()) head.appendChild(el('span', 'tag liangdao', '已亮倒'));
    else head.appendChild(el('span', 'tag', '未亮倒'));
    head.appendChild(el('span', 'sp'));
    var sc = el('span', 'm-score ' + (p.score >= 0 ? 'pos' : 'neg'), (p.score > 0 ? '+' : '') + p.score);
    head.appendChild(sc);
    host.appendChild(head);

    var line = el('div', 'm-line');
    var bk = el('div', 'm-backs');
    for (var i = 0; i < p.backs; i++) bk.appendChild(back('bk'));
    line.appendChild(bk);
    if (p.melds && p.melds.length) {
      var mh = el('div', 'm-melds');
      mh.appendChild(el('span', 'row-label', '副露'));
      p.melds.forEach(function (m) {
        var g = el('div', 'meld-group');
        var n = m.kind === 'pong' ? 3 : 4;
        for (var k = 0; k < n; k++) g.appendChild(tile(m.tile, { cls: 'meld' }));
        mh.appendChild(g);
      });
      line.appendChild(mh);
    }
    host.appendChild(line);

    // 亮倒的牌单独一行 + 公开的听牌
    if (p.liangdao && topLiangdao() && p.reveal) {
      var rl = el('div', 'm-line m-reveal');
      rl.appendChild(el('span', 'row-label', '亮倒'));
      p.reveal.forEach(function (t) { rl.appendChild(tile(t, { cls: 'rev' })); });
      var ws = el('div', 'waits');
      ws.appendChild(el('span', 'row-label', '听'));
      p.waits.forEach(function (w) {
        var c = el('span', 'wait-chip');
        c.appendChild(document.createTextNode(T.nameOf(w.t)));
        var cnt = el('span', 'cnt', '×' + w.n);
        c.appendChild(cnt);
        ws.appendChild(c);
      });
      rl.appendChild(ws);
      host.appendChild(rl);
    }
  }

  function renderRiver(key, hostKey) {
    var host = document.querySelector('[data-river="' + hostKey + '"] .m-river-tiles');
    if (!host) return;
    var list = key === 'self' ? D.selfDiscards : D[key].discards;
    if (view.river === 'short') list = list.slice(-9);
    var nodes = list.map(function (t, i) {
      var newest = i === list.length - 1 && view.river === 'full';
      return tile(t, { cls: 'rv' + (newest ? ' newest' : '') });
    });
    clearAndFill(host, nodes);
  }

  function renderCenter() {
    var host = document.querySelector('#mCenter');
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(el('span', 'big', '剩余 ' + D.wall + ' 张'));
    if (D.gangChain > 1) host.appendChild(el('span', null, '杠上杠 ×' + Math.pow(2, D.gangChain - 1)));
    var ld = el('span', 'last-discard');
    ld.appendChild(el('span', 'dim', D.bottom.name + ' 打出'));
    ld.appendChild(tile(D.lastDiscard.tile, { cls: 'rv' }));
    host.appendChild(ld);
  }

  function renderWaitRow() {
    var host = document.querySelector('#mWaits');
    if (!host) return;
    host.innerHTML = '';
    if (isSelfLiangdao()) {
      host.appendChild(el('span', 'lock', '已亮倒 · 只能打刚摸的那张'));
      host.appendChild(el('span', 'lead', '听'));
      D.waits.forEach(function (w) {
        var c = el('span', 'wait-chip');
        c.appendChild(document.createTextNode(T.nameOf(w.t)));
        c.appendChild(el('span', 'cnt', '×' + w.n));
        host.appendChild(c);
      });
      var ld = el('span', 'lead', '（听张锁死，补杠/暗杠仍可）');
      host.appendChild(ld);
    } else {
      host.appendChild(el('span', 'lead', '听牌'));
      host.appendChild(el('span', 'lead', '打 ' + T.nameOf(D.drawn) + ' →'));
      D.waits.forEach(function (w) {
        var c = el('span', 'wait-chip');
        c.appendChild(document.createTextNode(T.nameOf(w.t)));
        c.appendChild(el('span', 'cnt', '×' + w.n));
        host.appendChild(c);
      });
      host.appendChild(el('span', 'lead', '（共 ' +
        D.waits.reduce(function (a, w) { return a + w.n; }, 0) + ' 张 · 屁胡只能自摸）'));
    }
  }

  function renderHand() {
    var host = document.querySelector('#mHand');
    if (!host) return;
    host.innerHTML = '';
    // 手牌档位：compact（紧凑）/ standard（标准）/ big（大字）/ twoRows（大字两行）
    host.className = 'm-hand ' + (view.handSize === 'twoRows' ? 'two-rows' : view.handSize);

    D.hand.forEach(function (t) {
      var danger = isDanger(t);
      var locked = isSelfLiangdao();
      var cls = 'hd' + (danger ? ' dangerous' : '') + (locked ? ' disabled' : '');
      var node = tile(t, { cls: cls });
      if (!locked && !danger) {
        node.classList.add('clickable');
        node.dataset.pickable = '1';
      }
      if (danger) node.dataset.guard = '1';
      host.appendChild(node);
    });

    // 刚摸到的牌单独拎出来（金边；亮倒后只有这张还能点）
    // 角标＝打这张之后还剩几张和牌张（正式版每张手牌都有，样张只在刚摸那张上演示）
    host.appendChild(el('span', 'sep'));
    var drawn = tile(D.drawn, { cls: 'hd just-drawn clickable' });
    drawn.dataset.pickable = '1';
    drawn.appendChild(el('span', 'badge warn', String(waitTotal())));
    host.appendChild(drawn);
  }

  function renderActions() {
    var host = document.querySelector('#mActions');
    if (!host) return;
    host.innerHTML = '';
    var acts;
    if (isSelfLiangdao()) {
      acts = [{ k: 'hu', t: '胡', s: '自摸' }, { k: 'pass', t: '过' }];
    } else if (view.state === 'danger') {
      acts = [{ k: 'hu', t: '胡', s: '上家打出的牌' }, { k: 'pong', t: '碰' }, { k: 'pass', t: '过' }];
    } else {
      acts = [{ k: 'ankong', t: '暗杠' }, { k: 'addkong', t: '补杠' }, { k: 'liangdao', t: '亮倒', s: '番数×2' }, { k: 'pass', t: '过' }];
    }
    acts.forEach(function (a) {
      var b = el('button', 'act ' + a.k);
      b.appendChild(document.createTextNode(a.t));
      if (a.s) b.appendChild(el('small', null, a.s));
      b.dataset.act = a.k;
      host.appendChild(b);
    });
  }

  function renderAll() {
    renderTop();
    renderOpp('top');
    renderOpp('bottom');
    renderRiver('top', 'top');
    renderRiver('bottom', 'bottom');
    renderRiver('self', 'self');
    renderCenter();
    renderWaitRow();
    renderHand();
    renderActions();
    syncDemoButtons();
  }

  /* ---------- 触摸交互 ---------- */
  function showConfirm(code) {
    var bar = document.querySelector('#confirmBar');
    if (!bar) return;
    bar.innerHTML = '';
    bar.appendChild(document.createTextNode('已选 ' + T.nameOf(code) + '（' + describe(code) + '）'));
    bar.appendChild(el('span', 'sp'));
    var go = el('button', null, '打出');
    go.dataset.confirm = 'go';
    var no = el('button', 'ghost', '取消');
    no.dataset.confirm = 'cancel';
    bar.appendChild(go);
    bar.appendChild(no);
    bar.classList.add('show');
  }
  function hideConfirm() {
    var bar = document.querySelector('#confirmBar');
    if (bar) bar.classList.remove('show');
    var all = document.querySelectorAll('#mHand .picked');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('picked');
    picked = null;
  }

  function describe(code) {
    if (code === D.drawn) {
      return '打 ' + T.nameOf(code) + ' 后听 ' + D.waits.map(function (w) {
        return T.nameOf(w.t) + '×' + w.n;
      }).join('、') + '（屁胡只能自摸）';
    }
    if (code === TONG(4) || code === TONG(7)) return '这是和牌张，留着';
    return '打出去会破坏听牌';
  }

  function showInfo(code) {
    var bar = document.querySelector('#infoBar');
    if (!bar) return;
    var name = T.nameOf(code);
    var msg;
    if (isDanger(code)) {
      msg = '<b>' + name + '</b> —— 上家亮倒听 3条/6条/9条，这张打出去就是<b>放铳</b>，所以点不动。';
    } else if (isSelfLiangdao()) {
      msg = '<b>' + name + '</b> —— 你已经亮倒，<b>只能打刚摸到的那张</b>（9筒），听张锁死。';
    } else if (code === D.drawn) {
      msg = '<b>' + name + '</b>（刚摸到）—— ' + describe(code) + '；留 9筒 只能靠摸牌改听。';
    } else {
      msg = '<b>' + name + '</b> —— 长按看提示：这张是手牌，打出去会破坏听牌。' +
        '<span class="dim">（正式版这里显示「打这张 → 听什么」）</span>';
    }
    bar.innerHTML = msg;
    bar.classList.add('show');
    clearTimeout(showInfo._t);
    showInfo._t = setTimeout(function () { bar.classList.remove('show'); }, 3200);
  }

  function toast(msg) {
    var t = document.querySelector('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- 抽屉 ---------- */
  function sheetHtml(kind) {
    if (kind === 'liangdao') {
      return {
        title: '确定亮倒？',
        body: '<p>亮倒之后：番数<b>整体 ×2</b>，但手牌公开、只能摸打、听张锁死。</p>' +
          '<ul class="risk-list">' +
          '<li>亮出的牌：<b>45678条</b>（只亮能推出全部听张的关联牌）</li>' +
          '<li>输钱一律<b>翻倍</b>：点炮双倍，别人自摸你也双倍</li>' +
          '<li>你打出的牌<b>连屁胡都能胡</b></li>' +
          '<li>荒局即使自己听牌，也要<b>赔给其他听牌的人</b></li>' +
          '</ul>',
        actions: [{ k: 'ok', t: '亮倒（×2）', cls: 'primary' }, { k: 'cancel', t: '再想想', cls: 'ghost' }]
      };
    }
    if (kind === 'win') {
      return {
        title: '自摸！',
        body: '<p class="muted">底金 5 分 · 卡五星 + 清一色 + 亮倒</p>' +
          '<h3>你的牌</h3><div class="row">' + miniHand() + '</div>' +
          '<h3>番型</h3><div class="row">' +
          '<span class="fan-chip">卡五星 +2</span><span class="fan-chip">清一色 +4</span>' +
          '<span class="fan-chip" style="background:rgba(255,255,255,.08)">番数和 6</span>' +
          '<span class="fan-chip" style="background:rgba(232,197,106,.35)">亮倒 最后 ×2</span>' +
          '<span class="fan-chip" style="background:rgba(232,197,106,.3)">合计 60 分（12 倍底金）</span>' +
          '</div>' +
          '<h3>结算</h3><table class="pay-table">' +
          '<tr><th>结算</th><th style="text-align:right">分数</th></tr>' +
          '<tr><td>下家 付</td><td class="num neg">-20</td></tr>' +
          '<tr><td>上家 付（亮倒翻倍）</td><td class="num neg">-40</td></tr>' +
          '<tr><td><b>你 得</b></td><td class="num pos"><b>+60</b></td></tr>' +
          '</table><h3>当前总分</h3><table class="pay-table">' +
          '<tr><td>你</td><td class="num pos">+83</td></tr>' +
          '<tr><td>下家</td><td class="num neg">-8</td></tr>' +
          '<tr><td>上家</td><td class="num neg">-75</td></tr></table>',
        actions: [{ k: 'next', t: '下一局', cls: 'primary' }, { k: 'new', t: '新对局', cls: 'ghost' }]
      };
    }
    if (kind === 'history') {
      return {
        title: '对局记录',
        body: '<p class="muted">共 12 局 · 底金 5 · 封顶 ×8</p>' +
          '<h3>战绩汇总（左右滑动看全部）</h3>' +
          '<div style="overflow-x:auto"><table class="pay-table" style="min-width:420px">' +
          '<tr><th>玩家</th><th>局数</th><th>胡牌</th><th>自摸</th><th>捉炮</th><th>放铳</th><th>胜率</th><th style="text-align:right">总分</th></tr>' +
          '<tr><td>你</td><td>12</td><td>5</td><td>3</td><td>2</td><td>1</td><td>42%</td><td class="num pos">+83</td></tr>' +
          '<tr><td>下家</td><td>12</td><td>4</td><td>2</td><td>2</td><td>3</td><td>33%</td><td class="num neg">-8</td></tr>' +
          '<tr><td>上家</td><td>12</td><td>3</td><td>1</td><td>2</td><td>4</td><td>25%</td><td class="num neg">-75</td></tr>' +
          '</table></div>' +
          '<h3>分数走势</h3><div class="chart-wrap" style="height:110px"><div style="height:100%;' +
          'border:1px dashed rgba(232,197,106,.35);border-radius:8px;display:flex;align-items:center;' +
          'justify-content:center;color:var(--text-dim);font-size:11px">折线图按屏宽重绘（canvas）</div></div>' +
          '<h3>每局明细</h3><table class="pay-table">' +
          '<tr><th>局</th><th>结果</th><th style="text-align:right">你</th></tr>' +
          '<tr><td>12</td><td class="round-desc">你自摸·卡五星+清一色 亮倒 12 倍</td><td class="num pos">+60</td></tr>' +
          '<tr><td>11</td><td class="round-desc">上家亮倒·七对 2 倍（输牌翻倍）</td><td class="num pos">+20</td></tr>' +
          '<tr><td>10</td><td class="round-desc">下家捉炮·碰碰胡 2 倍</td><td class="num neg">-10</td></tr>' +
          '</table>' +
          '<h3>电脑的亮倒奖惩记忆</h3><table class="pay-table">' +
          '<tr><th>玩家</th><th>牌型</th><th>亮倒</th><th>赢</th><th>输</th><th style="text-align:right">倾向</th></tr>' +
          '<tr><td>上家</td><td>暗四归一</td><td>4</td><td>1</td><td>3</td><td class="num neg">×0.55</td></tr>' +
          '<tr><td>下家</td><td>卡五星</td><td>2</td><td>1</td><td>1</td><td class="num">×1.05</td></tr>' +
          '</table>',
        actions: [{ k: 'close', t: '关闭', cls: 'primary' }]
      };
    }
    // settings
    return {
      title: '规则设置',
      body: '<p class="muted">改动立即生效（样张只是示意）</p>' +
        '<table class="pay-table">' +
        '<tr><td>底金</td><td style="text-align:right">1 / 2 / <b>5</b></td></tr>' +
        '<tr><td>封顶倍数</td><td style="text-align:right"><b>×8</b> / ×16 / 不封顶</td></tr>' +
        '<tr><td>屁胡只能自摸，不能捉炮</td><td style="text-align:right"><b>开</b></td></tr>' +
        '<tr><td>自己亮倒后，屁胡也能捉炮</td><td style="text-align:right"><b>开</b></td></tr>' +
        '<tr><td>亮倒后只能摸打</td><td style="text-align:right"><b>开</b></td></tr>' +
        '<tr><td>亮倒者输钱一律翻倍</td><td style="text-align:right"><b>开</b></td></tr>' +
        '<tr><td>杠后打出的牌（杠上炮），屁胡也能胡</td><td style="text-align:right"><b>开</b></td></tr>' +
        '</table>' +
        '<h3>界面</h3><table class="pay-table">' +
        '<tr><td>牌面大小</td><td style="text-align:right"><b>紧凑</b> / 标准 / 大字</td></tr>' +
        '<tr><td>牌河</td><td style="text-align:right"><b>完整</b> / 精简</td></tr>' +
        '<tr><td>音效 / 震动</td><td style="text-align:right">不做</td></tr>' +
        '</table>',
      actions: [{ k: 'close', t: '关闭', cls: 'primary' }]
    };
  }

  /** 结算抽屉里的牌：13 张手牌 + 空档 + 单独摆出来的赢张（和正式版一致） */
  function miniHand() {
    var one = function (t, cls) {
      return '<span class="tile ' + (cls || '') + '" style="width:24px;height:34px;border-radius:5px">' +
        T.faceSvg(t) + '</span>';
    };
    return D.hand.map(function (t) { return one(t); }).join('') +
      '<span class="win-gap" style="width:10px"></span>' + one(D.drawn, 'win-tile');
  }

  function openSheet(kind) {
    var cfg = sheetHtml(kind);
    var sheet = document.querySelector('#sheet');
    var mask = document.querySelector('#sheetMask');
    if (!sheet || !mask) return;
    sheet.innerHTML = '';
    sheet.appendChild(el('div', 'sheet-grip'));
    var head = el('div', 'sheet-head');
    head.appendChild(el('h2', null, cfg.title));
    head.appendChild(el('span', 'sp'));
    sheet.appendChild(head);
    var body = el('div', 'sheet-body');
    body.innerHTML = cfg.body;
    sheet.appendChild(body);
    var acts = el('div', 'sheet-actions');
    cfg.actions.forEach(function (a) {
      var b = el('button', 'btn ' + (a.cls || ''), a.t);
      b.dataset.sheetAct = a.k;
      acts.appendChild(b);
    });
    sheet.appendChild(acts);
    sheet.classList.add('show');
    mask.classList.add('show');
  }

  function closeSheet() {
    var sheet = document.querySelector('#sheet');
    var mask = document.querySelector('#sheetMask');
    if (sheet) sheet.classList.remove('show');
    if (mask) mask.classList.remove('show');
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    // 手牌：点一下选中、再点一次打出；长按看提示
    var hand = document.querySelector('#mHand');
    var pressTimer = null, longPressed = false;

    hand.addEventListener('pointerdown', function (e) {
      var t = e.target.closest('.tile');
      if (!t) return;
      longPressed = false;
      pressTimer = setTimeout(function () {
        longPressed = true;
        showInfo(Number(t.dataset.tile));
      }, 380);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      hand.addEventListener(ev, function () { clearTimeout(pressTimer); });
    });
    hand.addEventListener('click', function (e) {
      var t = e.target.closest('.tile');
      if (!t) return;
      var code = Number(t.dataset.tile);
      if (longPressed) { longPressed = false; return; }
      if (t.dataset.guard === '1') {
        toast('这是亮倒者的听张（' + T.nameOf(code) + '），打出去就放铳');
        return;
      }
      if (isSelfLiangdao() && code !== D.drawn) {
        toast('已亮倒 · 只能打刚摸到的那张（' + T.nameOf(D.drawn) + '）');
        return;
      }
      if (t.dataset.pickable !== '1') return;
      if (picked === t) { hideConfirm(); toast('已打出 ' + T.nameOf(code) + '（样张不带逻辑）'); return; }
      var prev = hand.querySelector('.picked');
      if (prev) prev.classList.remove('picked');
      t.classList.add('picked');
      picked = t;
      showConfirm(code);
    });

    // 空白处点一下取消选择
    document.querySelector('.phone').addEventListener('click', function (e) {
      if (e.target.closest('.tile, button, .demo, .sheet, .infobar, .confirm-bar')) return;
      hideConfirm();
    });

    // 确认条
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-confirm]');
      if (!b) return;
      if (b.dataset.confirm === 'go') {
        var code = picked ? Number(picked.dataset.tile) : D.drawn;
        hideConfirm();
        toast('已打出 ' + T.nameOf(code) + '（样张不带逻辑）');
      } else {
        hideConfirm();
      }
    });

    // 操作按钮
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var k = b.dataset.act;
      if (k === 'liangdao') openSheet('liangdao');
      else if (k === 'hu') openSheet('win');
      else toast('「' + k + '」（样张不带逻辑）');
    });

    // 顶部 / 抽屉按钮
    document.addEventListener('click', function (e) {
      var s = e.target.closest('[data-sheet]');
      if (s) { openSheet(s.dataset.sheet); return; }
      var a = e.target.closest('[data-sheet-act]');
      if (a) {
        var k = a.dataset.sheetAct;
        if (k === 'ok') { closeSheet(); view.state = 'selfLd'; renderAll(); toast('已亮倒（样张不带逻辑）'); }
        else if (k === 'next') { closeSheet(); toast('下一局（样张不带逻辑）'); }
        else closeSheet();
      }
    });
    document.querySelector('#sheetMask').addEventListener('click', closeSheet);

    // 演示控制台
    var demo = document.querySelector('.demo');
    demo.querySelector('.demo-toggle').addEventListener('click', function () {
      demo.classList.toggle('open');
    });
    demo.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (!b) return;
      var parts = b.dataset.view.split(':');
      view[parts[0]] = parts[1];
      hideConfirm();
      renderAll();
    });

    // 自适应：手机全屏铺满，电脑上等比缩放到能看全
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', function () { setTimeout(fit, 120); });
  }

  function fit() {
    var frame = document.querySelector('.frame');
    var phone = document.querySelector('.phone');
    if (!frame || !phone) return;
    var w = parseFloat(getComputedStyle(phone).getPropertyValue('--w')) || phone.offsetWidth;
    var h = parseFloat(getComputedStyle(phone).getPropertyValue('--h')) || phone.offsetHeight;
    var isPhone = Math.min(window.innerWidth, window.innerHeight) <= 520;
    document.body.classList.toggle('fullbleed', isPhone);
    if (isPhone) { frame.style.transform = 'none'; return; }
    var s = Math.min(1, (window.innerWidth - 20) / w, (window.innerHeight - 20) / h);
    frame.style.transform = 'scale(' + s + ')';
  }

  function syncDemoButtons() {
    var all = document.querySelectorAll('[data-view]');
    for (var i = 0; i < all.length; i++) {
      var parts = all[i].dataset.view.split(':');
      all[i].classList.toggle('on', view[parts[0]] === parts[1]);
    }
  }

  window.PREVIEW = {
    render: function () { renderAll(); bind(); },
    data: D,
    tile: tile,
    T: T
  };
})();
