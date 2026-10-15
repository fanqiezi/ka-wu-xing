/*
 * 亮倒模型标定脚本（开发用）
 * 统计 AI 的「亮倒决策率」（按牌型番数分组）以及亮倒之后的实际战绩：
 *   - 有多少局出现亮倒、亮倒者赢没赢
 *   - 每 100 局的点炮（放铳）次数
 * 用来调 AI.LIANGDAO 的系数与门槛。
 * 运行： node tests/tune-liangdao.js [局数]
 */
'use strict';

const Game = require('../js/game.js');
const AI = require('../js/ai.js');
const R = require('../js/rules.js');

const ROUNDS = parseInt(process.argv[2] || '120', 10);

async function measure(label, overrides) {
  Object.assign(AI.LIANGDAO, overrides);

  // 拦截决策，统计「面对亮倒机会时的决策率」（用生产逻辑，避免两套算法漂移）
  const orig = AI.shouldLiangdao;
  const st = {
    byFan: {}, rounds: 0, liangdaoRounds: 0,
    ldWin: 0, ldLose: 0, dian: 0, zimoWins: 0, dianWins: 0,
    predSum: 0, predN: 0, cand: []
  };
  st.cand = [];
  AI.shouldLiangdao = function (view) {
    const d = AI.liangdaoDecision(view);
    if (!d) return false;
    const k = d.plan.fan >= 4 ? '4+' : String(d.plan.fan);
    st.byFan[k] = st.byFan[k] || { try: 0, yes: 0 };
    st.byFan[k].try++;
    if (d.yes) {
      st.byFan[k].yes++;
      st.cand.push({ seat: view.seat, q: d.plan.pSelfDraw, fan: d.plan.fan });
    }
    return d.yes;
  };

  let huang = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const g = new Game({ seed: 900 + i * 131, speed: 0, rules: R.DEFAULT_RULES });
    g.players.forEach(p => { p.isAI = true; });
    let res = null;
    g.on('roundEnd', r => { res = r; });
    st.cand = [];
    await g.startRound();
    st.rounds++;
    const liangdaoSeats = g.players.filter(p => p.liangdao).map(p => p.seat);
    if (liangdaoSeats.length) st.liangdaoRounds++;
    const winSeats = res && res.type === 'win' ? res.winners.map(w => w.seat) : [];
    // 只统计「真的亮倒了的那些决策」，比较模型预测与实战结果
    st.cand.forEach(c => {
      if (liangdaoSeats.indexOf(c.seat) < 0) return;
      st.predSum += c.q;
      st.predN++;
    });
    if (!res || res.type !== 'win') { huang++; continue; }
    liangdaoSeats.forEach(s => { if (winSeats.indexOf(s) >= 0) st.ldWin++; else st.ldLose++; });
    res.winners.forEach(w => {
      if (w.selfDraw) st.zimoWins++; else { st.dianWins++; st.dian++; }
    });
  }
  AI.shouldLiangdao = orig;

  const rate = (b) => (b && b.try ? Math.round(b.yes / b.try * 100) : 0);
  const pct = (a, b) => (b ? (a / b * 100).toFixed(0) : '0');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad(label, 30) +
    ' | 屁胡 ' + pad(rate(st.byFan['1']) + '%(' + (st.byFan['1'] ? st.byFan['1'].yes + '/' + st.byFan['1'].try : '-') + ')', 14) +
    ' | 2番 ' + pad(rate(st.byFan['2']) + '%', 6) +
    ' | 4番+ ' + pad(rate(st.byFan['4+']) + '%', 6) +
    ' | 有亮倒的局 ' + pad(pct(st.liangdaoRounds, st.rounds) + '%', 5) +
    ' | 亮倒者胜 ' + pad(pct(st.ldWin, st.ldWin + st.ldLose) + '%', 5) +
    ' | 预测自摸 ' + pad((st.predN ? (st.predSum / st.predN * 100).toFixed(0) : '0') + '%', 6) +
    ' | 点炮 ' + pad(st.dian + '次/' + st.rounds + '局', 12) +
    ' | 荒庄 ' + huang);
  return st;
}

(async function () {
  console.log('目标：屁胡几乎不亮（<2%）、2 番少亮、4 番+ 才敢亮；有亮倒的局明显变少。');
  console.log('每档 ' + ROUNDS + ' 局。最后一列「预测自摸」是模型说的自摸概率，应接近「亮倒者胜」。\n');
  console.log('-'.repeat(170));

  await measure('当前模型（基线）', {});
  const combos = process.argv[3]
    ? JSON.parse(process.argv[3])
    : [{ turnEfficiency: 0.4, need: 0.3 }, { turnEfficiency: 0.4, need: 0.6 }, { turnEfficiency: 0.5, need: 0.5 }];
  for (const c of combos) {
    await measure(JSON.stringify(c).replace(/[{}"a-zA-Z:]/g, ''), c);
  }
})();
