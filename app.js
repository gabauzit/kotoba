/* =====================================================================
   Kotoba — interface
   ===================================================================== */
(function () {
  'use strict';
  const S = window.Store;
  const Motion = window.Motion;
  const { NEW, REVIEW } = window.FSRSLib;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  let view = 'review';
  let session = null;          // séance de révision en cours
  let listState = { q: '', filter: 'all', sort: 'recent' };
  let jaVoice = null;
  let isFullscreen = false;

  /* ---------- Utilitaires ---------- */
  function fmtIvl(days) {
    if (days === 0) return 'dans la séance';
    if (days === 1) return '1 jour';
    if (days < 31) return `${days} jours`;
    if (days < 365) return `${Math.round(days / 30.4)} mois`;
    const y = days / 365;
    return `${y < 10 ? y.toFixed(1).replace('.', ',') : Math.round(y)} an${y >= 2 ? 's' : ''}`;
  }
  function fmtDue(d) {
    if (d == null) return '—';
    if (d < 0) return `en retard (${-d} j)`;
    if (d === 0) return "aujourd'hui";
    if (d === 1) return 'demain';
    return `dans ${d} j`;
  }
  const catLabel = { new: 'Nouveau', learning: 'Apprentissage', young: 'Jeune', mastered: 'Maîtrisé' };

  function wordClass(w) {
    const n = [...w].length;
    return n > 7 ? 'xlong' : n > 4 ? 'long' : '';
  }

  /** Surligne le mot (ou son radical pour les verbes/adjectifs conjugués) dans une phrase */
  function highlight(sentence, word) {
    const s = esc(sentence);
    const chars = [...word];
    for (let cut = 0; cut <= Math.min(2, chars.length - 1); cut++) {
      const stem = chars.slice(0, chars.length - cut).join('');
      if (!stem) break;
      const e = esc(stem);
      if (s.includes(e)) return s.split(e).join(`<mark>${e}</mark>`);
    }
    return s;
  }

  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
    clearTimeout(toast._t); clearTimeout(toast._h);
    t.classList.remove('leaving');
    if (!t.hidden) { t.hidden = true; void t.offsetWidth; }
    t.hidden = false;
    const hide = () => {
      if (!Motion.ok()) { t.hidden = true; return; }
      t.classList.add('leaving');
      toast._h = setTimeout(() => { t.hidden = true; t.classList.remove('leaving'); }, 180);
    };
    if (action) $('button', t).onclick = () => { hide(); action.fn(); };
    toast._t = setTimeout(hide, action ? 6000 : Math.max(2600, msg.length * 55));
  }

  function speak(text) {
    if (!jaVoice || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = jaVoice; u.lang = 'ja-JP'; u.rate = 0.9;
    speechSynthesis.speak(u);
  }
  function loadVoices() {
    try {
      const vs = speechSynthesis.getVoices();
      jaVoice = vs.find(v => /^ja/i.test(v.lang)) || null;
    } catch (_) { jaVoice = null; }
  }

  /* ---------- Modales ---------- */
  let modalToken = 0;
  function openModal(html, cls = '') {
    modalToken++;
    const bd = $('#modal'), box = $('#modalBox');
    bd.classList.remove('closing');
    box.className = 'modal ' + cls;
    box.innerHTML = html;
    bd.hidden = false;
    return box;
  }
  function closeModal() {
    const bd = $('#modal');
    if (bd.hidden) return;
    const tok = ++modalToken;
    const done = () => { if (tok !== modalToken) return; bd.hidden = true; bd.classList.remove('closing'); $('#modalBox').innerHTML = ''; };
    if (!Motion.ok()) return done();
    bd.classList.add('closing');
    setTimeout(done, 140);
  }
  function isModalOpen() { const bd = $('#modal'); return !bd.hidden && !bd.classList.contains('closing'); }

  function confirmBox(title, text, okLabel = 'Confirmer', danger = true) {
    return new Promise(resolve => {
      const box = openModal(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p>
        <div class="form-actions" style="margin-top:20px"><span class="spacer"></span>
        <button class="btn ghost" data-a="no">Annuler</button>
        <button class="btn ${danger ? 'primary' : ''}" data-a="yes">${esc(okLabel)}</button></div>`, 'small');
      $('[data-a="no"]', box).onclick = () => { closeModal(); resolve(false); };
      $('[data-a="yes"]', box).onclick = () => { closeModal(); resolve(true); };
      $('[data-a="yes"]', box).focus();
    });
  }

  /* ---------- Onglet Vocabulaire : Réviser · Mots · Ajouter ---------- */
  const WORD_VIEWS = ['review', 'vocab', 'add'];
  const touchUI = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  function wordsHead(active, lead) {
    const c = S.counts();
    const due = c.learning + c.review + c.newCards;
    return `<div class="view-head w-head"><div><h1><span class="h-jp">単語</span>Vocabulaire</h1>${lead ? `<p class="lead"${lead.id ? ` id="${lead.id}"` : ''}>${lead.html || ''}</p>` : ''}</div>
      <div class="seg g-tabs w-tabs">
        <button data-w="review" class="${active === 'review' ? 'on' : ''}">Réviser${due ? ` <em>${due}</em>` : ''}</button>
        <button data-w="vocab" class="${active === 'vocab' ? 'on' : ''}">Mots${c.total ? ` <em>${c.total}</em>` : ''}</button>
        <button data-w="add" class="${active === 'add' ? 'on' : ''}">+ Ajouter</button>
      </div></div>`;
  }
  function wireWordsHead(root) { $$('.w-tabs button', root).forEach(b => b.onclick = () => { if (view !== b.dataset.w) show(b.dataset.w); }); }

  /* ---------- Petits écrans : cartes repliables (Lecture, Écriture, Traduction, Réglages) ---------- */
  const narrow = () => window.matchMedia('(max-width: 760px)').matches;
  const foldState = new Map(); // clé → ouvert ?
  function cardSummary(card) {
    const parts = [];
    $$('.choice.on b', card).forEach(b => parts.push(b.textContent.trim()));
    $$('.seg', card).forEach(sg => { const on = $('button.on', sg); if (on) parts.push(on.textContent.trim()); });
    $$('select', card).forEach(sel => { const o = sel.selectedOptions && sel.selectedOptions[0]; if (o) parts.push(o.textContent.trim()); });
    $$('.opt-row', card).forEach(r => { const out = $('.range-wrap output', r), lab = $(':scope > label', r); if (out && lab) parts.push(`${lab.textContent.trim()} ${out.textContent.trim()}`); });
    const chips = $$('.chip-box .tchip, .chip-box .chip', card).length;
    if (chips) parts.unshift(`${chips} mot${chips > 1 ? 's' : ''}`);
    return parts.filter(Boolean).slice(0, 4).join(' · ');
  }
  /**
   * Rend les cartes repliables sur téléphone : un appui sur le titre ouvre ou ferme la carte,
   * et une carte fermée résume ses choix. Sans effet sur grand écran.
   * @param root   conteneur
   * @param sel    sélecteur des cartes
   * @param key    préfixe pour mémoriser l'état (par page)
   * @param openFirst  ouvrir la première carte par défaut
   */
  function foldCards(root, sel, key, openFirst) {
    if (!root || !narrow()) return;
    // choix segmentés aux libellés longs : sur deux colonnes
    $$('.seg', root).forEach(sg => {
      const n = sg.children.length, len = sg.textContent.replace(/\s+/g, ' ').trim().length;
      sg.classList.toggle('seg-2col', n >= 4 && len > 40);
    });
    $$(sel, root).forEach((card, i) => {
      const head = $(':scope > .rd-card-head', card) || $(':scope > h3', card);
      if (!head || card.classList.contains('key-card')) return;
      const k = `${key}:${i}`;
      if (!foldState.has(k)) foldState.set(k, openFirst && i === 0);
      card.classList.add('foldable');
      card.classList.toggle('folded', !foldState.get(k));
      let sum = $(':scope > .fold-sum', card);
      if (!sum) { sum = document.createElement('div'); sum.className = 'fold-sum'; head.after(sum); }
      const refresh = () => { sum.textContent = cardSummary(card); };
      refresh();
      head.classList.add('fold-head');
      head.setAttribute('role', 'button');
      head.setAttribute('aria-expanded', String(foldState.get(k)));
      head.onclick = (e) => {
        if (e.target.closest('button, a, input, select')) return;
        const open = card.classList.contains('folded');
        foldState.set(k, open);
        card.classList.toggle('folded', !open);
        head.setAttribute('aria-expanded', String(open));
        if (open && Motion.ok()) Motion.fadeIn(card, 4, 180);
      };
      ['click', 'change', 'input'].forEach(ev => card.addEventListener(ev, () => setTimeout(refresh, 0)));
    });
  }

  /* ---------- Navigation ---------- */
  function show(v) {
    if (session && v !== 'review' && !session.done) {
      // on garde la séance en mémoire : on pourra la reprendre
    }
    view = v;
    const navV = WORD_VIEWS.includes(v) ? 'review' : v; // Réviser, Mots et Ajouter partagent l'onglet Vocabulaire
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === navV));
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
    Motion.syncNav();
    render();
    $('.main').scrollTop = 0;
    enterView(v);
  }

  /** Apparition échelonnée des blocs d'une page */
  function enterView(v) {
    if (['reading', 'writing', 'translation', 'grammar'].includes(v)) return; // ces pages gèrent leurs propres animations (rendu asynchrone)
    const root = $('#view-' + v);
    Motion.stagger(root, '.w-head, .counter, .home-actions > .btn, .kpi, .range-row, .panel, .vrow:not(.head), .toolbar, .form-card, .recent .chip, .set-group, .empty', { step: 26, max: 26 });
    Motion.countUp(root, '.counter b, .kpi-value');
  }

  function render() {
    renderChrome();
    if (view === 'review') renderReview();
    else if (view === 'vocab') renderVocab();
    else if (view === 'add') renderAdd();
    else if (view === 'grammar') window.Grammar.render($('#view-grammar'));
    else if (view === 'reading') window.Reading.render($('#view-reading'));
    else if (view === 'writing') window.Translate.render('fr2jp', $('#view-writing'));
    else if (view === 'translation') window.Translate.render('jp2fr', $('#view-translation'));
    else if (view === 'stats') window.Stats.render($('#view-stats'));
    else if (view === 'settings') renderSettings();
  }

  function setBadge(el, txt) {
    if (el.textContent === txt) return;
    el.textContent = txt;
    if (txt && Motion.ok()) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }

  function renderChrome() {
    const c = S.counts();
    const due = c.learning + c.review + c.newCards;
    setBadge($('#badgeDue'), due ? String(due) : '');
    if ($('#badgeTotal')) setBadge($('#badgeTotal'), c.total ? String(c.total) : '');
    if (window.Grammar) { const g = window.Grammar.counts(); const n = g.review + g.learning + g.newCards; setBadge($('#badgeGrammar'), n ? String(n) : ''); }
    $('#dayLabel').textContent = S.data.startDay == null ? 'Bienvenue' : `Jour ${S.currentDayNumber()}`;
    const mastered = S.data.cards.filter(x => S.isMastered(x)).length;
    $('#sidebarFoot').innerHTML = c.total ? `${mastered} maîtrisé${mastered > 1 ? 's' : ''} sur ${c.total}` : '';
  }

  /* =====================================================================
     RÉVISION
     ===================================================================== */
  function renderReview() {
    const root = $('#view-review');
    if (session && session.study) return session.mini ? renderMini() : renderStudy();
    if (session && !session.done) return renderCard();
    if (session && session.done) return renderSummary();

    const c = S.counts();
    const due = c.learning + c.review;
    const dayTxt = S.data.startDay == null ? '一日目' : `第${S.currentDayNumber()}日`;

    if (!c.total) {
      root.innerHTML = `${wordsHead('review')}<div class="home">
        <div class="home-day">はじめまして</div>
        <h1>Commencez par ajouter du vocabulaire</h1>
        <p class="lead">Chaque mot ajouté devient une carte. FSRS décidera ensuite quand vous la remontrer.</p>
        <div class="home-actions" style="margin-top:26px"><button class="btn primary big" id="goAdd">Ajouter mon premier mot</button></div>
      </div>`;
      $('#goAdd').onclick = () => show('add');
      wireWordsHead(root);
      return;
    }

    const nothing = due + c.newCards === 0;
    let nextTxt = '';
    if (nothing) {
      const next = S.data.cards.filter(x => x.fsrs.state !== NEW && x.fsrs.dueDay != null).map(x => x.fsrs.dueDay - S.today());
      const m = next.length ? Math.min(...next) : null;
      nextTxt = m != null ? `Prochaine révision ${fmtDue(m)}.` : '';
      if (c.newTotal) nextTxt += ` ${c.newTotal} nouveau${c.newTotal > 1 ? 'x' : ''} mot${c.newTotal > 1 ? 's' : ''} attend${c.newTotal > 1 ? 'ent' : ''} (limite de ${S.data.settings.newPerDay} par jour atteinte).`;
    }

    root.innerHTML = `${wordsHead('review')}<div class="home">
      <div class="home-day">${dayTxt}</div>
      ${nothing
        ? `<div class="done-mark">完</div><h1>Tout est révisé pour aujourd'hui</h1>`
        : `<h1>Séance du jour ${S.currentDayNumber()}</h1>`}
      <div class="counters">
        <div class="counter ${c.review ? 'hot' : ''}"><b>${c.review}</b><span>à réviser</span></div>
        <div class="counter"><b>${c.learning}</b><span>en apprentissage</span></div>
        <div class="counter"><b>${c.newCards}</b><span>nouveaux</span></div>
      </div>
      <div class="new-stepper" title="Nombre maximum de mots jamais vus présentés chaque jour (aussi dans Réglages)">
        <span>Nouveaux mots par jour</span>
        <button class="step-btn" data-step="-1" aria-label="Moins">−</button>
        <b id="newPerDayVal">${S.data.settings.newPerDay}</b>
        <button class="step-btn" data-step="1" aria-label="Plus">+</button>
        ${c.newTotal ? `<span class="muted small">${c.newTotal} en attente</span>` : ''}
      </div>
      <div class="home-actions">
        ${nothing ? '' : `<button class="btn primary big" id="startBtn">Commencer <kbd>Entrée</kbd></button>`}
        ${c.difficult ? `<button class="btn ${nothing ? 'primary big' : 'big'}" id="practiceHard">Entraîner les ${c.difficult} mot${c.difficult > 1 ? 's' : ''} difficile${c.difficult > 1 ? 's' : ''}</button>` : ''}
        ${nothing && c.total ? `<button class="btn big" id="practiceAll">Entraînement libre</button>` : ''}
        ${nothing && c.newTotal ? `<button class="btn big" id="moreNew">+ ${Math.min(c.newTotal, S.data.settings.newPerDay || 10)} nouveaux mots</button>` : ''}
      </div>
      <p class="home-note">${nothing ? esc(nextTxt) : `${c.total} mot${c.total > 1 ? 's' : ''} dans votre collection · ${c.difficult} difficile${c.difficult > 1 ? 's' : ''}`}</p>
      ${c.difficult || (nothing && c.total) ? `<p class="home-note" style="margin-top:4px">L'entraînement ne modifie pas la planification FSRS.</p>` : ''}
    </div>`;

    wireWordsHead(root);
    $('#startBtn') && ($('#startBtn').onclick = startSession);
    $('#practiceHard') && ($('#practiceHard').onclick = () => startPractice('hard'));
    $('#practiceAll') && ($('#practiceAll').onclick = () => startPractice('all'));
    $('#moreNew') && ($('#moreNew').onclick = () => {
      const news = S.data.cards.filter(x => x.fsrs.state === NEW).sort((a, b) => a.created - b.created).slice(0, S.data.settings.newPerDay || 10);
      session = newSession(news.map(x => x.id), false);
      if (S.data.settings.studyNew !== false) session.study = news.map(x => x.id);
      renderReview();
      Motion.stagger($('#view-review'), '.study-card', { step: 35, max: 30 });
    });
    $$('.new-stepper .step-btn', root).forEach(b => b.onclick = () => {
      const v = Math.max(0, Math.min(100, (S.data.settings.newPerDay || 0) + +b.dataset.step));
      S.updateSettings({ newPerDay: v, newPerDayUserSet: true });
      renderReview(); renderChrome();
      Motion.pop($('#newPerDayVal'));
    });
  }

  function newSession(queue, practice) {
    return { queue, practice, total: queue.length, done: false, revealed: false, current: null,
      history: [], results: { 1: 0, 2: 0, 3: 0, 4: 0 }, first: new Map(), forgotten: new Set(), seen: new Set(), undoStack: [] };
  }

  function startSession() {
    const q = S.buildSession();
    if (!q.length) return;
    session = newSession(q, false);
    const news = q.filter(id => { const c = S.get(id); return c && c.fsrs.state === NEW; });
    if (news.length && S.data.settings.studyNew !== false) session.study = news;
    renderReview();
    if (session.study) Motion.stagger($('#view-review'), '.study-head, .study-card, .study-foot', { step: 35, max: 30 });
  }

  /* ---------- Découverte des nouveaux mots, avant l'interrogation ---------- */
  function renderStudy() {
    const root = $('#view-review');
    const cards = session.study.map(id => S.get(id)).filter(Boolean);
    if (!cards.length) { session.study = null; return renderCard(); }
    const n = cards.length;
    root.innerHTML = `<div class="study">
      <div class="study-head">
        <div><div class="home-day">新しい言葉</div>
          <h1>${n} nouveau${n > 1 ? 'x' : ''} mot${n > 1 ? 's' : ''} à découvrir</h1>
          <p class="lead">Lisez-les tranquillement : écriture, lecture, sens et exemples. Ils seront ensuite mélangés à vos révisions.</p></div>
        <label class="study-toggle"><input type="checkbox" id="studyHide" ${session.studyHide ? 'checked' : ''}><span>Me tester</span><em>masque lecture et sens ; cliquez sur une carte pour la retourner</em></label>
      </div>
      <div class="study-grid ${session.studyHide ? 'hide' : ''}">${cards.map((c, i) => `
        <article class="study-card ${session.miniMissed && session.miniMissed.has(c.id) ? 'missed' : ''}" data-id="${c.id}">
          <div class="sc-top"><span class="sc-num">${i + 1}</span>${session.miniMissed && session.miniMissed.has(c.id) ? '<span class="tag hard">à revoir</span>' : ''}
            ${jaVoice ? `<button class="icon-btn" data-speak="${c.id}" title="Écouter">🔊</button>` : ''}
            <button class="icon-btn" data-edit="${c.id}" title="Modifier">✎</button></div>
          <div class="sc-word ${wordClass(c.word)}">${esc(c.word)}</div>
          <div class="sc-reading sw-hide">${c.reading && c.reading !== c.word ? esc(c.reading) : '&nbsp;'}</div>
          <div class="sc-meaning sw-hide">${esc(c.meaning) || '<span class="muted">(pas de sens renseigné)</span>'}</div>
          ${c.examples && c.examples.length ? `<ul class="sc-examples">${c.examples.slice(0, 2).map(e => `<li><div class="ex-jp">${highlight(e.jp, c.word)}</div>${e.fr ? `<div class="ex-fr sw-hide">${esc(e.fr)}</div>` : ''}</li>`).join('')}</ul>` : ''}
          ${c.notes ? `<div class="sc-notes sw-hide">${esc(c.notes)}</div>` : ''}
        </article>`).join('')}
      </div>
      <div class="study-foot">
        <button class="btn ghost" id="studyBack">← Retour</button>
        <span class="muted small">${session.queue.length - n ? `Puis ${session.queue.length - n} révision${session.queue.length - n > 1 ? 's' : ''} déjà prévue${session.queue.length - n > 1 ? 's' : ''}.` : ''}</span>
        <button class="btn big" id="studyMini" title="Interroge uniquement ces mots, dans un ordre aléatoire, sans modifier leur planification">🎲 Mini-test${n > 1 ? ` (${n} mots)` : ''} <kbd>T</kbd></button>
        <button class="btn primary big" id="studyGo">J'ai étudié ces mots, commencer <kbd>Entrée</kbd></button>
      </div>
    </div>`;
    $('#studyBack').onclick = quitSession;
    $('#studyMini').onclick = () => startMini();
    $('#studyGo').onclick = startAfterStudy;
    $('#studyHide').onchange = (e) => {
      session.studyHide = e.target.checked;
      $('.study-grid', root).classList.toggle('hide', session.studyHide);
      $$('.study-card', root).forEach(x => x.classList.remove('shown'));
    };
    $('.study-grid', root).onclick = (e) => {
      const sp = e.target.closest('[data-speak]'); if (sp) { const c = S.get(+sp.dataset.speak); return speak(c.reading || c.word); }
      const ed = e.target.closest('[data-edit]'); if (ed) return openEditor(+ed.dataset.edit);
      const card = e.target.closest('.study-card');
      if (card && session.studyHide) card.classList.toggle('shown');
    };
  }

  /* ---------- Mini-test sur les nouveaux mots (ordre aléatoire, sans effet sur FSRS) ---------- */
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function startMini(ids) {
    if (!session || !session.study) return;
    const pool = (ids || session.study).filter(id => S.get(id));
    if (!pool.length) return;
    session.mini = { queue: shuffle(pool), total: pool.length, first: new Map(), revealed: false, done: false, answered: 0, enter: true, retry: !!ids };
    renderReview();
  }

  function exitMini() {
    if (!session || !session.mini) return;
    session.mini = null;
    renderReview();
    Motion.stagger($('#view-review'), '.study-card', { step: 25, max: 30 });
  }

  function renderMini() {
    const root = $('#view-review');
    const m = session.mini;
    if (m.done || !m.queue.length) return renderMiniSummary();
    const c = S.get(m.queue[0]);
    if (!c) { m.queue.shift(); return renderMini(); }
    const pct = Math.round(m.first.size / m.total * 100);
    const showReading = c.reading && c.reading !== c.word;
    root.innerHTML = `<div class="session">
      <div class="session-top">
        <button class="btn ghost" id="miniBack" title="Retour aux mots (Échap)">← Retour aux mots</button>
        <div class="progress"><i style="width:${m.lastPct ?? pct}%"></i></div>
        <div class="session-count">${m.first.size} / ${m.total}</div>
      </div>
      <article class="card ${m.enter ? 'card-in' : ''}">
        <div class="card-tags"><span class="tag new">Mini-test</span>${m.first.has(c.id) ? '<span class="tag hard">à revoir</span>' : ''}</div>
        <div class="card-front"><div class="word ${wordClass(c.word)}">${esc(c.word)}</div></div>
        ${m.revealed ? `<div class="answer">
          ${showReading || jaVoice ? `<div class="reading">${showReading ? esc(c.reading) : ''} ${jaVoice ? '<button class="icon-btn speak" id="miniSpeak" title="Écouter (P)">🔊</button>' : ''}</div>` : ''}
          <div class="meaning">${esc(c.meaning) || '<span class="muted">(pas de sens renseigné)</span>'}</div>
          ${c.examples && c.examples.length ? `<ul class="examples">${c.examples.map(e => `<li><div class="ex-jp">${highlight(e.jp, c.word)}</div>${e.fr ? `<div class="ex-fr">${esc(e.fr)}</div>` : ''}</li>`).join('')}</ul>` : ''}
        </div>` : `<div class="reveal-row"><button class="btn primary big" id="miniReveal">Afficher la réponse <kbd>Espace</kbd></button></div>`}
      </article>
      ${m.revealed ? `<div class="grades practice">
        <button class="grade" data-g="1"><span class="g-name">Je ne savais pas</span><span class="g-hint">reviendra dans le mini-test <kbd>1</kbd></span></button>
        <button class="grade" data-g="3"><span class="g-name">Je savais</span><span class="g-hint">suivant <kbd>2</kbd></span></button>
      </div>` : ''}
      <div class="session-help">Mini-test : ordre aléatoire, sans effet sur la planification · <kbd>Échap</kbd> retour aux mots</div>
    </div>`;
    m.enter = false;
    const bar = $('.progress i', root);
    if (m.lastPct !== pct) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = pct + '%'; }));
    m.lastPct = pct;
    $('#miniBack').onclick = exitMini;
    if ($('#miniReveal')) $('#miniReveal').onclick = miniReveal;
    if ($('#miniSpeak')) $('#miniSpeak').onclick = () => speak(c.reading || c.word);
    $$('.grade', root).forEach(b => b.onclick = () => miniAnswer(+b.dataset.g));
  }

  function miniReveal() {
    const m = session && session.mini; if (!m || m.revealed || m.anim) return;
    const card = $('#view-review .card'); const h0 = card ? card.offsetHeight : 0;
    m.revealed = true;
    renderMini();
    if (h0) Motion.growFrom($('#view-review .card'), h0);
    Motion.stagger($('#view-review'), '.grade', { step: 35, delay: 60 });
  }

  function miniAnswer(g) {
    const m = session && session.mini; if (!m || !m.revealed || m.anim) return;
    const id = m.queue.shift();
    if (!m.first.has(id)) m.first.set(id, g);
    if (g === 1) m.queue.splice(Math.min(m.queue.length, 2 + Math.floor(Math.random() * 3)), 0, id); // revient un peu plus loin
    m.revealed = false;
    const card = $('#view-review .card');
    const color = getComputedStyle(document.documentElement).getPropertyValue(g === 1 ? '--g1' : '--g3').trim();
    const a = Motion.exit(card, [{ transform: 'none', opacity: 1, boxShadow: `0 0 0 0 ${color}` }, { transform: 'translateX(-34px) scale(.985)', opacity: 0, boxShadow: `0 0 0 4px ${color}` }], 160);
    const next = () => { m.anim = null; if (!m.queue.length) { m.done = true; return renderMini(); } m.enter = true; renderMini(); };
    if (!a) return next();
    m.anim = a; a.finished.then(next, next);
  }

  function renderMiniSummary() {
    const root = $('#view-review');
    const m = session.mini;
    const ok = [...m.first.values()].filter(g => g > 1).length;
    const missed = [...m.first.entries()].filter(([, g]) => g === 1).map(([id]) => id);
    session.miniMissed = new Set(missed);
    root.innerHTML = `<div class="summary">
      <div class="done-mark">${missed.length ? 'もう一度' : '完璧'}</div>
      <h1>Mini-test terminé</h1>
      <p class="lead">${ok} mot${ok > 1 ? 's' : ''} sur ${m.total} trouvé${ok > 1 ? 's' : ''} du premier coup</p>
      <div class="counters" style="grid-template-columns:repeat(2,1fr);max-width:440px;margin-left:auto;margin-right:auto">
        <div class="counter"><b>${ok}</b><span>du premier coup</span></div>
        <div class="counter ${missed.length ? 'hot' : ''}"><b>${missed.length}</b><span>à revoir</span></div>
      </div>
      ${missed.length ? `<div class="forgot-list">${missed.map(id => { const c = S.get(id); return c ? `<span title="${esc(c.reading)} — ${esc(c.meaning)}">${esc(c.word)}</span>` : ''; }).join('')}</div>` : ''}
      <div class="home-actions">
        ${missed.length ? `<button class="btn big" id="miniRetry">${missed.length > 1 ? `Refaire les ${missed.length} mots ratés` : 'Refaire le mot raté'}</button>` : ''}
        <button class="btn big" id="miniAgain">Refaire tout le mini-test</button>
        <button class="btn big" id="miniWords">Revoir les mots</button>
        <button class="btn primary big" id="miniStart">Commencer la séance <kbd>Entrée</kbd></button>
      </div>
    </div>`;
    if ($('#miniRetry')) $('#miniRetry').onclick = () => startMini(missed);
    $('#miniAgain').onclick = () => startMini();
    $('#miniWords').onclick = exitMini;
    $('#miniStart').onclick = () => { session.mini = null; startAfterStudy(); };
    Motion.stagger(root, '.counter, .forgot-list span, .home-actions .btn', { step: 45, delay: 200 });
    Motion.countUp(root, '.counter b', 600);
  }

  function startAfterStudy() {
    if (!session || !session.study) return;
    session.study = null;
    session.mini = null;
    session.enter = 'fwd';
    renderCard();
  }

  function startPractice(kind) {
    let cards = S.data.cards.filter(c => c.fsrs.state !== NEW);
    if (kind === 'hard') cards = cards.filter(c => S.isDifficult(c));
    if (!cards.length) cards = S.data.cards.slice();
    const ids = cards.map(c => c.id).sort(() => Math.random() - 0.5).slice(0, 40);
    session = newSession(ids, true);
    renderReview();
  }

  function endSession() {
    if (!session) return;
    session.done = true;
    session.current = null;
    renderReview();
    renderChrome();
  }

  function quitSession() { session = null; renderReview(); renderChrome(); enterView('review'); }

  function renderCard() {
    const root = $('#view-review');
    if (!session.queue.length) return endSession();
    const id = session.queue[0];
    const c = S.get(id);
    if (!c) { session.queue.shift(); return renderCard(); }
    session.current = id;

    const done = session.history.length;
    const remaining = session.queue.length;
    const pct = Math.round(done / (done + remaining) * 100);
    const hard = S.isDifficult(c);
    const isNew = c.fsrs.state === NEW;
    const showReading = c.reading && c.reading !== c.word;

    let gradesHtml = '';
    if (session.revealed) {
      if (session.practice) {
        gradesHtml = `<div class="grades practice">
          <button class="grade" data-g="1"><span class="g-name">Je ne savais pas</span><span class="g-hint">reviendra plus tard <kbd>1</kbd></span></button>
          <button class="grade" data-g="3"><span class="g-name">Je savais</span><span class="g-hint">suivant <kbd>2</kbd></span></button>
        </div>`;
      } else {
        const p = S.previewIntervals(c);
        const g = (n, name, hint) => `<button class="grade" data-g="${n}"><span class="g-name">${name}</span><span class="g-hint">${hint} · <kbd>${n}</kbd></span><span class="g-ivl">${fmtIvl(p[n])}</span></button>`;
        gradesHtml = `<div class="grades">
          ${g(1, 'Oublié', 'je ne savais pas')}
          ${g(2, 'Difficile', 'avec effort')}
          ${g(3, 'Bien', 'je savais')}
          ${g(4, 'Facile', 'sans hésiter')}
        </div>`;
      }
    }

    root.innerHTML = `<div class="session">
      <div class="session-top">
        <button class="btn ghost" id="quitBtn" title="Quitter la séance (Échap)">← Quitter</button>
        <div class="progress"><i style="width:${session.lastPct ?? pct}%"></i></div>
        <div class="session-count">${done} / ${done + remaining}</div>
      </div>
      <article class="card ${session.enter === 'back' ? 'card-in-back' : session.enter ? 'card-in' : ''}">
        <div class="card-tags">
          ${session.practice ? '<span class="tag">Entraînement</span>' : ''}
          ${isNew ? '<span class="tag new">Nouveau</span>' : ''}
          ${hard ? `<span class="tag hard">Mot difficile${c.fsrs.lapses ? ` · ${c.fsrs.lapses} oubli${c.fsrs.lapses > 1 ? 's' : ''}` : ''}</span>` : ''}
        </div>
        <div class="card-tools">
          ${session.undoStack.length ? '<button class="icon-btn" id="undoBtn" title="Annuler la dernière réponse (Ctrl+Z)">↶ Annuler</button>' : ''}
          <button class="icon-btn" id="editBtn" title="Modifier ce mot (E)">✎ Modifier</button>
        </div>
        <div class="card-front"><div class="word ${wordClass(c.word)}">${esc(c.word)}</div></div>
        ${session.revealed ? `<div class="answer">
          ${showReading || jaVoice ? `<div class="reading">${showReading ? esc(c.reading) : ''} ${jaVoice ? '<button class="icon-btn speak" id="speakBtn" title="Écouter (P)">🔊</button>' : ''}</div>` : ''}
          <div class="meaning">${esc(c.meaning) || '<span class="muted">(pas de sens renseigné)</span>'}</div>
          ${c.examples && c.examples.length ? `<ul class="examples">${c.examples.map(e => `<li><div class="ex-jp">${highlight(e.jp, c.word)}</div>${e.fr ? `<div class="ex-fr">${esc(e.fr)}</div>` : ''}</li>`).join('')}</ul>` : ''}
          ${c.notes ? `<div class="notes">${esc(c.notes)}</div>` : ''}
        </div>` : `<div class="reveal-row"><button class="btn primary big" id="revealBtn">Afficher la réponse <kbd>Espace</kbd></button></div>`}
      </article>
      ${gradesHtml}
      <div class="session-help">${session.revealed
        ? (session.practice ? '<kbd>1</kbd> ne savais pas · <kbd>2</kbd> savais' : 'Répondez honnêtement : <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd>')
        : 'Essayez de retrouver la lecture et le sens, puis révélez la réponse.'}
        · <kbd>E</kbd> modifier · <kbd>Échap</kbd> quitter</div>
    </div>`;

    session.enter = null;
    const bar = $('.progress i', root);
    if (session.lastPct !== pct) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = pct + '%'; }));
    session.lastPct = pct;

    $('#quitBtn').onclick = quitSession;
    $('#editBtn').onclick = () => openEditor(id);
    $('#undoBtn') && ($('#undoBtn').onclick = undo);
    $('#revealBtn') && ($('#revealBtn').onclick = reveal);
    $('#speakBtn') && ($('#speakBtn').onclick = () => speak(c.reading || c.word));
    $$('.grade', root).forEach(b => b.onclick = () => answer(+b.dataset.g));
  }

  function reveal() {
    if (!session || session.revealed || session.anim) return;
    const card = $('#view-review .card');
    const h0 = card ? card.offsetHeight : 0;
    session.revealed = true;
    renderCard();
    if (h0) Motion.growFrom($('#view-review .card'), h0);
    Motion.stagger($('#view-review'), '.grade', { step: 35, delay: 60 });
  }

  function answer(g) {
    if (!session || !session.revealed || session.anim) return;
    const id = session.queue.shift();
    const c = S.get(id);
    let undoFn = null, requeue = false;

    if (session.practice) {
      requeue = g === 1;
    } else {
      const res = S.grade(id, g);
      undoFn = res.undo;
      requeue = res.interval === 0;
    }
    session.results[g]++;
    if (!session.first.has(id)) session.first.set(id, g);
    if (g === 1) session.forgotten.add(id);
    session.history.push(id);

    let insertedAt = -1;
    if (requeue) {
      // revient quelques cartes plus loin (plus tôt si oublié)
      const gap = g === 1 ? 3 + Math.floor(Math.random() * 3) : 6 + Math.floor(Math.random() * 4);
      insertedAt = Math.min(session.queue.length, gap);
      session.queue.splice(insertedAt, 0, id);
    }
    session.undoStack.push({ id, g, undoFn, insertedAt });
    if (session.undoStack.length > 30) session.undoStack.shift();
    session.revealed = false;
    renderChrome();
    const card = $('#view-review .card');
    const color = getComputedStyle(document.documentElement).getPropertyValue('--g' + g).trim() || 'transparent';
    const a = Motion.exit(card, [
      { transform: 'none', opacity: 1, boxShadow: `0 0 0 0 ${color}` },
      { transform: 'translateX(-34px) scale(.985)', opacity: 0, boxShadow: `0 0 0 4px ${color}` },
    ], 160);
    if (card) $$('#view-review .grade').forEach(b => { if (+b.dataset.g !== g) b.style.opacity = '.35'; else b.style.borderColor = color; });
    const next = () => { session.anim = null; if (!session.queue.length) return endSession(); session.enter = 'fwd'; renderCard(); };
    if (!a) return next();
    session.anim = a;
    a.finished.then(next, next);
  }

  function undo() {
    if (!session || !session.undoStack.length) return;
    const u = session.undoStack.pop();
    if (u.undoFn) u.undoFn();
    if (u.insertedAt >= 0) {
      const i = session.queue.indexOf(u.id, u.insertedAt);
      if (i >= 0) session.queue.splice(i, 1);
    }
    session.queue.unshift(u.id);
    session.results[u.g]--;
    session.history.pop();
    if (!session.history.includes(u.id)) session.first.delete(u.id);
    if (u.g === 1 && !session.undoStack.some(x => x.id === u.id && x.g === 1)) session.forgotten.delete(u.id);
    session.revealed = true;
    session.done = false;
    session.enter = 'back';
    renderChrome();
    renderCard();
    toast('Réponse annulée');
  }

  function renderSummary() {
    const root = $('#view-review');
    const firsts = [...session.first.values()];
    const n = firsts.length;
    const r = { 1: 0, 2: 0, 3: 0, 4: 0 };
    firsts.forEach(g => r[g]++);
    const known = r[2] + r[3] + r[4];
    const forgotten = [...session.forgotten].map(id => S.get(id)).filter(Boolean);
    root.innerHTML = `<div class="summary">
      <div class="done-mark">${n ? 'お疲れ様' : '完'}</div>
      <h1>${session.practice ? 'Entraînement terminé' : 'Séance terminée'}</h1>
      <p class="lead">${n} mot${n > 1 ? 's' : ''} révisé${n > 1 ? 's' : ''} · ${n ? Math.round(known / n * 100) : 0} % retrouvés dès la première tentative</p>
      <div class="counters">
        <div class="counter"><b>${r[3] + r[4]}</b><span>sus</span></div>
        <div class="counter"><b>${r[2]}</b><span>avec effort</span></div>
        <div class="counter ${r[1] ? 'hot' : ''}"><b>${r[1]}</b><span>oubliés</span></div>
      </div>
      ${forgotten.length ? `<p class="muted">Mots oubliés pendant la séance — ils reviendront plus tôt :</p>
        <div class="forgot-list">${forgotten.map(c => `<span title="${esc(c.meaning)}">${esc(c.word)}</span>`).join('')}</div>` : ''}
      <div class="home-actions">
        <button class="btn primary big" id="backHome">Terminer</button>
        <button class="btn big" id="toStats">Voir mes statistiques</button>
      </div>
    </div>`;
    $('#backHome').onclick = quitSession;
    $('#toStats').onclick = () => { session = null; show('stats'); };
    Motion.stagger(root, '.counter, .forgot-list span, .home-actions .btn', { step: 45, delay: 250 });
    Motion.countUp(root, '.counter b', 700);
  }

  /* =====================================================================
     FORMULAIRE (ajout / modification)
     ===================================================================== */
  function formHtml(c = {}) {
    const ex = (c.examples && c.examples.length) ? c.examples : [{ jp: '', fr: '' }];
    return `<div class="field">
        <label for="fWord">Écriture <span class="hint">kanji, ou kana si le mot s'écrit en kana (ex. 食べる, コーヒー)</span></label>
        <input class="input jp-big" id="fWord" value="${esc(c.word)}" autocomplete="off" lang="ja">
        <div class="warn" id="dupWarn" hidden></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="fReading">Lecture <span class="hint">en kana</span></label>
          <input class="input jp" id="fReading" value="${esc(c.reading)}" autocomplete="off" lang="ja" data-ime-from="#fWord"></div>
        <div class="field"><label for="fMeaning">Sens</label>
          <input class="input" id="fMeaning" value="${esc(c.meaning)}" autocomplete="off" lang="fr"></div>
      </div>
      <div class="field"><label>Exemples de phrases <span class="hint">le mot sera surligné automatiquement</span></label>
        <div id="exRows">${ex.map(exRow).join('')}</div>
        <button class="btn ghost" id="addEx" type="button">+ Ajouter un exemple</button>
      </div>
      <div class="field"><label for="fNotes">Notes <span class="hint">facultatif : kanji, astuce mnémotechnique…</span></label>
        <textarea class="input" id="fNotes" lang="fr" rows="2" style="width:100%;resize:vertical">${esc(c.notes)}</textarea></div>`;
  }
  function exRow(e = { jp: '', fr: '' }) {
    return `<div class="ex-row"><input class="input jp ex-jp-in" placeholder="Phrase en japonais" value="${esc(e.jp)}" lang="ja">
      <input class="input ex-fr-in" placeholder="Traduction" value="${esc(e.fr)}" lang="fr">
      <button class="btn ghost ex-del" type="button" title="Retirer">✕</button></div>`;
  }
  function wireForm(root, exceptId) {
    const exRows = $('#exRows', root);
    $('#addEx', root).onclick = () => {
      exRows.insertAdjacentHTML('beforeend', exRow());
      const ins = $$('.ex-jp-in', exRows); ins[ins.length - 1].focus();
    };
    exRows.addEventListener('click', (e) => {
      if (e.target.classList.contains('ex-del')) {
        const row = e.target.closest('.ex-row');
        if ($$('.ex-row', exRows).length > 1) row.remove();
        else $$('input', row).forEach(i => i.value = '');
      }
    });
    const w = $('#fWord', root), warn = $('#dupWarn', root);
    const check = () => {
      const d = w.value.trim() && S.findDuplicate(w.value, exceptId);
      warn.hidden = !d;
      if (d) warn.textContent = `Ce mot existe déjà (${d.reading || ''} — ${d.meaning || ''}).`;
    };
    w.addEventListener('input', check);
    check();
  }
  function readForm(root) {
    return {
      word: $('#fWord', root).value,
      reading: $('#fReading', root).value,
      meaning: $('#fMeaning', root).value,
      notes: $('#fNotes', root).value,
      examples: $$('.ex-row', root).map(r => ({ jp: $('.ex-jp-in', r).value.trim(), fr: $('.ex-fr-in', r).value.trim() })),
    };
  }

  /* ---------- Vue Ajouter ---------- */
  function renderAdd() {
    const root = $('#view-add');
    const recent = S.data.cards.slice().sort((a, b) => b.created - a.created).slice(0, 12);
    root.innerHTML = `${wordsHead('add', { html: "Seule l'écriture est obligatoire, mais la lecture, le sens et des exemples rendent la carte bien plus utile." })}
      <div class="form-card" id="addForm">${formHtml()}
        <div class="form-actions"><span class="muted" style="font-size:12.5px"><kbd>Ctrl</kbd> + <kbd>Entrée</kbd> pour ajouter</span><span class="spacer"></span>
          <button class="btn primary" id="saveAdd">Ajouter le mot</button></div>
      </div>
      ${recent.length ? `<div class="recent"><h3>Derniers ajouts</h3><div class="chips">
        ${recent.map(c => `<div class="chip" data-id="${c.id}"><b>${esc(c.word)}</b><span>${esc(c.meaning)}</span></div>`).join('')}</div></div>` : ''}`;
    const form = $('#addForm');
    wireForm(form);
    const submit = () => {
      const f = readForm(form);
      if (!f.word.trim()) { $('#fWord').focus(); toast("L'écriture est obligatoire"); return; }
      const card = S.addCard(f);
      toast(`« ${card.word} » ajouté`, { label: 'Annuler', fn: () => { S.deleteCard(card.id); render(); } });
      renderAdd();
      $('#fWord').focus();
    };
    $('#saveAdd').onclick = submit;
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); submit(); } });
    $$('.chip', root).forEach(ch => ch.onclick = () => openEditor(+ch.dataset.id));
    wireWordsHead(root);
    // sur écran tactile, pas de clavier qui s'ouvre tout seul
    if (!touchUI()) setTimeout(() => $('#fWord') && $('#fWord').focus(), 0);
  }

  /* ---------- Éditeur (modale) ---------- */
  function openEditor(id) {
    const c = S.get(id);
    if (!c) return;
    const f = c.fsrs;
    const R = S.retrievabilityNow(c);
    const cat = S.category(c);
    const box = openModal(`<h2>Modifier « ${esc(c.word)} »</h2>
      <div class="modal-cols">
        <div class="form-card" id="editForm">${formHtml(c)}</div>
        <aside class="card-meta"><h4>Mémoire de ce mot</h4>
          <dl>
            <dt>État</dt><dd><span class="pill ${cat}">${catLabel[cat]}</span></dd>
            ${S.isDifficult(c) ? '<dt>Statut</dt><dd style="color:var(--accent)">Mot difficile</dd>' : ''}
            <dt>Ajouté</dt><dd>jour ${S.dayNumber(c.createdDay)}</dd>
            <dt>Révisions</dt><dd>${f.reps}</dd>
            <dt>Oublis</dt><dd>${f.lapses}</dd>
            <dt>Rappel actuel</dt><dd>${R == null ? '—' : Math.round(R * 100) + ' %'}</dd>
            <dt>Stabilité</dt><dd>${f.state === NEW ? '—' : fmtIvl(Math.max(1, Math.round(f.stability))).replace('dans la séance', '< 1 jour')}</dd>
            <dt>Difficulté</dt><dd>${f.state === NEW ? '—' : f.difficulty.toFixed(1) + ' / 10'}</dd>
            <dt>Prochaine</dt><dd>${fmtDue(S.daysUntilDue(c))}</dd>
          </dl>
          <div class="meta-actions">
            <button class="btn" id="resetCard" ${f.state === NEW ? 'disabled' : ''}>Réapprendre de zéro</button>
            <button class="btn danger" id="delCard">Supprimer le mot</button>
          </div>
        </aside>
      </div>
      <div class="form-actions" style="margin-top:16px"><span class="spacer"></span>
        <button class="btn ghost" id="cancelEdit">Annuler <kbd>Échap</kbd></button>
        <button class="btn primary" id="saveEdit">Enregistrer <kbd>Ctrl+Entrée</kbd></button></div>`);
    const form = $('#editForm', box);
    wireForm(form, id);
    const save = () => {
      const data = readForm(form);
      if (!data.word.trim()) { toast("L'écriture est obligatoire"); return; }
      S.updateCard(id, data);
      closeModal(); toast('Modifications enregistrées'); render();
    };
    $('#saveEdit', box).onclick = save;
    $('#cancelEdit', box).onclick = closeModal;
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save(); } });
    $('#resetCard', box).onclick = async () => {
      if (await confirmBox('Réapprendre ce mot ?', 'Sa progression FSRS sera remise à zéro (l\'historique des statistiques est conservé).', 'Réinitialiser')) {
        S.resetCard(id); toast('Le mot redevient nouveau'); render();
      } else openEditor(id);
    };
    $('#delCard', box).onclick = async () => {
      if (await confirmBox('Supprimer ce mot ?', `« ${c.word} » et tout son historique seront supprimés définitivement.`, 'Supprimer')) {
        if (session) { session.queue = session.queue.filter(x => x !== id); }
        S.deleteCard(id); toast('Mot supprimé'); render();
      } else openEditor(id);
    };
    if (!touchUI()) setTimeout(() => $('#fWord', box).focus(), 0);
  }

  /* =====================================================================
     VOCABULAIRE
     ===================================================================== */
  function renderVocab() {
    const root = $('#view-vocab');
    if (!S.data.cards.length) {
      root.innerHTML = `${wordsHead('vocab')}
        <div class="empty"><div class="empty-kanji">空</div><p>Aucun mot pour l'instant.</p><button class="btn primary" id="goAdd2">Ajouter un mot</button></div>`;
      $('#goAdd2').onclick = () => show('add');
      wireWordsHead(root);
      return;
    }
    if (!$('#vSearch', root)) {
      root.innerHTML = `${wordsHead('vocab', { id: 'vLead' })}
        <div class="toolbar">
          <input class="input search" id="vSearch" placeholder="Rechercher (kanji, kana, sens)…" value="${esc(listState.q)}">
          <select class="select" id="vFilter">
            <option value="all">Tous les mots</option><option value="new">Nouveaux</option><option value="learning">En apprentissage</option>
            <option value="young">Jeunes</option><option value="mastered">Maîtrisés</option><option value="hard">Difficiles</option><option value="due">À réviser aujourd'hui</option>
          </select>
          <select class="select" id="vSort">
            <option value="recent">Ajout le plus récent</option><option value="oldest">Ajout le plus ancien</option>
            <option value="due">Prochaine révision</option><option value="difficulty">Plus difficiles</option>
            <option value="recall">Plus fragiles (rappel)</option><option value="kana">Ordre des kana</option>
          </select>
        </div>
        <div id="vList"></div><div class="list-foot" id="vFoot"></div>`;
      $('#vFilter').value = listState.filter;
      $('#vSort').value = listState.sort;
      $('#vSearch').addEventListener('input', (e) => { listState.q = e.target.value; renderVocabList(); });
      $('#vFilter').onchange = (e) => { listState.filter = e.target.value; renderVocabList(); };
      $('#vSort').onchange = (e) => { listState.sort = e.target.value; renderVocabList(); };
      wireWordsHead(root);
    }
    renderVocabList();
  }

  function renderVocabList() {
    const q = listState.q.trim().toLowerCase();
    const today = S.today();
    let cards = S.data.cards.filter(c => !q ||
      c.word.toLowerCase().includes(q) || (c.reading || '').toLowerCase().includes(q) || (c.meaning || '').toLowerCase().includes(q));
    const f = listState.filter;
    if (f === 'hard') cards = cards.filter(c => S.isDifficult(c));
    else if (f === 'due') cards = cards.filter(c => c.fsrs.state !== NEW && c.fsrs.dueDay <= today);
    else if (f !== 'all') cards = cards.filter(c => S.category(c) === f);

    const due = (c) => c.fsrs.dueDay == null ? Infinity : c.fsrs.dueDay;
    const sorters = {
      recent: (a, b) => b.created - a.created,
      oldest: (a, b) => a.created - b.created,
      due: (a, b) => due(a) - due(b),
      difficulty: (a, b) => (b.fsrs.difficulty + b.fsrs.lapses) - (a.fsrs.difficulty + a.fsrs.lapses),
      recall: (a, b) => (S.retrievabilityNow(a) ?? 2) - (S.retrievabilityNow(b) ?? 2),
      kana: (a, b) => (a.reading || a.word).localeCompare(b.reading || b.word, 'ja'),
    };
    cards.sort(sorters[listState.sort]);

    const total = S.data.cards.length;
    $('#vLead').textContent = `${total} mot${total > 1 ? 's' : ''} · ${S.data.cards.filter(c => S.isMastered(c)).length} maîtrisé(s) · ${S.data.cards.filter(c => S.isDifficult(c)).length} difficile(s)`;

    const shown = cards.slice(0, 500);
    $('#vList').innerHTML = cards.length ? `<div class="vlist">
      <div class="vrow head"><span>Mot</span><span>Lecture</span><span>Sens</span><span>État</span><span>Révision</span><span>Difficulté</span></div>
      ${shown.map(c => {
        const cat = S.category(c), hard = S.isDifficult(c);
        return `<div class="vrow" data-id="${c.id}">
          <span class="v-word">${esc(c.word)}</span>
          <span class="v-reading">${esc(c.reading !== c.word ? c.reading : '')}</span>
          <span class="v-meaning" title="${esc(c.meaning)}">${esc(c.meaning)}</span>
          <span class="pill ${cat} ${hard ? 'hard' : ''}">${hard ? 'Difficile' : catLabel[cat]}</span>
          <span class="v-next">${c.fsrs.state === NEW ? '—' : fmtDue(S.daysUntilDue(c))}</span>
          <span>${c.fsrs.state === NEW ? '<span class="muted">—</span>' : `<span class="dbar"><i style="width:${c.fsrs.difficulty * 10}%"></i></span>`}</span>
        </div>`;
      }).join('')}</div>` : `<div class="empty" style="padding:6vh 0"><p>Aucun mot ne correspond.</p></div>`;
    $('#vFoot').textContent = cards.length > 500 ? `500 premiers résultats affichés sur ${cards.length}.` : '';
    $$('#vList .vrow[data-id]').forEach(r => r.onclick = () => openEditor(+r.dataset.id));
  }

  /* =====================================================================
     RÉGLAGES
     ===================================================================== */
  async function renderSettings() {
    const root = $('#view-settings');
    const web = window.kotobaAPI && window.kotobaAPI.platform === 'web';
    const OS = web ? 'le système' : 'Windows';
    const s = S.data.settings;
    const path = window.kotobaAPI ? await window.kotobaAPI.dataPath() : '(stockage du navigateur)';
    root.innerHTML = `<div class="view-head"><div><h1><span class="h-jp">設定</span>Réglages</h1></div></div>
      <div class="settings">
        <div class="set-group"><h3>Répétition espacée (FSRS)</h3>
          <div class="set-row"><div class="set-text"><b>Rétention visée</b>
            <span>Probabilité de vous souvenir d'un mot quand il revient. Plus haut = révisions plus fréquentes. 90 % est un bon équilibre.</span></div>
            <div class="range-wrap"><input type="range" id="sRet" min="0.75" max="0.97" step="0.01" value="${s.desiredRetention}"><output id="sRetOut">${Math.round(s.desiredRetention * 100)} %</output></div></div>
          <div class="set-row"><div class="set-text"><b>Nouveaux mots par jour</b><span>Nombre maximum de mots jamais vus présentés chaque jour (10 par défaut). Aussi réglable depuis l'écran Réviser.</span></div>
            <input class="input" type="number" id="sNew" min="0" max="100" value="${s.newPerDay}"></div>
          <div class="set-row"><div class="set-text"><b>Présenter les nouveaux mots avant la séance</b><span>Affiche tous les mots du jour jamais vus (écriture, lecture, sens, exemples) pour les étudier avant d'être interrogé.</span></div>
            <input type="checkbox" class="big-check" id="sStudy" ${s.studyNew !== false ? 'checked' : ''}></div>
          <div class="set-row"><div class="set-text"><b>Mélange</b><span>Un nouveau mot toutes les N révisions pendant la séance.</span></div>
            <input class="input" type="number" id="sMix" min="1" max="20" value="${s.newMixRatio}"></div>
          <div class="set-row"><div class="set-text"><b>Seuil « mot difficile »</b><span>Nombre d'oublis à partir duquel un mot est marqué difficile et proposé à l'entraînement ciblé.</span></div>
            <input class="input" type="number" id="sLeech" min="2" max="20" value="${s.leechThreshold}"></div>
          <div class="set-row"><div class="set-text"><b>Début de journée</b><span>Heure à laquelle un nouveau jour commence (pour réviser tard le soir).</span></div>
            <input class="input" type="number" id="sRoll" min="0" max="12" value="${s.rolloverHour}"></div>
        </div>
        <div class="set-group"><h3>Grammaire</h3>
          <div class="set-row"><div class="set-text"><b>Nouvelles structures par jour</b><span>Nombre maximum de structures jamais vues présentées chaque jour (5 par défaut).</span></div>
            <input class="input" type="number" id="sGNew" min="0" max="50" value="${s.grammarNewPerDay ?? 5}"></div>
          <div class="set-row"><div class="set-text"><b>Présenter les nouvelles structures avant la séance</b><span>Affiche les structures jamais vues pour les étudier avant d'être interrogé.</span></div>
            <input type="checkbox" class="big-check" id="sGStudy" ${s.grammarStudyNew !== false ? 'checked' : ''}></div>
          <div class="set-row"><div class="set-text"><b>Phrases d'exemple générées par l'IA</b><span>Une phrase par structure, traduction cachée. Sinon, révision en mode carte (titre → utilisation et description).</span></div>
            <input type="checkbox" class="big-check" id="sGAI" ${s.grammarAI !== false ? 'checked' : ''}></div>
        </div>
        <div class="set-group"><h3>Service d'IA (lecture générée)</h3>
          <div class="set-row"><div class="set-text"><b>Service</b><span>Gemini et Mistral ont un accès gratuit (avec des limites de requêtes) ; Claude est payant à l'usage.</span></div>
            <div class="seg" id="sProv"><button data-p="gemini">Gemini · gratuit</button><button data-p="mistral">Mistral · gratuit</button><button data-p="claude">Claude · payant</button></div></div>
          <div class="set-api" id="sApi"></div>
          <div class="set-row"><div class="set-text"><b>Modèle par défaut</b><span>Utilisé pour générer les textes et répondre à vos questions.</span></div>
            <select class="select" id="sModel">${window.Reading ? window.Reading.modelOptions('') : ''}</select></div>
          <div class="set-row"><div class="set-text"><b>Cache des réponses</b><span>Une question ou une explication déjà demandée est reprise instantanément, sans nouvelle requête. Les requêtes sont aussi organisées pour profiter du cache des services (début de requête identique).</span>
            <div class="path" id="sCacheInfo"></div></div>
            <button class="btn" id="sCacheClear">Vider le cache</button></div>
        </div>
        <div class="set-group"><h3>Apparence</h3>
          <div class="set-row"><div class="set-text"><b>Thème</b></div>
            <select class="select" id="sTheme"><option value="system">Comme ${OS}</option><option value="light">Clair</option><option value="dark">Sombre</option></select></div>
          <div class="set-row"><div class="set-text"><b>Animations</b><span>« Comme ${OS} » les réduit si l'option d'accessibilité « Effets d'animation » est désactivée.</span></div>
            <select class="select" id="sMotion"><option value="auto">Comme ${OS}</option><option value="on">Toujours</option><option value="off">Désactivées</option></select></div>
          ${window.kotobaAPI && window.kotobaAPI.imeSet ? `<div class="set-row"><div class="set-text"><b>Clavier automatique</b><span>Passe tout seul au clavier japonais (hiragana, ou katakana pour un mot en katakana) dans les champs japonais, et au clavier habituel dans les champs en français. Nécessite le clavier japonais de Windows (Microsoft IME).</span></div>
            <input type="checkbox" class="big-check" id="sKbd" ${s.autoKeyboard !== false ? 'checked' : ''}></div>` : ''}
        </div>
        <div class="set-group"><h3>Données</h3>
          <div class="set-row"><div class="set-text"><b>Sauvegarde automatique</b>
            <span>Tout est enregistré à chaque modification, avec une copie de sécurité quotidienne (14 jours).</span>
            <div class="path">${esc(path)}</div></div>
            ${window.kotobaAPI ? '<button class="btn" id="sOpen">Ouvrir le dossier</button>' : ''}</div>
          <div class="set-row"><div class="set-text"><b>Exporter / importer</b><span>Un fichier .json avec tout votre vocabulaire et votre historique.</span></div>
            <button class="btn" id="sExport">Exporter</button><button class="btn" id="sImport">Importer</button></div>
        </div>
        ${window.kotobaAPI && window.kotobaAPI.syncStatus ? '<div class="set-group" id="sSync"><h3>Synchronisation GitHub</h3><div class="sync-box"></div></div>' : ''}
        <div class="set-group"><h3>Raccourcis clavier</h3>
          <div class="shortcuts">
            <span><kbd>Espace</kbd></span><span>Afficher la réponse</span>
            <span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></span><span>Oublié · Difficile · Bien · Facile</span>
            <span><kbd>Ctrl</kbd>+<kbd>Z</kbd></span><span>Annuler la dernière réponse</span>
            <span><kbd>E</kbd></span><span>Modifier la carte affichée</span>
            <span><kbd>P</kbd></span><span>Écouter la prononciation (si une voix japonaise est installée${web ? ' sur l\'appareil' : ' dans Windows'})</span>
            <span><kbd>Ctrl</kbd>+<kbd>N</kbd></span><span>Ajouter un mot</span>
            <span><kbd>Ctrl</kbd>+<kbd>1…7</kbd></span><span>Changer d'onglet</span>
            <span><kbd>F11</kbd></span><span>Plein écran (Échap pour en sortir)${web ? '' : ' · mémorisé à la réouverture'}</span>
          </div>
        </div>
        <div class="set-group"><h3>Comment ça marche</h3>
          <p class="lead" style="padding:4px 0 14px;font-size:13px">FSRS modélise chaque mot avec trois variables : <b>difficulté</b> (1–10, monte quand vous oubliez),
          <b>stabilité</b> (jours avant que le souvenir ne tombe à 90 %) et <b>récupérabilité</b> (probabilité actuelle de vous en souvenir).
          À chaque réponse, il met à jour ces valeurs et programme la prochaine révision au moment où vous êtes sur le point d'oublier.
          Un mot que vous oubliez souvent voit sa difficulté augmenter et sa stabilité grandir lentement : il revient donc beaucoup plus souvent.
          Les mots oubliés reviennent aussi dans la même séance jusqu'à ce que vous les retrouviez.</p>
        </div>
      </div>`;

    $('#sTheme').value = s.theme;
    $('#sMotion').value = s.motion || 'auto';
    $('#sMotion').onchange = (e) => { S.updateSettings({ motion: e.target.value }); Motion.apply(e.target.value); toast(Motion.ok() ? 'Animations activées' : 'Animations désactivées'); };
    if (window.Reading && window.kotobaAPI) {
      const R = window.Reading;
      const rp = Object.assign({}, S.data.readingPrefs || {});
      if (!R.MODELS.some(m => m.id === rp.model)) rp.model = 'gemini-3.8-flash';
      let prov = R.providerOf(rp.model);
      const renderApi = () => {
        $$('#sProv button').forEach(b => b.classList.toggle('on', b.dataset.p === prov));
        R.renderKeyBox($('#sApi'), () => { $('#sModel').innerHTML = R.modelOptions(Object.assign({}, S.data.readingPrefs).model); renderApi(); }, prov);
      };
      const showCache = async () => { const c = await window.kotobaAPI.aiCacheInfo(); $('#sCacheInfo').textContent = `${c.entries} réponse${c.entries > 1 ? 's' : ''} en cache · ${(c.bytes / 1024).toFixed(0)} Ko`; };
      showCache();
      $('#sCacheClear').onclick = async () => { await window.kotobaAPI.aiCacheClear(); showCache(); toast('Cache des réponses vidé'); };
      renderApi();
      $('#sModel').value = rp.model;
      $('#sProv').onclick = (e) => {
        const b = e.target.closest('button'); if (!b || b.dataset.p === prov) return;
        prov = b.dataset.p;
        // modèle par défaut du service choisi
        const m = R.PROVIDERS[prov].models[0].id;
        S.data.readingPrefs = Object.assign(rp, { model: m }); S.save();
        $('#sModel').value = m; renderApi();
      };
      $('#sModel').onchange = (e) => {
        S.data.readingPrefs = Object.assign(rp, { model: e.target.value }); S.save();
        prov = R.providerOf(e.target.value); renderApi(); toast('Modèle mis à jour');
      };
    }
    const ret = $('#sRet');
    ret.oninput = () => { $('#sRetOut').textContent = Math.round(ret.value * 100) + ' %'; };
    ret.onchange = () => { S.updateSettings({ desiredRetention: +ret.value }); toast('Rétention visée mise à jour'); };
    const num = (sel, key, min, max) => { $(sel).onchange = (e) => {
      const v = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || min));
      e.target.value = v; S.updateSettings({ [key]: v }); renderChrome();
    }; };
    num('#sNew', 'newPerDay', 0, 100);
    $('#sNew').addEventListener('change', () => S.updateSettings({ newPerDayUserSet: true }));
    $('#sStudy').onchange = (e) => S.updateSettings({ studyNew: e.target.checked });
    num('#sGNew', 'grammarNewPerDay', 0, 50);
    $('#sGStudy').onchange = (e) => S.updateSettings({ grammarStudyNew: e.target.checked });
    $('#sGAI').onchange = (e) => S.updateSettings({ grammarAI: e.target.checked });
    num('#sMix', 'newMixRatio', 1, 20);
    num('#sLeech', 'leechThreshold', 2, 20);
    num('#sRoll', 'rolloverHour', 0, 12);
    $('#sTheme').onchange = (e) => { S.updateSettings({ theme: e.target.value }); applyTheme(); };
    $('#sKbd') && ($('#sKbd').onchange = (e) => { S.updateSettings({ autoKeyboard: e.target.checked }); toast(e.target.checked ? 'Clavier automatique activé' : 'Clavier automatique désactivé'); });
    if ($('#sSync')) renderSyncBox($('#sSync .sync-box'));
    if (touchUI()) { const sc = $('.shortcuts', root); if (sc) sc.closest('.set-group').remove(); }
    foldCards(root, '.set-group', 'settings', false);
    $('#sOpen') && ($('#sOpen').onclick = () => window.kotobaAPI.openFolder());
    $('#sExport').onclick = async () => {
      if (window.kotobaAPI) { const p = await window.kotobaAPI.exportData(JSON.stringify(S.data, null, 1)); if (p) toast('Export enregistré'); }
    };
    $('#sImport').onclick = async () => {
      if (!window.kotobaAPI) return;
      const text = await window.kotobaAPI.importData();
      if (!text) return;
      let parsed;
      try { parsed = JSON.parse(text); if (!Array.isArray(parsed.cards)) throw 0; }
      catch (_) { toast('Fichier non reconnu'); return; }
      if (await confirmBox('Importer cette sauvegarde ?', `Elle contient ${parsed.cards.length} mots et remplacera vos données actuelles.`, 'Importer')) {
        S.importJSON(text); session = null; applyTheme(); toast('Import terminé'); render();
      }
    };
  }

  /* ---------- Synchronisation GitHub (réglages) ---------- */
  const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
  let syncBoxRefresh = null;
  const syncWhen = (t) => {
    if (!t) return 'jamais';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
  };
  function syncPhaseText(st) {
    if (!st.enabled) return 'Non connecté';
    return ({ pulling: 'Lecture du dépôt…', pushing: 'Envoi…', offline: 'Hors ligne : les modifications seront envoyées au retour de la connexion', error: st.error || 'Erreur', blocked: st.error || 'Bloqué' })[st.phase]
      || (st.pending ? 'Modifications en attente d\'envoi' : `Synchronisé ${syncWhen(st.lastSync)}`);
  }
  function tokenHelp() {
    return `<details class="sync-help"><summary>Comment créer le jeton ?</summary><ol>
      <li>Ouvrez <a href="${TOKEN_URL}" target="_blank" rel="noopener">GitHub → Fine-grained personal access tokens → Generate new token</a>.</li>
      <li><b>Repository access</b> : « Only select repositories », puis choisissez uniquement le dépôt <b>privé</b> de données.</li>
      <li><b>Permissions → Repository permissions → Contents</b> : « Read and write ». Rien d'autre.</li>
      <li>Choisissez une durée d'expiration, générez, puis copiez le jeton (il commence par <code>github_pat_</code>).</li>
    </ol><p>Le jeton ne donne accès qu'à ce dépôt. Il reste sur cet appareil${window.kotobaAPI && window.kotobaAPI.platform === 'web' ? '' : ' (chiffré par Windows)'} et n'est jamais écrit dans les données ni dans le code.</p></details>`;
  }
  async function renderSyncBox(box) {
    const api = window.kotobaAPI;
    const web = api.platform === 'web';
    const info = await api.syncStatus();
    const cfg = info.config || {};
    if (!info.configured) {
      box.innerHTML = `<p class="set-note">Partagez vos mots, votre grammaire et votre avancement entre cette application et la page web, grâce à un dépôt GitHub <b>privé</b>. Le dépôt garde aussi l'historique de chaque version.</p>
        <div class="sync-form">
          <label>Dépôt de données<input class="input" id="syRepo" data-ime="latin" placeholder="propriétaire/kotoba-data" value="${esc(cfg.owner ? cfg.owner + '/' + cfg.repo : '')}" spellcheck="false"></label>
          <label>Fichier<input class="input" id="syPath" data-ime="latin" value="${esc(cfg.path || 'kotoba-data.json')}" spellcheck="false"></label>
          <label class="wide">Jeton d'accès (fine-grained)<input class="input" id="syToken" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
        </div>
        ${tokenHelp()}
        <div class="sync-actions"><span class="sync-msg" id="syMsg"></span><button class="btn primary" id="syGo">Connecter</button></div>`;
      $('#syGo', box).onclick = async () => {
        const btn = $('#syGo', box); btn.disabled = true; $('#syMsg', box).textContent = 'Vérification…'; $('#syMsg', box).className = 'sync-msg';
        const [owner, repo] = $('#syRepo', box).value.trim().split('/');
        const r = await api.syncConnect({ owner, repo, path: $('#syPath', box).value }, $('#syToken', box).value);
        btn.disabled = false;
        if (!r.ok) { $('#syMsg', box).textContent = r.error; $('#syMsg', box).className = 'sync-msg bad'; return; }
        $('#syToken', box).value = '';
        if (r.warning) toast(r.warning);
        const res = await window.Sync.connected();
        toast(res && res.ok ? 'Synchronisation activée' : (window.Sync.status().error || 'Connexion établie, synchronisation en échec'));
        renderSyncBox(box); render();
      };
      return;
    }
    const st = window.Sync.status();
    box.innerHTML = `<div class="set-row"><div class="set-text"><b>${esc(cfg.owner)}/${esc(cfg.repo)} · ${esc(cfg.path)}</b>
        <span class="sync-state ${st.phase === 'error' || st.phase === 'blocked' ? 'bad' : ''}" id="syState">${esc(syncPhaseText(st))}</span>
        <span>Les données sont relues à l'ouverture et toutes les 2 minutes, et envoyées peu après chaque modification${web ? '' : ' ainsi qu\'à la fermeture'}. Deux appareils utilisés en même temps ne s'écrasent pas : leurs modifications sont fusionnées.</span></div>
        <button class="btn" id="syNow">Synchroniser</button></div>
      ${api.historyList ? `<div class="set-row"><div class="set-text"><b>Historique local des versions</b><span>Chaque version reçue ou envoyée est gardée sur cet ordinateur. Vous pouvez en restaurer une à tout moment.</span><div class="path" id="syHistInfo"></div></div>
        <button class="btn" id="syHist">Voir l'historique</button></div>` : ''}
      <div class="set-row"><div class="set-text"><b>Jeton</b><span>${esc(info.hint || '')}${web ? ' · mémorisé dans ce navigateur' : ' · chiffré par Windows'}</span></div>
        <button class="btn" id="syToken2">Changer</button><button class="btn ghost" id="syOff">${web ? 'Verrouiller cet appareil' : 'Déconnecter'}</button></div>`;
    const refreshState = () => { const el = $('#syState', box); if (!el) return; const s2 = window.Sync.status(); el.textContent = syncPhaseText(s2); el.classList.toggle('bad', s2.phase === 'error' || s2.phase === 'blocked'); };
    syncBoxRefresh = refreshState;
    $('#syNow', box).onclick = async () => { $('#syNow', box).disabled = true; const r = await window.Sync.syncNow(); if ($('#syNow', box)) $('#syNow', box).disabled = false; toast(r && r.ok ? 'Données synchronisées' : (window.Sync.status().error || 'Synchronisation impossible')); refreshState(); };
    if (api.historyList) {
      api.historyList().then(list => { const el = $('#syHistInfo', box); if (el) el.textContent = `${list.length} version${list.length > 1 ? 's' : ''} · ${(list.reduce((a, x) => a + x.size, 0) / 1048576).toFixed(1)} Mo`; });
      $('#syHist', box).onclick = () => openHistory();
    }
    $('#syToken2', box).onclick = () => {
      const m = openModal(`<h2>Nouveau jeton GitHub</h2><p class="lead">Pour le dépôt ${esc(cfg.owner)}/${esc(cfg.repo)}.</p>
        <input class="input" id="syT" type="password" placeholder="github_pat_…" autocomplete="off" style="width:100%;margin:10px 0">${tokenHelp()}
        <div class="form-actions" style="margin-top:16px"><span class="sync-msg" id="syTMsg"></span><span class="spacer"></span><button class="btn ghost" data-a="no">Annuler</button><button class="btn primary" data-a="ok">Enregistrer</button></div>`, 'small');
      $('[data-a="no"]', m).onclick = closeModal;
      $('[data-a="ok"]', m).onclick = async () => {
        const r = await api.syncConnect(cfg, $('#syT', m).value);
        if (!r.ok) { $('#syTMsg', m).textContent = r.error; $('#syTMsg', m).className = 'sync-msg bad'; return; }
        closeModal(); toast('Jeton mis à jour'); await window.Sync.connected(); renderSyncBox(box);
      };
      $('#syT', m).focus();
    };
    $('#syOff', box).onclick = async () => {
      const msg = web ? 'Le jeton et la copie locale des données seront effacés de ce navigateur. Vos données restent dans le dépôt GitHub.'
        : 'Le jeton sera effacé de cet ordinateur. Vos données restent ici et dans le dépôt GitHub ; la synchronisation s\'arrête.';
      if (!await confirmBox(web ? 'Verrouiller cet appareil ?' : 'Déconnecter GitHub ?', msg, web ? 'Verrouiller' : 'Déconnecter')) return;
      await window.Sync.flush();
      await api.syncDisconnect();
      await window.Sync.disconnected();
      if (web) { location.reload(); return; }
      toast('Synchronisation arrêtée'); renderSyncBox(box);
    };
  }

  async function openHistory() {
    const api = window.kotobaAPI;
    const list = await api.historyList();
    const kinds = { recu: 'reçue du dépôt', envoye: 'envoyée', 'avant-restauration': 'avant restauration' };
    const when = (t) => { const d = new Date(t); return `Jour ${S.dayNumber(S.dayKey(t))} · ${String(d.getHours()).padStart(2, '0')} h ${String(d.getMinutes()).padStart(2, '0')}`; };
    const m = openModal(`<h2>Historique des versions</h2>
      <p class="lead">Toutes les versions du fichier de données reçues ou envoyées par cet ordinateur. Restaurer une version la rend à nouveau active sur tous vos appareils ; la version actuelle est gardée dans l'historique.</p>
      <div class="vh-list">${list.length ? list.map(x => `<div class="vh-row"><span class="vh-when">${when(x.t)}</span><span class="vh-kind">${kinds[x.kind] || x.kind}</span><span class="vh-size">${Math.max(1, Math.round(x.size / 1024))} Ko</span><button class="btn small" data-n="${esc(x.name)}">Restaurer</button></div>`).join('') : '<div class="empty">Aucune version pour l\'instant.</div>'}</div>
      <div class="form-actions" style="margin-top:16px"><button class="btn ghost" id="hOpen">Ouvrir le dossier</button><span class="spacer"></span><button class="btn" data-a="close">Fermer</button></div>`);
    $('[data-a="close"]', m).onclick = closeModal;
    $('#hOpen', m).onclick = () => api.historyOpen();
    $$('[data-n]', m).forEach(b => b.onclick = async () => {
      const x = list.find(v => v.name === b.dataset.n);
      const text = await api.historyRead(b.dataset.n);
      let parsed = null; try { parsed = JSON.parse(text); } catch (_) {}
      if (!parsed || !Array.isArray(parsed.cards)) { toast('Version illisible'); return; }
      closeModal();
      if (!await confirmBox('Restaurer cette version ?', `${when(x.t)} : ${parsed.cards.length} mots, ${((parsed.grammar || {}).items || []).length} structures. Elle remplacera les données actuelles sur tous vos appareils.`, 'Restaurer')) return;
      try { await window.Sync.restore(text); session = null; toast('Version restaurée'); render(); }
      catch (e) { toast('Restauration impossible : ' + e.message); }
    });
  }

  /** Indicateur discret dans la barre latérale */
  function renderSyncPill(st) {
    const el = $('#syncPill'); if (!el) return;
    if (!st.enabled) { el.hidden = true; return; }
    el.hidden = false;
    const busy = st.phase === 'pulling' || st.phase === 'pushing';
    const bad = st.phase === 'error' || st.phase === 'blocked';
    el.className = 'sync-pill' + (busy ? ' busy' : '') + (bad ? ' bad' : '') + (st.phase === 'offline' ? ' off' : '');
    el.textContent = busy ? 'Synchronisation…' : bad ? 'Synchronisation : erreur' : st.phase === 'offline' ? 'Hors ligne' : st.pending ? 'Envoi en attente' : 'Synchronisé';
    el.title = syncPhaseText(st);
  }

  function applyTheme() {
    Motion.themeFade();
    const t = S.data.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    if (view === 'stats') window.Stats.render($('#view-stats'));
  }

  /* =====================================================================
     CLAVIER
     ===================================================================== */
  function onKey(e) {
    if (session && session.anim && !e.repeat) {
      const anim = session.anim, ev = e;
      e.preventDefault();
      anim.finish();
      setTimeout(() => onKey({ key: ev.key, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey, target: document.body, preventDefault() {} }), 0);
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

    if (e.key === 'Escape') {
      if (window.Reading && window.Reading.handleEscape()) { e.preventDefault(); return; }
      if (isModalOpen()) { closeModal(); e.preventDefault(); return; }
      if (view === 'review' && session && session.mini) { exitMini(); e.preventDefault(); return; }
      if (view === 'review' && session && !session.done) { quitSession(); e.preventDefault(); return; }
      if (isFullscreen && window.kotobaAPI) { window.kotobaAPI.setFullscreen(false); e.preventDefault(); return; }
    }
    if (isModalOpen()) return;

    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const views = ['review', 'grammar', 'reading', 'writing', 'translation', 'stats', 'settings'];
      if (/^[1-7]$/.test(e.key)) { e.preventDefault(); show(views[+e.key - 1]); return; }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); show('add'); return; }
      if (e.key.toLowerCase() === 'z' && !typing && view === 'review' && session) { e.preventDefault(); undo(); return; }
    }
    if (typing || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    if (view !== 'review') return;

    if (!session) {
      if (e.key === 'Enter' && $('#startBtn')) { e.preventDefault(); startSession(); }
      return;
    }
    if (session.done) { if (e.key === 'Enter') { e.preventDefault(); quitSession(); } return; }
    if (session.study && session.mini) {
      const m = session.mini;
      if (m.anim) { e.preventDefault(); m.anim.finish(); return; }
      if (m.done || !m.queue.length) { if (e.key === 'Enter') { e.preventDefault(); session.mini = null; startAfterStudy(); } return; }
      if (!m.revealed) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); miniReveal(); } }
      else if (e.key === '1') miniAnswer(1);
      else if (e.key === '2' || e.key === '3' || e.key === ' ') { e.preventDefault(); miniAnswer(3); }
      if (e.key.toLowerCase() === 'p' && m.revealed) { const c = S.get(m.queue[0]); if (c) speak(c.reading || c.word); }
      return;
    }
    if (session.study) {
      if (e.key === 'Enter') { e.preventDefault(); startAfterStudy(); }
      else if (e.key.toLowerCase() === 't') { e.preventDefault(); startMini(); }
      return;
    }

    if (!session.revealed) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); }
    } else if (session.practice) {
      if (e.key === '1') answer(1);
      else if (e.key === '2' || e.key === ' ') { e.preventDefault(); answer(3); }
    } else if (/^[1-4]$/.test(e.key)) {
      answer(+e.key);
    }
    if (e.key.toLowerCase() === 'e' && session.current) openEditor(session.current);
    if (e.key.toLowerCase() === 'p' && session.revealed && session.current) { const c = S.get(session.current); speak(c.reading || c.word); }
  }

  /* =====================================================================
     DÉMARRAGE
     ===================================================================== */
  async function boot() {
    await S.init();
    const web = window.kotobaAPI && window.kotobaAPI.platform === 'web';
    if (window.Sync) {
      window.Sync.onStatus((st) => { renderSyncPill(st); if (syncBoxRefresh && view === 'settings') syncBoxRefresh(); });
      $('#syncPill') && ($('#syncPill').onclick = () => show('settings'));
      // données reçues d'un autre appareil : on rafraîchit l'affichage sans interrompre une séance
      S.onReplace(() => {
        applySettingsAfterSync();
        if (view === 'settings' || isModalOpen()) return;
        if (view === 'review' && session && !session.done) return;
        if (['vocab', 'stats', 'review'].includes(view)) render();
      });
      // la page web attend la première lecture du dépôt ; l'application Windows démarre tout de suite
      const first = window.Sync.start();
      if (web) await first;
    }
    if (window.kotobaAPI && window.kotobaAPI.onClosing) {
      window.kotobaAPI.onClosing(async () => {
        try { S.saveSync(); await Promise.race([window.Sync ? window.Sync.flush() : null, new Promise(r => setTimeout(r, 10000))]); }
        finally { window.kotobaAPI.closeReady(); }
      });
    }
    Motion.apply(S.data.settings.motion || 'auto');
    applyTheme();
    $$('.nav-item').forEach(b => b.onclick = () => show(b.dataset.view));
    $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', () => S.saveSync());
    if (window.kotobaAPI && window.kotobaAPI.onFullscreen) {
      window.kotobaAPI.onFullscreen((on) => {
        isFullscreen = on;
        document.documentElement.classList.toggle('fullscreen', on);
        if (on) toast('Plein écran · F11 ou Échap pour quitter');
      });
      window.kotobaAPI.isFullscreen().then(on => { isFullscreen = on; document.documentElement.classList.toggle('fullscreen', on); });
    }
    try { speechSynthesis.onvoiceschanged = () => { loadVoices(); }; loadVoices(); } catch (_) {}
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (view === 'stats') window.Stats.render($('#view-stats')); });

    // changement de jour pendant que l'app est ouverte
    let lastDay = S.today();
    setInterval(() => {
      const t = S.today();
      if (t !== lastDay) { lastDay = t; if (!session || session.done) render(); else renderChrome(); }
    }, 60e3);

    show('review');
  }

  function applySettingsAfterSync() {
    renderChrome();
    Motion.apply(S.data.settings.motion || 'auto');
    const t = S.data.settings.theme;
    const cur = document.documentElement.getAttribute('data-theme') || 'system';
    if (cur !== (t === 'light' || t === 'dark' ? t : 'system')) applyTheme();
  }

  window.App = { openEditor, show, toast, openModal, closeModal, confirmBox, formHtml, wireForm, readForm, renderChrome, foldCards, touchUI };
  boot();
})();
