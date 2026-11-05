/* =====================================================================
   Statistiques & graphes (exprimés en numéros de jour, jamais en dates)
   ===================================================================== */
(function () {
  'use strict';
  const { NEW, REVIEW, FSRS } = window.FSRSLib;
  const charts = {};
  let range = 30;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* ---------- Calculs ---------- */
  function compute() {
    const S = window.Store, d = S.data;
    const today = S.today();
    const start = d.startDay == null ? today : d.startDay;
    const nDays = today - start + 1;
    const fsrs = new FSRS();
    const logsByCard = new Map();
    for (const l of d.logs) {
      if (!logsByCard.has(l.id)) logsByCard.set(l.id, []);
      logsByCard.get(l.id).push(l);
    }

    // séries jour par jour
    const days = [];
    for (let i = 0; i < nDays; i++) days.push({
      key: start + i, num: i + 1, added: 0, cum: 0,
      g: [0, 0, 0, 0, 0], revOk: 0, revAll: 0, memory: 0, mastered: 0, studied: 0,
    });
    const at = (key) => days[key - start];

    for (const c of d.cards) { const x = at(c.createdDay); if (x) x.added++; }
    let cum = 0; for (const x of days) { cum += x.added; x.cum = cum; }

    for (const l of d.logs) {
      const x = at(l.day); if (!x) continue;
      x.g[l.g]++;
      if (l.st === REVIEW) { x.revAll++; if (l.g > 1) x.revOk++; }
    }

    // mémoire estimée : somme des probabilités de rappel, rejouée jour par jour
    for (const [, logs] of logsByCard) {
      let p = 0, lastS = null, lastDay = null;
      for (const x of days) {
        while (p < logs.length && logs[p].day <= x.key) { lastS = logs[p].S; lastDay = logs[p].day; p++; }
        if (lastS == null) continue;
        x.studied++;
        x.memory += fsrs.retrievability(x.key - lastDay, lastS);
        if (lastS >= S.MASTERED_S) x.mastered++;
      }
    }

    // prévision sur 30 jours
    const forecast = new Array(31).fill(0);
    for (const c of d.cards) {
      if (c.fsrs.state === NEW || c.fsrs.dueDay == null) continue;
      const k = Math.max(0, c.fsrs.dueDay - today);
      if (k <= 30) forecast[k]++;
    }

    // distributions
    const studied = d.cards.filter(c => c.fsrs.state !== NEW);
    const diffBins = new Array(9).fill(0); // 1–2, 2–3, … 9–10
    for (const c of studied) diffBins[Math.min(8, Math.max(0, Math.floor(c.fsrs.difficulty) - 1))]++;
    const stabEdges = [1, 3, 7, 21, 60, 180, Infinity];
    const stabLabels = ['< 1 j', '1–3 j', '3–7 j', '7–21 j', '21–60 j', '60–180 j', '> 180 j'];
    const stabBins = new Array(stabEdges.length).fill(0);
    for (const c of studied) stabBins[stabEdges.findIndex(e => c.fsrs.stability < e)]++;

    const cats = { new: 0, learning: 0, young: 0, mastered: 0 };
    for (const c of d.cards) cats[S.category(c)]++;

    // indicateurs
    const memNow = studied.reduce((a, c) => a + (S.retrievabilityNow(c) || 0), 0);
    let ok30 = 0, all30 = 0;
    for (const l of d.logs) if (l.day > today - 30 && l.st === REVIEW) { all30++; if (l.g > 1) ok30++; }
    const activeDays = new Set(d.logs.map(l => l.day));
    // série de jours consécutifs ; si rien encore aujourd'hui, on compte à partir d'hier
    let streak = 0;
    let k0 = activeDays.has(today) ? today : today - 1;
    while (activeDays.has(k0)) { streak++; k0--; }

    const reviewsToday = d.logs.filter(l => l.day === today).length;
    const dueTomorrow = d.cards.filter(c => c.fsrs.state !== NEW && c.fsrs.dueDay != null && c.fsrs.dueDay <= today + 1).length;
    const avgDiff = studied.length ? studied.reduce((a, c) => a + c.fsrs.difficulty, 0) / studied.length : null;

    const hard = studied
      .map(c => ({ c, score: c.fsrs.lapses * 2 + c.fsrs.difficulty + (S.isDifficult(c) ? 5 : 0) }))
      .filter(x => x.c.fsrs.lapses > 0 || x.c.fsrs.difficulty >= 6.5 || S.isDifficult(x.c))
      .sort((a, b) => b.score - a.score).slice(0, 12).map(x => x.c);

    return {
      today, days, forecast, diffBins, stabBins, stabLabels, cats, memNow, studiedCount: studied.length,
      ret30: all30 ? ok30 / all30 : null, all30, streak, reviewsToday, dueTomorrow, avgDiff, hard,
      totalReviews: d.logs.length,
      activeDayCount: activeDays.size,
    };
  }

  /* ---------- Rendu ---------- */
  function kpi(label, value, sub) {
    return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
  }

  const fmtPct = (x) => x == null ? '—' : `${Math.round(x * 100)} %`;

  function render(container) {
    const S = window.Store;
    const st = compute();
    const total = S.data.cards.length;

    if (!total) {
      container.innerHTML = `<div class="empty"><div class="empty-kanji">統計</div><p>Les statistiques apparaîtront dès que vous aurez ajouté et révisé quelques mots.</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="kpis">
        ${kpi('Jour', st.days.length, `${st.activeDayCount} jour${st.activeDayCount > 1 ? 's' : ''} de révision`)}
        ${kpi('Mots au total', total, `${st.cats.new} pas encore vus`)}
        ${kpi('Mémoire estimée', Math.round(st.memNow), st.studiedCount ? `mots retenus aujourd'hui sur ${st.studiedCount} étudiés` : 'aucun mot étudié')}
        ${kpi('Maîtrisés', st.cats.mastered, `stabilité ≥ ${S.MASTERED_S} jours`)}
        ${kpi('Taux de réussite', fmtPct(st.ret30), st.all30 ? `sur ${st.all30} révisions (30 derniers jours)` : 'pas encore de révision')}
        ${kpi('Série', `${st.streak} j`, `${st.reviewsToday} révision${st.reviewsToday > 1 ? 's' : ''} aujourd'hui`)}
      </div>

      <div class="range-row">
        <span class="range-label">Période</span>
        <div class="seg" id="rangeSeg">
          ${[[7, '7 j'], [30, '30 j'], [90, '90 j'], [0, 'Tout']].map(([v, l]) => `<button data-r="${v}" class="${range === v ? 'on' : ''}">${l}</button>`).join('')}
        </div>
      </div>

      <div class="chart-grid">
        <section class="panel wide">
          <header><h3>Évolution du vocabulaire</h3><p>Mots ajoutés, mots retenus (estimation FSRS : somme des probabilités de rappel) et mots maîtrisés.</p></header>
          <div class="chart-box tall"><canvas id="chMemory"></canvas></div>
        </section>
        <section class="panel">
          <header><h3>Révisions par jour</h3><p>Réparties selon votre réponse.</p></header>
          <div class="chart-box"><canvas id="chReviews"></canvas></div>
        </section>
        <section class="panel">
          <header><h3>Taux de réussite</h3><p>Part des mots déjà appris retrouvés (moyenne sur 7 jours). Pointillés : votre rétention visée.</p></header>
          <div class="chart-box"><canvas id="chRetention"></canvas></div>
        </section>
        <section class="panel">
          <header><h3>Révisions à venir</h3><p>Nombre de mots à revoir dans les 30 prochains jours.</p></header>
          <div class="chart-box"><canvas id="chForecast"></canvas></div>
        </section>
        <section class="panel">
          <header><h3>Où en sont vos mots</h3><p>Nouveau → en apprentissage → jeune → maîtrisé.</p></header>
          <div class="statebar" id="stateBar"></div>
          <header class="sub"><h3>Solidité des souvenirs</h3><p>Stabilité FSRS : nombre de jours avant que la probabilité de rappel tombe à 90 %.</p></header>
          <div class="chart-box short"><canvas id="chStability"></canvas></div>
        </section>
        <section class="panel">
          <header><h3>Difficulté des mots</h3><p>Difficulté FSRS de 1 (facile) à 10 (très difficile)${st.avgDiff != null ? ` — moyenne ${st.avgDiff.toFixed(1)}` : ''}.</p></header>
          <div class="chart-box"><canvas id="chDifficulty"></canvas></div>
        </section>
        <section class="panel">
          <header><h3>Mots qui vous résistent</h3><p>Les plus oubliés ou les plus difficiles. FSRS les fait revenir plus souvent.</p></header>
          ${st.hard.length ? `<table class="hard-table"><thead><tr><th>Mot</th><th>Oublis</th><th>Difficulté</th><th>Rappel</th></tr></thead><tbody>
            ${st.hard.map(c => `<tr data-id="${c.id}"><td><span class="jp">${esc(c.word)}</span> <span class="muted jp">${esc(c.reading !== c.word ? c.reading : '')}</span></td>
              <td>${c.fsrs.lapses}</td><td><div class="dbar"><i style="width:${c.fsrs.difficulty * 10}%"></i></div>${c.fsrs.difficulty.toFixed(1)}</td>
              <td>${fmtPct(S.retrievabilityNow(c))}</td></tr>`).join('')}
          </tbody></table>` : '<p class="muted pad">Aucun mot difficile pour l\'instant. 👍</p>'}
        </section>
      </div>`;

    container.querySelectorAll('#rangeSeg button').forEach(b => b.addEventListener('click', () => { range = +b.dataset.r; render(container); window.Motion && window.Motion.countUp(container, '.kpi-value'); }));
    container.querySelectorAll('.hard-table tr[data-id]').forEach(tr => tr.addEventListener('click', () => window.App.openEditor(+tr.dataset.id)));

    drawCharts(st);
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  /* ---------- Chart.js ---------- */
  function baseOptions(extra = {}) {
    const text2 = css('--text-2'), grid = css('--grid');
    return Object.assign({
      responsive: true, maintainAspectRatio: false,
      animation: window.Motion && !window.Motion.ok() ? false : { duration: 700, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css('--tooltip-bg'), titleColor: css('--tooltip-fg'), bodyColor: css('--tooltip-fg'),
          borderColor: css('--line'), borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
          usePointStyle: true,
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: grid }, ticks: { color: text2, maxRotation: 0, autoSkip: true, autoSkipPadding: 14 } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text2, precision: 0, maxTicksLimit: 6 } },
      },
    }, extra);
  }

  // étiquettes directes au bout des courbes
  const endLabels = {
    id: 'endLabels',
    afterDatasetsDraw(chart, _a, opts) {
      if (!opts || !opts.enabled) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = '600 12px ' + css('--font-ui');
      ctx.textBaseline = 'middle';
      const placed = [];
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden || !meta.data.length) return;
        const pt = meta.data[meta.data.length - 1];
        let y = pt.y;
        for (const p of placed) if (Math.abs(p - y) < 15) y = p + (y >= p ? 15 : -15);
        placed.push(y);
        const v = ds.data[ds.data.length - 1];
        ctx.fillStyle = css('--text-1');
        ctx.fillText(`${typeof v === 'number' ? Math.round(v) : v}`, pt.x + 8, y);
      });
      ctx.restore();
    },
  };

  // ligne verticale de survol
  const crosshair = {
    id: 'crosshair',
    afterDraw(chart) {
      const a = chart.tooltip && chart.tooltip.getActiveElements && chart.tooltip.getActiveElements();
      if (!a || !a.length || chart.config.type !== 'line') return;
      const x = a[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
      ctx.save(); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
    },
  };

  function mk(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    charts[id] = new Chart(el, cfg);
  }

  function drawCharts(st) {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = css('--font-ui');
    Chart.defaults.font.size = 12;
    const days = range ? st.days.slice(-range) : st.days;
    const labels = days.map(d => `J${d.num}`);
    const c1 = css('--s1'), c2 = css('--s2'), c3 = css('--s3');
    const line = (label, data, color) => ({
      label, data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.25,
      pointRadius: data.length > 40 ? 0 : 2.5, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: css('--surface'),
      spanGaps: true,
    });
    const titleCb = { title: (items) => `Jour ${items[0].label.slice(1)}` };

    // 1. Évolution du vocabulaire
    mk('chMemory', {
      type: 'line',
      data: { labels, datasets: [
        line('Mots ajoutés', days.map(d => d.cum), c1),
        line('Mots retenus (estimation)', days.map(d => +d.memory.toFixed(1)), c2),
        line('Mots maîtrisés', days.map(d => d.mastered), c3),
      ] },
      options: baseOptions({
        layout: { padding: { right: 36 } },
        plugins: Object.assign(baseOptions().plugins, {
          legend: { display: true, position: 'top', align: 'start', labels: { color: css('--text-1'), usePointStyle: true, pointStyle: 'line', boxWidth: 18, padding: 14 } },
          endLabels: { enabled: true },
          tooltip: Object.assign(baseOptions().plugins.tooltip, { callbacks: Object.assign({}, titleCb, { label: (it) => ` ${it.dataset.label} : ${Math.round(it.parsed.y)}` }) }),
        }),
      }),
      plugins: [endLabels, crosshair],
    });

    // 2. Révisions par jour (empilé par note)
    const gradeNames = ['', 'Oublié', 'Difficile', 'Bien', 'Facile'];
    const gradeColors = ['', css('--g1'), css('--g2'), css('--g3'), css('--g4')];
    mk('chReviews', {
      type: 'bar',
      data: { labels, datasets: [1, 2, 3, 4].map(g => ({
        label: gradeNames[g], data: days.map(d => d.g[g]), backgroundColor: gradeColors[g],
        borderColor: css('--surface'), borderWidth: { top: 2 }, borderSkipped: 'bottom', borderRadius: 3,
        maxBarThickness: 22, stack: 's',
      })) },
      options: baseOptions({
        scales: Object.assign(baseOptions().scales, { x: Object.assign(baseOptions().scales.x, { stacked: true }), y: Object.assign(baseOptions().scales.y, { stacked: true }) }),
        plugins: Object.assign(baseOptions().plugins, {
          legend: { display: true, position: 'top', align: 'start', labels: { color: css('--text-1'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, padding: 12 } },
          tooltip: Object.assign(baseOptions().plugins.tooltip, { callbacks: Object.assign({}, titleCb, { footer: (items) => `Total : ${items.reduce((a, i) => a + i.parsed.y, 0)}` }) }),
        }),
      }),
    });

    // 3. Taux de réussite (moyenne glissante 7 j)
    const all = range ? st.days.slice(-range - 6) : st.days;
    const roll = [];
    for (let i = 0; i < all.length; i++) {
      let ok = 0, n = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) { ok += all[j].revOk; n += all[j].revAll; }
      roll.push(n ? Math.round(ok / n * 1000) / 10 : null);
    }
    const rollData = roll.slice(all.length - days.length);
    const target = Math.round(window.Store.data.settings.desiredRetention * 100);
    mk('chRetention', {
      type: 'line',
      data: { labels, datasets: [
        line('Réussite (7 j)', rollData, c1),
        { label: 'Objectif', data: days.map(() => target), borderColor: css('--text-3'), borderDash: [4, 4], borderWidth: 1, pointRadius: 0, pointHoverRadius: 0 },
      ] },
      options: baseOptions({
        scales: Object.assign(baseOptions().scales, { y: Object.assign(baseOptions().scales.y, { beginAtZero: false, suggestedMin: 50, max: 100, ticks: Object.assign(baseOptions().scales.y.ticks, { callback: v => v + ' %' }) }) }),
        plugins: Object.assign(baseOptions().plugins, {
          tooltip: Object.assign(baseOptions().plugins.tooltip, { callbacks: Object.assign({}, titleCb, { label: (it) => it.parsed.y == null ? '' : ` ${it.dataset.label} : ${it.parsed.y} %` }) }),
        }),
      }),
      plugins: [crosshair],
    });

    // 4. Prévision
    mk('chForecast', {
      type: 'bar',
      data: { labels: st.forecast.map((_, i) => i === 0 ? 'Auj.' : `+${i}`), datasets: [{
        label: 'Mots à réviser', data: st.forecast, backgroundColor: c1, borderRadius: 3, borderSkipped: 'bottom', maxBarThickness: 18,
      }] },
      options: baseOptions({
        plugins: Object.assign(baseOptions().plugins, {
          tooltip: Object.assign(baseOptions().plugins.tooltip, { callbacks: {
            title: (items) => items[0].dataIndex === 0 ? "Aujourd'hui (en retard compris)" : `Dans ${items[0].dataIndex} jour${items[0].dataIndex > 1 ? 's' : ''}`,
            label: (it) => ` ${it.parsed.y} mot${it.parsed.y > 1 ? 's' : ''}`,
          } }),
        }),
      }),
    });

    // 5. Barre d'états
    const sb = document.getElementById('stateBar');
    if (sb) {
      const total = Object.values(st.cats).reduce((a, b) => a + b, 0) || 1;
      const items = [['new', 'Nouveaux', '--o1'], ['learning', 'En apprentissage', '--o2'], ['young', 'Jeunes', '--o3'], ['mastered', 'Maîtrisés', '--o4']];
      sb.innerHTML = `<div class="sb-track">${items.filter(([k]) => st.cats[k]).map(([k, l, v]) =>
        `<div class="sb-seg" style="flex:${st.cats[k]};background:var(${v})" title="${l} : ${st.cats[k]}"></div>`).join('')}</div>
        <div class="sb-legend">${items.map(([k, l, v]) =>
          `<span><i style="background:var(${v})"></i>${l} <b>${st.cats[k]}</b> <em>${Math.round(st.cats[k] / total * 100)} %</em></span>`).join('')}</div>`;
    }

    // 6. Stabilité
    mk('chStability', {
      type: 'bar',
      data: { labels: st.stabLabels, datasets: [{ label: 'Mots', data: st.stabBins, backgroundColor: c1, borderRadius: 3, borderSkipped: 'bottom', maxBarThickness: 34 }] },
      options: baseOptions({ plugins: Object.assign(baseOptions().plugins, { tooltip: Object.assign(baseOptions().plugins.tooltip, { callbacks: { title: (i) => `Stabilité ${i[0].label}`, label: (it) => ` ${it.parsed.y} mot${it.parsed.y > 1 ? 's' : ''}` } }) }) }),
    });

    // 7. Difficulté
    mk('chDifficulty', {
      type: 'bar',
      data: { labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(x => `${x}–${+x + 1}`), datasets: [{
        label: 'Mots', data: st.diffBins, backgroundColor: c2, borderRadius: 3, borderSkipped: 'bottom', maxBarThickness: 34,
      }] },
      options: baseOptions({ plugins: Object.assign(baseOptions().plugins, { tooltip: Object.assign(baseOptions().plugins.tooltip, { callbacks: { title: (i) => `Difficulté ${i[0].label}`, label: (it) => ` ${it.parsed.y} mot${it.parsed.y > 1 ? 's' : ''}` } }) }) }),
    });
  }

  window.Stats = { render, compute };
})();
