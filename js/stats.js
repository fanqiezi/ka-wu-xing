/*
 * 对局记录与统计：把 Game.history 汇总成「局数 / 胡牌 / 胜率 / 总分」，
 * 并用 canvas 画累计分数折线图（无任何第三方依赖）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.KWX = root.KWX || {}; root.KWX.Stats = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LINE_COLORS = ['#e8c56a', '#6fc3ff', '#7ddf9a', '#ff9d92'];

  /**
   * 汇总每位玩家的战绩
   * @param {Array} players Game.players
   * @param {Array} history Game.history
   */
  function summary(players, history) {
    var stats = players.map(function (p) {
      return {
        seat: p.seat, name: p.name, isAI: p.isAI,
        rounds: 0,          // 参与局数
        wins: 0,            // 胡牌次数
        selfDraw: 0,
        dianPao: 0,         // 点炮胡（胡别人打的）
        fangPao: 0,         // 自己放铳次数
        huang: 0,           // 参与且荒庄的局数
        score: p.score,
        best: 0,            // 单局最高得分
        worst: 0            // 单局最低得分
      };
    });
    history.forEach(function (h) {
      players.forEach(function (p, i) {
        stats[i].rounds++;
        var d = h.deltas[i] || 0;
        if (d > stats[i].best) stats[i].best = d;
        if (d < stats[i].worst) stats[i].worst = d;
      });
      if (h.type === 'huang') {
        players.forEach(function (p, i) { stats[i].huang++; });
        return;
      }
      h.winners.forEach(function (w) {
        var s = stats[w.seat];
        if (!s) return;
        s.wins++;
        if (w.selfDraw) s.selfDraw++;
        else {
          s.dianPao++;
          if (typeof w.fromSeat === 'number' && stats[w.fromSeat]) stats[w.fromSeat].fangPao++;
        }
      });
    });
    stats.forEach(function (s) {
      s.winRate = s.rounds ? s.wins / s.rounds : 0;
    });
    return stats;
  }

  /** 一局的简短说明文字 */
  function describeRound(h, players) {
    if (h.type === 'huang') {
      var tp = (h.tenpai || []).map(function (t, i) { return t ? players[i].name : null; })
        .filter(Boolean);
      return tp.length ? '荒庄（听牌：' + tp.join('、') + '）' : '荒庄';
    }
    return h.winners.map(function (w) {
      var how = w.selfDraw ? '自摸' : ('胡 ' + (players[w.fromSeat] ? players[w.fromSeat].name : '?') + ' 的牌');
      return w.name + ' ' + how + ' · ' + w.items.join('+') + ' ' + w.fan + ' 倍';
    }).join('；');
  }

  /** 折线图用的数据：每局结束后的累计分数 */
  function seriesData(players, history) {
    var n = players.length;
    var lines = [];
    for (var i = 0; i < n; i++) {
      lines.push({ name: players[i].name, color: LINE_COLORS[i % LINE_COLORS.length], points: [0] });
    }
    history.forEach(function (h) {
      for (var k = 0; k < n; k++) {
        var last = lines[k].points[lines[k].points.length - 1];
        lines[k].points.push(h.scores[k] !== undefined ? h.scores[k] : last);
      }
    });
    return lines;
  }

  /**
   * 画累计分数折线图
   * @param {HTMLCanvasElement} canvas
   * @param {Array} players
   * @param {Array} history
   */
  function drawChart(canvas, players, history) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var cssW = canvas.clientWidth || canvas.width || 620;
    var cssH = canvas.clientHeight || canvas.height || 240;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var padL = 44, padR = 12, padT = 14, padB = 26;
    var plotW = Math.max(10, cssW - padL - padR);
    var plotH = Math.max(10, cssH - padT - padB);

    // 背景
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(padL, padT, plotW, plotH);

    var lines = seriesData(players, history);
    var rounds = history.length;
    var values = [0];
    lines.forEach(function (ln) { ln.points.forEach(function (v) { values.push(v); }); });
    var maxV = Math.max.apply(null, values);
    var minV = Math.min.apply(null, values);
    var span = Math.max(4, maxV - minV);
    var pad = span * 0.15;
    maxV += pad; minV -= pad;

    function x(i) { return padL + (rounds <= 1 ? plotW / 2 : plotW * i / rounds); }
    function y(v) { return padT + plotH - (v - minV) / (maxV - minV) * plotH; }

    // 横向网格 + 刻度
    ctx.font = '11px "Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'middle';
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var v = minV + (maxV - minV) * t / ticks;
      var yy = y(v);
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + plotW, yy);
      ctx.stroke();
      ctx.fillStyle = '#a8c2b6';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(v)), padL - 6, yy);
    }
    // 0 线
    if (minV < 0 && maxV > 0) {
      ctx.strokeStyle = 'rgba(232,197,106,.45)';
      ctx.setLineDash && ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, y(0));
      ctx.lineTo(padL + plotW, y(0));
      ctx.stroke();
      ctx.setLineDash && ctx.setLineDash([]);
    }
    // x 轴刻度（局数）
    ctx.fillStyle = '#a8c2b6';
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.ceil(rounds / 8));
    for (var r = 0; r <= rounds; r += step) {
      ctx.fillText(r === 0 ? '开' : String(r), x(r), padT + plotH + 13);
    }

    // 折线
    lines.forEach(function (ln) {
      ctx.strokeStyle = ln.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ln.points.forEach(function (v, i) {
        if (i === 0) ctx.moveTo(x(i), y(v));
        else ctx.lineTo(x(i), y(v));
      });
      ctx.stroke();
      // 数据点
      ctx.fillStyle = ln.color;
      ln.points.forEach(function (v, i) {
        ctx.beginPath();
        ctx.arc(x(i), y(v), i === ln.points.length - 1 ? 3.2 : 2, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }

  return {
    LINE_COLORS: LINE_COLORS,
    summary: summary,
    describeRound: describeRound,
    seriesData: seriesData,
    drawChart: drawChart
  };
});
