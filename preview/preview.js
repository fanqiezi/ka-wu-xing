/* ============================================================
   手机版样张 —— 共用脚本（假数据 + 触摸交互演示，不接游戏逻辑）
   结构刻意跟电脑版保持一致（.topbar/.hud/.opponents/.seat/.center-col/.sidebar/
   .actionbar/.hand-row/.row.discards…），这样评审通过后只要把这些 class 的尺寸
   搬进 mobile.css、再在 ui.js 里加一个布局分支就行。

   交互演示：点手牌 → 抬起 + 顶部确认条（二次点击出牌）· 长按 → 看「打这张听什么」
            点铳牌 → 只提示 · 亮倒/胡/记录/设置 → 悬浮窗
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
    round: 12, base: 5, wall: 42, dealer: '你',
    turn: '轮到你出牌',
    hand: [TIAO(1), TIAO(2), TIAO(3), TIAO(4), TIAO(5), TIAO(6), TIAO(7), TIAO(8), TIAO(9),
      TONG(4), TONG(4), TONG(5), TONG(6)],
    drawn: TONG(9),
    waits: [{ t: TONG(4), n: 2 }, { t: TONG(7), n: 3 }],
    selfDiscards: [TIAO(9), TONG(2), FA, TIAO(4), TONG(7), BAI, TIAO(1), TONG(6), ZHONG, TIAO(8), TONG(3), BAI],
    lastDiscard: { seat: 'bottom', tile: TIAO(5) },
    top: {
      name: '上家', score: -35, backs: 13, melds: [], liangdao: true,
      reveal: [TIAO(4), TIAO(5), TIAO(6), TIAO(7), TIAO(8)],
      waits: [{ t: TIAO(3), n: 3 }, { t: TIAO(6), n: 1 }, { t: TIAO(9), n: 2 }],
      discards: [TONG(1), TIAO(5), ZHONG, TONG(9), TIAO(3), TONG(7), TIAO(2), BAI,
        TONG(6), TIAO(4), TONG(8), FA, TIAO(1), TONG(5), TIAO(9), TONG(2), ZHONG, TIAO(7)]
    },
    bottom: {
      name: '下家', score: 12, backs: 10, melds: [{ kind: 'pong', tile: ZHONG }], liangdao: false,
      reveal: null, waits: null,
      discards: [TIAO(6), TONG(4), FA, TIAO(8), TONG(3), TIAO(1), ZHONG, TONG(9), TIAO(5),
        TONG(2), TIAO(7), BAI, TONG(6), TIAO(3), TONG(8), TIAO(2), TONG(1), BAI]
    },
    self: { name: '你', score: 23, melds: [] },
    log: [
      ['第 12 局开始，庄家：你', ''],
      ['你摸牌', ''],
      ['下家 打出 五条', ''],
      ['上家 亮倒！番数 ×2，此后只能摸打、不能再改听张（清一色）', 'liangdao'],
      ['上家 亮出 45678条，听 3条/6条/9条', 'muted'],
      ['你摸牌：九筒', 'hl'],
      ['轮到你出牌', 'muted']
    ]
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
  function back() {
    var el = document.createElement('span');
    el.className = 'tile back bk';
    return el;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function row(label, cls) {
    var r = el('div', 'row ' + (cls || ''));
    r.appendChild(el('span', 'row-label', label));
    return r;
  }
  function clear(host) { if (host) host.innerHTML = ''; }

  /* ---------- 展示状态（只影响样张） ---------- */
  var view = { state: 'normal', handSize: 'compact', river: 'full' };
  // 支持用链接参数直接看某个状态，方便截图核对：?state=danger&hand=big&river=short
  var qs = location.search || '';
  var qm = /[?&]state=(normal|danger|selfLd)/.exec(qs);
  if (qm) view.state = qm[1];
  var qh = /[?&]hand=(compact|standard|big|twoRows)/.exec(qs);
  if (qh) view.handSize = qh[1];
  var qr = /[?&]river=(full|short)/.exec(qs);
  if (qr) view.river = qr[1];
  var picked = null;
  var DANGER = [TIAO(3), TIAO(6), TIAO(9)];

  function isTopLiangdao() { return view.state === 'danger' || view.state === 'selfLd'; }
  function isSelfLiangdao() { return view.state === 'selfLd'; }
  function isDanger(code) { return view.state !== 'normal' && DANGER.indexOf(code) >= 0; }
  function waitTotal() { return D.waits.reduce(function (a, w) { return a + w.n; }, 0); }

  /* ---------- 渲染：顶栏 / 四个方框 ---------- */
  function renderHud() {
    var set = function (id, v) { var n = document.getElementById(id); if (n) n.textContent = v; };
    set('hud-round', D.round);
    set('hud-base', D.base);
    set('hud-wall', view.state === 'selfLd' ? D.wall - 1 : D.wall);
    set('hud-dealer', D.dealer);
  }

  /* ---------- 渲染：一个座位 ---------- */
  function renderSeat(key) {
    var host = document.querySelector('[data-opp="' + key + '"]');
    if (!host) return;
    var isSelf = key === 'self';
    var p = isSelf ? D.self : D[key];
    clear(host);

    // 头部：名字 / 标签 / 分数
    var head = el('div', 'seat-head');
    head.appendChild(el('span', 'who', isSelf ? '你 (你)' : p.name));
    if (D.dealer === (isSelf ? '你' : p.name)) head.appendChild(el('span', 'tag dealer', '庄'));
    if (isSelf) {
      if (isSelfLiangdao()) head.appendChild(el('span', 'tag liangdao', '已亮倒'));
    } else if (p.liangdao && isTopLiangdao()) {
      head.appendChild(el('span', 'tag liangdao', '已亮倒'));
    } else {
      head.appendChild(el('span', 'tag', '未亮倒'));
    }
    head.appendChild(el('span', 'score ' + (p.score >= 0 ? 'pos' : 'neg'),
      (p.score > 0 ? '+' : '') + p.score));
    host.appendChild(head);

    // 对手：先手牌（牌背），再亮倒行/听牌，最后副露与牌河（跟 ui.js 的顺序一致）
    if (!isSelf) {
      var handRow = el('div', 'hand-row');
      for (var i = 0; i < p.backs; i++) handRow.appendChild(back());
      host.appendChild(handRow);

      if (p.liangdao && isTopLiangdao() && p.reveal) {
        // 亮倒只亮关联牌；听牌用一行小字（手机上面板很窄，放不下 chip）
        var rr = row('亮倒', 'reveal-row');
        p.reveal.forEach(function (t) { rr.appendChild(tile(t, { cls: 'rev' })); });
        host.appendChild(rr);
        var wt = el('div', 'row waits opp-waits');
        wt.appendChild(el('span', 'row-label', '听'));
        wt.appendChild(el('span', 'waits-text', p.waits.map(function (w) {
          return T.nameOf(w.t) + '×' + w.n;
        }).join('、')));
        host.appendChild(wt);
      }
      if (p.melds && p.melds.length) {
        var mr = row('副露', 'melds');
        p.melds.forEach(function (m) {
          var g = el('div', 'meld-group');
          var cnt = m.kind === 'pong' ? 3 : 4;
          for (var k = 0; k < cnt; k++) g.appendChild(tile(m.tile, { cls: 'meld' }));
          mr.appendChild(g);
        });
        host.appendChild(mr);
      }
      var dr = row('牌河', 'discards');
      var dl = el('div', 'discards-list');
      var list = view.river === 'short' ? p.discards.slice(-9) : p.discards;
      list.forEach(function (t, i) {
        dl.appendChild(tile(t, { cls: 'rv' + (i === list.length - 1 && view.river === 'full' ? ' newest' : '') }));
      });
      dr.appendChild(dl);
      host.appendChild(dr);
      return;
    }

    // 自己：副露 → 牌河 → 听牌 → 手牌（跟 ui.js 的顺序一致）
    var smr = row('副露', 'melds');
    if (D.self.melds.length) {
      D.self.melds.forEach(function (m) {
        var g = el('div', 'meld-group');
        for (var q = 0; q < (m.kind === 'pong' ? 3 : 4); q++) g.appendChild(tile(m.tile, { cls: 'meld' }));
        smr.appendChild(g);
      });
    }
    host.appendChild(smr);

    var sdr = row('牌河', 'discards');
    var sdl = el('div', 'discards-list');
    var slist = view.river === 'short' ? D.selfDiscards.slice(-9) : D.selfDiscards;
    slist.forEach(function (t) { sdl.appendChild(tile(t, { cls: 'rv' })); });
    sdr.appendChild(sdl);
    host.appendChild(sdr);

    var wr = row('听牌', 'waits');
    if (isSelfLiangdao()) {
      wr.appendChild(el('span', 'tag liangdao', '已亮倒 · 只能打刚摸的那张'));
    } else {
      wr.appendChild(el('span', 'dim', '打 ' + T.nameOf(D.drawn) + ' →'));
    }
    D.waits.forEach(function (w) {
      var c = el('span', 'wait-chip');
      c.appendChild(document.createTextNode(T.nameOf(w.t)));
      c.appendChild(el('span', 'cnt', '×' + w.n));
      wr.appendChild(c);
    });
    wr.appendChild(el('span', 'dim', '（共 ' + waitTotal() + ' 张 · 屁胡只能自摸）'));
    host.appendChild(wr);

    var hr = el('div', 'hand-row ' + (view.handSize === 'twoRows' ? 'two-rows' : view.handSize));
    hr.id = 'mHand';
    D.hand.forEach(function (t) {
      var danger = isDanger(t);
      var locked = isSelfLiangdao();
      var node = tile(t, { cls: 'hd' + (danger ? ' dangerous' : '') + (locked ? ' disabled' : '') });
      if (!locked && !danger) { node.classList.add('clickable'); node.dataset.pickable = '1'; }
      if (danger) node.dataset.guard = '1';
      hr.appendChild(node);
    });
    hr.appendChild(el('span', 'gap'));
    var drawn = tile(D.drawn, { cls: 'hd just-drawn clickable' });
    drawn.dataset.pickable = '1';
    drawn.appendChild(el('span', 'badge warn', String(waitTotal())));
    hr.appendChild(drawn);
    host.appendChild(hr);
  }

  /* ---------- 渲染：中央信息 ---------- */
  function renderCenter() {
    var ti = document.getElementById('turnIndicator');
    if (ti) ti.textContent = D.turn;
    var ct = document.getElementById('centerTiles');
    if (ct) {
      clear(ct);
      ct.appendChild(tile(D.lastDiscard.tile, { cls: 'rv' }));
      ct.appendChild(el('span', 'last-note', D.bottom.name + ' 打出 ' + T.nameOf(D.lastDiscard.tile)));
    }
    var cm = document.getElementById('centerMeta');
    if (cm) cm.textContent = '牌墙剩余 ' + D.wall + ' 张';
  }

  /* ---------- 渲染：右侧对局记录 ---------- */
  function renderLog() {
    var host = document.getElementById('log');
    if (!host) return;
    clear(host);
    D.log.forEach(function (l) {
      host.appendChild(el('div', l[1] || '', l[0]));
    });
  }

  /* ---------- 渲染：操作栏 ---------- */
  function renderActions() {
    var host = document.getElementById('actionbar');
    if (!host) return;
    clear(host);
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
    host.appendChild(el('span', 'hint-text', '不想亮倒？直接点手牌就能出牌'));
  }

  function renderAll() {
    renderHud();
    renderSeat('top');
    renderSeat('bottom');
    renderSeat('self');
    renderCenter();
    renderLog();
    renderActions();
    syncDemoButtons();
  }

  /* ---------- 触摸交互 ---------- */
  function describe(code) {
    if (code === D.drawn) {
      return '打 ' + T.nameOf(code) + ' 后听 ' + D.waits.map(function (w) {
        return T.nameOf(w.t) + '×' + w.n;
      }).join('、') + '（屁胡只能自摸）';
    }
    if (code === TONG(4) || code === TONG(7)) return '这是和牌张，留着';
    return '打出去会破坏听牌';
  }

  function showConfirm(code) {
    var bar = document.getElementById('confirmBar');
    if (!bar) return;
    clear(bar);
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
    var bar = document.getElementById('confirmBar');
    if (bar) bar.classList.remove('show');
    var all = document.querySelectorAll('#mHand .picked');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('picked');
    picked = null;
  }
  function showInfo(code) {
    var bar = document.getElementById('infoBar');
    if (!bar) return;
    var name = T.nameOf(code);
    var msg;
    if (isDanger(code)) {
      msg = '<b>' + name + '</b> —— 上家亮倒听 3条/6条/9条，这张打出去就是<b>放铳</b>，所以点不动。';
    } else if (isSelfLiangdao()) {
      msg = '<b>' + name + '</b> —— 你已经亮倒，<b>只能打刚摸到的那张</b>，听张锁死（补杠/暗杠仍可）。';
    } else if (code === D.drawn) {
      msg = '<b>' + name + '</b>（刚摸到）—— ' + describe(code) + '。';
    } else {
      msg = '<b>' + name + '</b> —— ' + describe(code) +
        '<span class="dim">（正式版每张手牌长按都会给出「打这张 → 听什么」）</span>';
    }
    bar.innerHTML = msg;
    bar.classList.add('show');
    clearTimeout(showInfo._t);
    showInfo._t = setTimeout(function () { bar.classList.remove('show'); }, 3200);
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- 悬浮窗 ---------- */
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
        body: '<p>底金 5 分 · 卡五星 + 清一色 + 亮倒</p>' +
          '<h3>你的牌（赢张单独摆出来）</h3><div class="row">' + miniHand() + '</div>' +
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
        wide: true,
        title: '对局记录',
        body: '<p>共 12 局 · 底金 5 · 封顶 ×8（手机上做成悬浮窗，左右滑动看全部列）</p>' +
          '<h3>战绩汇总</h3>' +
          '<div style="overflow-x:auto"><table class="pay-table" style="min-width:420px">' +
          '<tr><th>玩家</th><th>局数</th><th>胡牌</th><th>自摸</th><th>捉炮</th><th>放铳</th><th>胜率</th><th style="text-align:right">总分</th></tr>' +
          '<tr><td>你</td><td>12</td><td>5</td><td>3</td><td>2</td><td>1</td><td>42%</td><td class="num pos">+83</td></tr>' +
          '<tr><td>下家</td><td>12</td><td>4</td><td>2</td><td>2</td><td>3</td><td>33%</td><td class="num neg">-8</td></tr>' +
          '<tr><td>上家</td><td>12</td><td>3</td><td>1</td><td>2</td><td>4</td><td>25%</td><td class="num neg">-75</td></tr>' +
          '</table></div>' +
          '<h3>分数走势</h3><div class="chart-wrap" style="height:100px"><div style="height:100%;' +
          'border:1px dashed rgba(232,197,106,.35);border-radius:8px;display:flex;align-items:center;' +
          'justify-content:center;color:var(--text-dim);font-size:10.5px">折线图按屏宽重绘（canvas）</div></div>' +
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
    return {
      title: '规则 / 设置',
      body: '<p>改动立即生效（样张只是示意）</p>' +
        '<h3>规则开关</h3><table class="pay-table">' +
        '<tr><td>底金</td><td style="text-align:right">1 / 2 / <b>5</b></td></tr>' +
        '<tr><td>封顶倍数</td><td style="text-align:right"><b>×8</b> / ×16 / 不封顶</td></tr>' +
        '<tr><td>屁胡只能自摸，不能捉炮</td><td style="text-align:right"><b>开</b></td></tr>' +
        '<tr><td>亮倒后只能摸打</td><td style="text-align:right"><b>开</b></td></tr>' +
        '<tr><td>亮倒者输钱一律翻倍</td><td style="text-align:right"><b>开</b></td></tr>' +
        '</table>' +
        '<h3>界面</h3><table class="pay-table">' +
        '<tr><td>牌面大小</td><td style="text-align:right"><b>紧凑</b> / 标准 / 大字 / 两行</td></tr>' +
        '<tr><td>牌河</td><td style="text-align:right"><b>完整</b> / 精简</td></tr>' +
        '<tr><td>出牌</td><td style="text-align:right"><b>二次点击确认</b></td></tr>' +
        '<tr><td>长按看听牌</td><td style="text-align:right">380ms</td></tr>' +
        '<tr><td>音效 / 震动</td><td style="text-align:right">不做</td></tr>' +
        '</table>',
      actions: [{ k: 'close', t: '关闭', cls: 'primary' }]
    };
  }

  function miniHand() {
    var one = function (t, cls) {
      return '<span class="tile ' + (cls || '') + '" style="width:22px;height:31px;border-radius:4px">' +
        T.faceSvg(t) + '</span>';
    };
    return D.hand.map(function (t) { return one(t); }).join('') +
      '<span class="win-gap" style="width:8px"></span>' + one(D.drawn, 'win-tile');
  }

  function openSheet(kind) {
    var cfg = sheetHtml(kind);
    var sheet = document.getElementById('sheet');
    var mask = document.getElementById('sheetMask');
    if (!sheet || !mask) return;
    sheet.className = 'sheet show' + (cfg.wide ? ' wide' : '');
    clear(sheet);
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
    mask.classList.add('show');
  }
  function closeSheet() {
    var sheet = document.getElementById('sheet');
    var mask = document.getElementById('sheetMask');
    if (sheet) sheet.className = 'sheet';
    if (mask) mask.classList.remove('show');
  }

  /* ---------- 事件（绑在手机容器上做事件委托，重渲染后不用重绑） ---------- */
  function bind() {
    var phone = document.querySelector('.phone');
    var pressTimer = null, longPressed = false;

    phone.addEventListener('pointerdown', function (e) {
      var t = e.target.closest('#mHand .tile');
      if (!t || t.dataset.tile === undefined) return;
      longPressed = false;
      pressTimer = setTimeout(function () {
        longPressed = true;
        showInfo(Number(t.dataset.tile));
      }, 380);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      phone.addEventListener(ev, function () { clearTimeout(pressTimer); });
    });

    phone.addEventListener('click', function (e) {
      var t = e.target.closest('#mHand .tile');
      if (t && t.dataset.tile !== undefined) {
        var code = Number(t.dataset.tile);
        if (longPressed) { longPressed = false; return; }
        if (t.dataset.guard === '1') { toast('这是亮倒者的听张（' + T.nameOf(code) + '），打出去就放铳'); return; }
        if (isSelfLiangdao() && code !== D.drawn) {
          toast('已亮倒 · 只能打刚摸到的那张（' + T.nameOf(D.drawn) + '）');
          return;
        }
        if (t.dataset.pickable !== '1') return;
        // 二次点击出牌：先抬起 + 顶部确认条，再点一次才真打（跟你要的一致）
        if (picked === t) { hideConfirm(); toast('已打出 ' + T.nameOf(code) + '（样张不带逻辑）'); return; }
        var prev = document.querySelector('#mHand .picked');
        if (prev) prev.classList.remove('picked');
        t.classList.add('picked');
        picked = t;
        showConfirm(code);
        return;
      }

      var c = e.target.closest('[data-confirm]');
      if (c) {
        if (c.dataset.confirm === 'go') {
          var c2 = picked ? Number(picked.dataset.tile) : D.drawn;
          hideConfirm();
          toast('已打出 ' + T.nameOf(c2) + '（样张不带逻辑）');
        } else hideConfirm();
        return;
      }
      var a = e.target.closest('[data-act]');
      if (a) {
        var k = a.dataset.act;
        if (k === 'liangdao') openSheet('liangdao');
        else if (k === 'hu') openSheet('win');
        else if (k === 'clearlog') { clear(document.getElementById('log')); }
        else toast('「' + a.textContent + '」（样张不带逻辑）');
        return;
      }
      var s = e.target.closest('[data-sheet]');
      if (s) { openSheet(s.dataset.sheet); return; }
      var sa = e.target.closest('[data-sheet-act]');
      if (sa) {
        var act = sa.dataset.sheetAct;
        if (act === 'ok') { closeSheet(); view.state = 'selfLd'; renderAll(); toast('已亮倒（样张不带逻辑）'); }
        else if (act === 'next') { closeSheet(); toast('下一局（样张不带逻辑）'); }
        else closeSheet();
        return;
      }
      // 点空白处取消选中
      if (!e.target.closest('.tile, button, .demo, .sheet, .infobar, .confirm-bar, .sidebar')) hideConfirm();
    });

    var demo = document.querySelector('.demo');
    demo.querySelector('.demo-toggle').addEventListener('click', function (e) {
      e.stopPropagation();
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

    document.getElementById('sheetMask').addEventListener('click', closeSheet);

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

  /** 调试用：?measure=1 时把关键区块的真实尺寸画在页面上（截图就能看到数字） */
  function measure() {
    if (location.search.indexOf('measure') < 0) return;
    var sels = ['html', 'body', '.frame', '.phone', '#app', '.topbar', '.brand', '.hud', '.topbtns', '.actionbar',
      '.table', '.opponents', '.seat-opp', '.seat-opp .hand-row',
      '.seat-opp .row.reveal-row', '.seat-opp .row.discards .discards-list',
      '.center-col', '.center-info', '.seat-self', '.seat-self .row.melds',
      '.seat-self .row.discards', '.seat-self .row.waits', '#mHand', '.sidebar', '.log'];
    var out = [];
    sels.forEach(function (sel) {
      var n = document.querySelector(sel);
      if (!n) { out.push('-- ' + sel + ' : none'); return; }
      var r = n.getBoundingClientRect();
      out.push('-- ' + sel + ' = ' + Math.round(r.width) + 'x' + Math.round(r.height) +
        ' @' + Math.round(r.left) + ',' + Math.round(r.top) + ' sh=' + n.scrollHeight);
    });
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:9999;margin:0;' +
      'background:#fff;color:#000;font:11px/1.35 Consolas,monospace;padding:4px;white-space:pre;';
    box.textContent = '== MEASURE ' + document.body.className + ' ==\n' +
      'win=' + window.innerWidth + 'x' + window.innerHeight +
      ' dpr=' + window.devicePixelRatio +
      ' fit=' + (document.querySelector('.frame').style.transform || 'none') + '\n' +
      out.join('\n');
    document.body.appendChild(box);
  }

  window.PREVIEW = {
    render: function () { renderAll(); bind(); measure(); },
    data: D,
    view: view,
    T: T
  };
})();
