/* =====================================================================
   作文 Écriture (français → japonais) et 和訳 Traduction (japonais → français)
   Phrases générées par l'IA avec le vocabulaire de l'apprenant, puis corrigées par l'IA.
   ===================================================================== */
(function () {
  'use strict';
  const S = window.Store;
  const R = window.Reading;
  const API = window.kotobaAPI;
  const Motion = window.Motion;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const toast = (...a) => window.App.toast(...a);

  const DIRS = {
    fr2jp: {
      view: 'writing', jp: '作文', title: 'Écriture', instr: 'Traduisez en japonais', answerLang: 'ja',
      lead: 'Traduisez des phrases françaises en japonais, avec le vocabulaire que vous connaissez ou apprenez.',
      placeholder: 'Votre traduction en japonais…', exo: 'thème (traduction du français vers le japonais)',
    },
    jp2fr: {
      view: 'translation', jp: '和訳', title: 'Traduction', instr: 'Traduisez en français', answerLang: 'fr',
      lead: 'Traduisez en français des phrases japonaises écrites avec votre vocabulaire.',
      placeholder: 'Votre traduction en français…', exo: 'version (traduction du japonais vers le français)',
    },
  };
  const LENGTHS = { courtes: 'courtes (8 à 15 caractères japonais)', moyennes: 'moyennes (15 à 30 caractères japonais)', longues: 'longues (30 à 50 caractères japonais, avec une subordonnée)' };
  const DEFAULTS = {
    level: 'N4', count: 5, length: 'moyennes', register: 'poli', theme: '',
    targetMode: 'travail', targetCount: 8, includeUnseen: false, furigana: 'niveau',
  };
  const VERDICTS = {
    correct: { label: 'Juste', jp: '正解', cls: 'ok', score: 100, key: '3' },
    presque: { label: 'Presque', jp: '惜しい', cls: 'mid', score: 50, key: '2' },
    incorrect: { label: 'Faux', jp: '不正解', cls: 'ko', score: 0, key: '1' },
  };
  const ERR_TYPES = { vocabulaire: 'vocabulaire', grammaire: 'grammaire', particule: 'particule', conjugaison: 'conjugaison', kanji: 'kanji', ordre: 'ordre des mots', sens: 'sens', orthographe: 'orthographe', registre: 'registre', autre: 'autre' };

  /* ---------- État ---------- */
  const state = { fr2jp: { mode: 'setup' }, jp2fr: { mode: 'setup' } };
  const roots = {};
  let progressHooked = false;
  const progressHandlers = new Map();

  function prefs() {
    if (!S.data.exercisePrefs) S.data.exercisePrefs = {};
    return Object.assign({}, DEFAULTS, S.data.exercisePrefs);
  }
  function setPref(k, v) { S.data.exercisePrefs = Object.assign(prefs(), { [k]: v }); S.save(); }
  function exercises() { if (!Array.isArray(S.data.exercises)) S.data.exercises = []; return S.data.exercises; }
  const model = () => R.currentModel();
  const provider = () => R.providerOf(model());
  const pick = (p) => R._pickTargets({ targetMode: p.targetMode, targetCount: p.targetCount, includeUnseen: p.includeUnseen });

  function hookProgress() {
    if (progressHooked || !API) return;
    progressHooked = true;
    API.onAiProgress((pg) => { const h = progressHandlers.get(pg.id); if (h) h(pg); });
  }

  /** Requête IA avec suivi de progression */
  async function ai(req, onProgress) {
    const id = 'tr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    if (onProgress) progressHandlers.set(id, onProgress);
    try { return await API.aiMessage(id, Object.assign({ provider: provider(), model: model() }, req)); }
    finally { progressHandlers.delete(id); }
  }
  const maxTokens = (n) => provider() === 'gemini' ? 32768 : n;

  /* =====================================================================
     Rendu du japonais balisé : [[forme|vID]] (mot de la liste), {漢字|よみ} (furigana)
     ===================================================================== */
  function renderJP(str, opts = {}) {
    const { pieces } = R._parseMarkup(str || '');
    return pieces.map(pc => {
      if (pc.type === 'ruby') return `<ruby>${esc(pc.text)}<rt>${esc(pc.reading)}</rt></ruby>`;
      if (pc.type === 'v') {
        const c = S.get(pc.ref);
        const inner = opts.readings && c && c.reading && c.reading !== c.word && pc.text === c.word ? `<ruby>${esc(pc.text)}<rt>${esc(c.reading)}</rt></ruby>` : esc(pc.text);
        return `<span class="tw-mark${opts.reveal ? ' on' : ''}" data-v="${pc.ref}"${opts.reveal && c ? ` title="${esc(c.reading)} — ${esc(c.meaning)}"` : ''}>${inner}</span>`;
      }
      if (pc.type === 'n') return pc.reading ? `<ruby>${esc(pc.text)}<rt>${esc(pc.reading)}</rt></ruby>` : esc(pc.text);
      return esc(pc.text);
    }).join('');
  }
  const plainJP = (s) => R.stripMarkup(s || '');

  /* ---------- Différences entre la réponse et sa correction ---------- */
  function diffHTML(a, b, lang) {
    const tok = (s) => lang === 'ja' ? Array.from(s) : (s.match(/\s+|[^\s]+/g) || []);
    const x = tok(a || ''), y = tok(b || '');
    if (x.length * y.length > 250000) return `<del>${esc(a)}</del> <ins>${esc(b)}</ins>`;
    const n = x.length, m = y.length;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    // opérations élémentaires
    const ops = [];
    const push = (t, v) => { const last = ops[ops.length - 1]; if (last && last.t === t) last.v += v; else ops.push({ t, v }); };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { push('eq', x[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) push('del', x[i++]);
      else push('ins', y[j++]);
    }
    while (i < n) push('del', x[i++]);
    while (j < m) push('ins', y[j++]);
    // nettoyage : un petit morceau commun coincé entre deux modifications est absorbé, pour des blocs lisibles
    const small = (v) => lang === 'ja' ? Array.from(v).length <= 1 : !/\S{3,}/.test(v);
    let changed = true;
    while (changed) {
      changed = false;
      for (let k = 1; k < ops.length - 1; k++) {
        if (ops[k].t === 'eq' && ops[k - 1].t !== 'eq' && ops[k + 1].t !== 'eq' && small(ops[k].v)) {
          // regroupe [changements avant] eq [changements après] en un seul del + ins
          let s0 = k - 1; while (s0 > 0 && ops[s0 - 1].t !== 'eq') s0--;
          let e0 = k + 1; while (e0 < ops.length - 1 && ops[e0 + 1].t !== 'eq') e0++;
          let del = '', ins = '';
          for (let q = s0; q <= e0; q++) {
            if (ops[q].t !== 'ins') del += ops[q].v;
            if (ops[q].t !== 'del') ins += ops[q].v;
          }
          const repl = [];
          if (del) repl.push({ t: 'del', v: del });
          if (ins) repl.push({ t: 'ins', v: ins });
          ops.splice(s0, e0 - s0 + 1, ...repl);
          changed = true; break;
        }
      }
    }
    return ops.map(o => o.t === 'eq' ? esc(o.v) : o.t === 'del' ? `<del>${esc(o.v)}</del>` : `<ins>${esc(o.v)}</ins>`).join('');
  }

  /* =====================================================================
     Génération des phrases
     ===================================================================== */
  const GEN_SCHEMA = {
    type: 'object', required: ['sentences'],
    properties: {
      sentences: {
        type: 'array',
        items: {
          type: 'object', required: ['source', 'reference', 'target_ids', 'hint_fr'],
          properties: {
            source: { type: 'string', description: 'Phrase à traduire par l\'apprenant.' },
            reference: { type: 'string', description: 'Traduction de référence.' },
            reference_kana: { type: 'string', description: 'Sens français → japonais seulement : la phrase de référence entièrement en kana.' },
            target_ids: { type: 'array', items: { type: 'integer' }, description: 'ID des mots ciblés employés dans la phrase japonaise.' },
            hint_fr: { type: 'string', description: 'Indice de structure ou de grammaire, sans donner les mots.' },
            alternatives: { type: 'array', items: { type: 'string' }, description: 'Une ou deux autres traductions correctes et naturelles (même langue que la référence).' },
            notes_fr: { type: 'string', description: 'Une ou deux phrases : le point de grammaire ou le piège de la phrase, pour que l\'apprenant se corrige seul.' },
          },
        },
      },
    },
  };

  /** Liste de vocabulaire de l'apprenant, ordre stable (par ID) : identique d'une requête à l'autre, donc mise en cache par les services */
  function vocabBlock() {
    const all = S.data.cards.slice().sort((a, b) => a.id - b.id).slice(0, 2500);
    return all.length ? "LISTE DE L'APPRENANT (son vocabulaire, à baliser avec son ID) — ID:mot :\n" + all.map(c => `${c.id}:${c.word}`).join(' ') : "LISTE DE L'APPRENANT : vide.";
  }

  function genPrompt(dir, p, targetIds) {
    const targets = targetIds.map(id => S.get(id)).filter(Boolean);
    const jpField = dir === 'fr2jp' ? 'reference' : 'source';
    const frField = dir === 'fr2jp' ? 'source' : 'reference';
    const furi = {
      aucun: 'aucun furigana {…|…}',
      niveau: `furigana {漢字|よみ} uniquement sur les mots en kanji hors de la liste de l'apprenant et au-dessus du niveau ${p.level}`,
      tous: "furigana {漢字|よみ} sur tous les mots en kanji hors de la liste de l'apprenant",
    }[p.furigana] || 'aucun furigana';
    // Consignes fixes (une version par sens de traduction) : début de requête identique → cache des services
    const system = `Tu es un professeur de japonais qui prépare un exercice de ${DIRS[dir].exo} pour un apprenant francophone.
Ta réponse est uniquement l'objet JSON demandé, sans texte autour.

CHAMPS :
- "${frField}" : phrase en français naturel et sans ambiguïté.
- "${jpField}" : la même phrase en japonais naturel, au niveau et au registre demandés.
${dir === 'fr2jp' ? '- "reference_kana" : la phrase japonaise de référence entièrement en kana (hiragana et katakana).\n' : ''}- "target_ids" : les ID des mots ciblés employés dans la phrase japonaise.
- "hint_fr" : un indice de structure ou de grammaire (en français), qui aide sans donner la réponse.
- "alternatives" : une ou deux autres traductions correctes et naturelles${dir === 'fr2jp' ? ' (en japonais, même balisage)' : ' (en français)'}, pour que l'apprenant juge lui-même si sa réponse est acceptable.
- "notes_fr" : en une ou deux phrases, le point de grammaire ou le piège principal (particule, conjugaison, nuance), avec la lecture du japonais cité.

BALISAGE de la phrase japonaise ("${jpField}") uniquement :
- Chaque mot de la liste de l'apprenant (ciblé ou non) : [[forme telle qu'écrite|vID]] (il peut être conjugué : [[食べた|v12]]). Jamais de furigana sur ces mots.
- Furigana selon la consigne des PARAMÈTRES.
- Aucun autre balisage.

EXIGENCES :
- Le nombre de phrases, leur longueur, le niveau, le registre et le thème sont donnés dans les PARAMÈTRES.
- PRIORITÉ ABSOLUE : chaque phrase emploie 1 à 3 MOTS CIBLÉS, avec exactement leur graphie, et TOUS les mots ciblés sont employés au moins une fois dans l'ensemble des phrases.
- Mots de contenu : uniquement les mots ciblés, la liste de l'apprenant, et les mots grammaticaux et le vocabulaire N5 le plus élémentaire (する, ある, いる, 行く, 人, 日, 今日, 私…).
- ${dir === 'fr2jp' ? "La phrase française doit appeler naturellement les mots ciblés (son sens les désigne sans ambiguïté), pour que l'apprenant ait à les retrouver." : "La phrase japonaise met les mots ciblés dans un contexte qui aide à en deviner le sens."}`;
    const lines = [
      'PARAMÈTRES :',
      `- ${p.count} phrases indépendantes, ${LENGTHS[p.length]}`,
      `- niveau JLPT ${p.level}, registre ${p.register === 'poli' ? 'poli (です／ます)' : 'neutre (forme simple)'}`,
      `- thème : ${p.theme.trim() || 'varié et concret'}`,
      `- ${furi}`,
      '',
    ];
    if (targets.length) {
      lines.push(`MOTS CIBLÉS (${targets.length}, tous obligatoires) — ID | mot | lecture | sens :`);
      targets.forEach(c => lines.push(`${c.id} | ${c.word} | ${c.reading || ''} | ${c.meaning || ''}`));
    } else lines.push(`MOTS CIBLÉS : aucun. Utilise un vocabulaire courant du niveau ${p.level}.`);
    return {
      system, maxTokens: maxTokens(10000), cacheKey: 'kotoba-exercice-' + dir,
      json: { name: 'publier_exercice', description: "Publie les phrases de l'exercice.", schema: GEN_SCHEMA },
      messages: [{ role: 'user', content: [{ text: vocabBlock(), cache: true }, { text: lines.join('\n') }] }],
    };
  }

  function cleanSentences(arr, dir) {
    return (Array.isArray(arr) ? arr : []).filter(x => x && x.source && x.reference).map(x => ({
      source: String(x.source), reference: String(x.reference),
      reference_kana: x.reference_kana ? String(x.reference_kana) : '',
      target_ids: (Array.isArray(x.target_ids) ? x.target_ids : []).map(Number).filter(id => S.get(id)),
      hint_fr: x.hint_fr ? String(x.hint_fr) : '',
      alternatives: (Array.isArray(x.alternatives) ? x.alternatives : []).filter(Boolean).map(String).slice(0, 3),
      notes_fr: x.notes_fr ? String(x.notes_fr) : '',
    }));
  }
  const jpTexts = (dir, sents) => sents.map(x => dir === 'fr2jp' ? x.reference : x.source);

  async function generate(dir) {
    const st = state[dir], p = prefs();
    if (!st.targets) st.targets = pick(p);
    const body = genPrompt(dir, p, st.targets);
    st.mode = 'loading';
    st.loading = { started: Date.now(), chars: 0, label: `${R.aiName()} prépare les phrases` };
    render(dir);
    const tick = setInterval(() => updateLoading(dir), 500);
    let res = await ai(body, (pg) => { st.loading.chars = pg.chars; });
    let sents = res && !res.error ? cleanSentences(res.json && res.json.sentences, dir) : [];

    // contrôle : tous les mots ciblés sont-ils employés ? Sinon, une demande de correction.
    if (!res.error && sents.length) {
      const missing = R._missing({ paragraphs: jpTexts(dir, sents) }, st.targets);
      if (missing.length) {
        const words = missing.map(id => S.get(id));
        st.loading = { started: Date.now(), chars: 0, label: `Ajout des mots oubliés : ${words.map(c => c.word).join('、')}` };
        const res2 = await ai(Object.assign({}, body, { messages: body.messages.concat([
          { role: 'assistant', content: JSON.stringify({ sentences: sents }) },
          { role: 'user', content: `Exercice refusé : ces mots ciblés ne sont employés dans aucune phrase :\n${words.map(c => `${c.id} | ${c.word} | ${c.reading || ''} | ${c.meaning || ''}`).join('\n')}\nRéécris les phrases pour que TOUS les mots ciblés soient employés (même nombre de phrases). Réponds avec l'objet complet.` },
        ]) }), (pg) => { st.loading.chars = pg.chars; });
        const s2 = res2 && !res2.error ? cleanSentences(res2.json && res2.json.sentences, dir) : [];
        if (s2.length && R._missing({ paragraphs: jpTexts(dir, s2) }, st.targets).length < missing.length) sents = s2;
      }
    }
    clearInterval(tick);
    st.loading = null;
    if (res.error || !sents.length) {
      st.mode = 'setup'; await render(dir);
      if (!res.aborted) showError(dir, res.error || `Réponse illisible de ${R.aiName()}. Réessayez.`);
      return;
    }
    const ex = {
      id: Date.now(), dir, day: S.today(), created: Date.now(), prefs: p, targets: st.targets.slice(),
      sentences: sents, answers: {}, results: {}, chats: {}, hints: {}, done: false,
    };
    exercises().push(ex);
    while (exercises().length > 80) exercises().shift();
    S.save();
    st.targets = null;
    openExercise(dir, ex);
  }

  /* =====================================================================
     Rendu
     ===================================================================== */
  async function render(dir, root) {
    if (root) { roots[dir] = root; state[dir].animate = true; }
    const el = roots[dir]; if (!el) return;
    hookProgress();
    if (!API) { el.innerHTML = `<div class="empty"><p>Disponible uniquement dans l'application Windows.</p></div>`; return; }
    const st = state[dir];
    st.keyStatus = await API.aiKeyStatus(provider());
    if (st.mode === 'loading') return renderLoading(dir);
    if (st.mode === 'exercise' && st.ex) return renderExercise(dir);
    if (st.mode === 'summary' && st.ex) return renderSummary(dir);
    renderSetup(dir);
  }

  function seg(name, options, value) {
    return `<div class="seg" data-pref="${name}">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(value) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  }

  function chipsHtml(ids) {
    if (!ids.length) return `<span class="muted small">${S.data.cards.length ? 'Aucun mot sélectionné : un vocabulaire du niveau sera utilisé.' : 'Votre liste est vide : un vocabulaire du niveau sera utilisé.'}</span>`;
    return ids.map(id => { const c = S.get(id); if (!c) return ''; return `<span class="tchip ${S.isDifficult(c) ? 'hard' : ''}" title="${esc(c.reading)} — ${esc(c.meaning)}"><i class="pill ${S.category(c)}"></i><b class="jp">${esc(c.word)}</b><button data-rm="${id}" title="Retirer">✕</button></span>`; }).join('');
  }

  function renderSetup(dir) {
    const st = state[dir], p = prefs(), D = DIRS[dir], root = roots[dir];
    if (!st.targets) st.targets = pick(p);
    const ks = st.keyStatus;
    const hist = exercises().filter(e => e.dir === dir).slice().reverse();
    const P = R.PROVIDERS[provider()];
    root.innerHTML = `<div class="view-head"><div><h1><span class="h-jp">${D.jp}</span>${D.title}</h1><p class="lead">${D.lead}</p></div></div>
      ${ks.hasKey ? '' : `<section class="rd-card key-card"><h3>Connectez ${esc(P.label.replace(' — ', ' ('))})</h3><div id="trKey-${dir}"></div></section>`}
      <div class="rd-setup">
        <section class="rd-card">
          <div class="rd-card-head"><h3><span class="step">1</span>Mots à employer</h3><span class="muted" data-count>${st.targets.length} mot${st.targets.length > 1 ? 's' : ''}</span></div>
          <div class="opt-row"><label>Sélection</label>${seg('targetMode', [['travail', 'À travailler'], ['difficiles', 'Difficiles'], ['recents', 'Récents'], ['hasard', 'Au hasard']], p.targetMode)}</div>
          <div class="opt-row"><label>Nombre</label><div class="range-wrap"><input type="range" min="0" max="15" value="${p.targetCount}" data-range="targetCount"><output>${p.targetCount}</output></div>
            <button class="btn ghost small" data-act="reshuffle">↻ Autre sélection</button></div>
          <div class="chip-box" data-chips>${chipsHtml(st.targets)}</div>
          <div class="add-word"><input class="input" data-addword list="trWords-${dir}" placeholder="Ajouter un mot de ma liste…" autocomplete="off">
            <datalist id="trWords-${dir}">${S.data.cards.map(c => `<option value="${esc(c.word)}">${esc(c.reading)} — ${esc(c.meaning)}</option>`).join('')}</datalist></div>
          <div class="checks"><label><input type="checkbox" data-check="includeUnseen" ${p.includeUnseen ? 'checked' : ''}> Inclure des mots jamais révisés <span class="muted small">(sinon, utilisés seulement pour compléter)</span></label></div>
        </section>
        <section class="rd-card">
          <h3><span class="step">2</span>Exercice</h3>
          <div class="opt-row"><label>Niveau</label>${seg('level', R.LEVELS.map(l => [l, l]), p.level)}</div>
          <div class="opt-row"><label>Phrases</label><div class="range-wrap"><input type="range" min="3" max="10" value="${p.count}" data-range="count"><output>${p.count}</output></div></div>
          <div class="opt-row"><label>Longueur</label>${seg('length', [['courtes', 'Courtes'], ['moyennes', 'Moyennes'], ['longues', 'Longues']], p.length)}</div>
          <div class="opt-row"><label>Registre</label>${seg('register', [['poli', 'Poli (です・ます)'], ['neutre', 'Neutre (forme simple)']], p.register)}</div>
          ${dir === 'jp2fr' ? `<div class="opt-row"><label>Furigana</label>${seg('furigana', [['aucun', 'Aucun'], ['niveau', 'Au-dessus du niveau'], ['tous', 'Tous (hors mes mots)']], p.furigana)}</div>` : ''}
          <div class="opt-row"><label>Thème</label><input class="input grow" data-text="theme" value="${esc(p.theme)}" placeholder="facultatif : les courses, le travail, un voyage…"></div>
          <p class="muted small opt-note">Une seule requête à l'IA pour préparer l'exercice ; ensuite, vous comparez votre réponse à la solution et vous vous notez vous-même.</p>
        </section>
        <div class="rd-generate">
          <div class="model-pick"><label>Modèle</label><select class="select" data-model>${R.modelOptions(model())}</select></div>
          <div class="warn" data-error hidden></div>
          <button class="btn primary big" data-act="go" ${ks.hasKey ? '' : 'disabled'}>Préparer ${p.count} phrases <kbd>Ctrl+Entrée</kbd></button>
        </div>
      </div>
      ${hist.length ? `<section class="rd-history"><h3>Exercices précédents</h3><div class="hist-list">
        ${hist.map(e => { const sc = avgScore(e); return `<div class="hist-item" data-id="${e.id}">
          <span class="hist-title">${esc(dir === 'fr2jp' ? e.sentences[0].source : plainJP(e.sentences[0].source))}</span>
          <span class="muted">${e.sentences.length} phrases · ${e.done ? 'terminé' : `${Object.keys(e.results).length} / ${e.sentences.length} faites`}</span>
          <span class="hist-meta">Jour ${S.dayNumber(e.day)} · ${e.prefs.level}${sc != null ? ` · ${sc} / 100` : ''}</span>
          <button class="icon-btn hist-del" title="Supprimer">✕</button></div>`; }).join('')}</div></section>` : ''}`;

    if (!ks.hasKey) R.renderKeyBox($(`#trKey-${dir}`, root), () => render(dir));
    wireSetup(dir);
    if (st.animate) { st.animate = false; Motion.stagger(root, '.key-card, .rd-card, .rd-generate, .hist-item', { step: 40, max: 20 }); }
  }

  function wireSetup(dir) {
    const st = state[dir], root = roots[dir];
    const refreshChips = () => {
      $('[data-chips]', root).innerHTML = chipsHtml(st.targets);
      $('[data-count]', root).textContent = `${st.targets.length} mot${st.targets.length > 1 ? 's' : ''}`;
    };
    $$('.seg[data-pref]', root).forEach(sg => sg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      setPref(sg.dataset.pref, b.dataset.v);
      if (sg.dataset.pref === 'targetMode') st.targets = pick(prefs());
      renderSetup(dir);
    }));
    $$('input[data-range]', root).forEach(el => {
      el.addEventListener('input', () => { el.nextElementSibling.textContent = el.value; });
      el.addEventListener('change', () => {
        setPref(el.dataset.range, +el.value);
        if (el.dataset.range === 'targetCount') { st.targets = pick(prefs()); refreshChips(); }
        if (el.dataset.range === 'count') $('[data-act="go"]', root).firstChild.textContent = `Préparer ${el.value} phrases `;
      });
    });
    $$('input[data-check]', root).forEach(el => el.addEventListener('change', () => { setPref(el.dataset.check, el.checked); st.targets = pick(prefs()); refreshChips(); }));
    $$('input[data-text]', root).forEach(el => el.addEventListener('change', () => setPref(el.dataset.text, el.value)));
    $('[data-act="reshuffle"]', root).onclick = () => { st.targets = pick(prefs()); refreshChips(); };
    $('[data-chips]', root).addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; st.targets = st.targets.filter(id => id !== +b.dataset.rm); refreshChips(); });
    const addW = $('[data-addword]', root);
    const tryAdd = () => {
      const v = addW.value.trim(); if (!v) return;
      const c = S.data.cards.find(x => x.word === v) || S.data.cards.find(x => x.reading === v);
      if (!c) { toast('Ce mot n\'est pas dans votre liste'); return; }
      if (!st.targets.includes(c.id)) st.targets.push(c.id);
      addW.value = ''; refreshChips();
    };
    addW.addEventListener('change', tryAdd);
    addW.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(); } });
    $('[data-model]', root).onchange = (e) => { const before = provider(); R.setModel(e.target.value); if (provider() !== before) render(dir); };
    const go = () => { if (st.keyStatus.hasKey) generate(dir); };
    $('[data-act="go"]', root).onclick = go;
    $('.rd-setup', root).addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); go(); } });
    $$('.hist-item', root).forEach(it => it.addEventListener('click', async (e) => {
      const ex = exercises().find(x => x.id === +it.dataset.id); if (!ex) return;
      if (e.target.closest('.hist-del')) {
        if (await window.App.confirmBox('Supprimer cet exercice ?', 'Il sera retiré de l\'historique.', 'Supprimer')) { S.data.exercises = exercises().filter(x => x !== ex); S.save(); }
        renderSetup(dir); return;
      }
      openExercise(dir, ex);
    }));
  }

  function showError(dir, msg) {
    const box = $('[data-error]', roots[dir]);
    if (box) { box.hidden = false; box.textContent = msg; } else toast(msg);
  }

  function renderLoading(dir) {
    const root = roots[dir], st = state[dir];
    root.innerHTML = `<div class="rd-loading"><div class="brush"><span>${DIRS[dir].jp[0]}</span></div>
      <h2 data-label></h2><p class="lead" data-info></p>
      <p class="muted small">Cela prend généralement de 10 secondes à une minute.</p></div>`;
    updateLoading(dir);
  }
  function updateLoading(dir) {
    const st = state[dir], root = roots[dir];
    if (!st.loading || !root) return;
    const l = $('[data-label]', root), i = $('[data-info]', root);
    if (!l) return;
    l.textContent = st.loading.label + '…';
    const s = Math.round((Date.now() - st.loading.started) / 1000);
    i.innerHTML = `<span class="muted">${s} s${st.loading.chars ? ` · ${st.loading.chars.toLocaleString('fr-FR')} caractères reçus` : ''}</span>`;
  }

  /* ---------- Exercice ---------- */
  // État d'une phrase : à faire → révélée (réponse validée, solution visible) → notée (par l'apprenant)
  function openExercise(dir, ex) {
    const st = state[dir];
    st.ex = ex;
    const todo = ex.sentences.findIndex((_, i) => !ex.results[i]);
    st.mode = todo < 0 ? 'summary' : 'exercise';
    st.idx = todo < 0 ? 0 : todo;
    st.animate = true;
    render(dir);
  }

  function dotsHtml(ex, current) {
    return `<div class="tr-dots">${ex.sentences.map((_, i) => {
      const r = ex.results[i];
      const cls = r ? VERDICTS[r.verdict].cls : ex.answers[i] ? 'answered' : '';
      return `<span class="tr-dot ${cls} ${i === current ? 'cur' : ''}" title="Phrase ${i + 1}"></span>`;
    }).join('')}</div>`;
  }

  function hintsFor(dir, s) {
    const words = s.target_ids.map(id => S.get(id)).filter(Boolean);
    const list = (f) => words.length ? words.map(f).join('<span class="sep">・</span>') : '<span class="muted">—</span>';
    return dir === 'fr2jp' ? [
      { label: 'Lecture des mots à employer', html: list(c => `<span class="jp">${esc(c.reading || c.word)}</span>`) },
      { label: 'Mots à employer', html: list(c => `<span class="jp hint-word">${esc(c.word)}</span> <span class="muted">${esc(c.meaning)}</span>`) },
      { label: 'Structure', html: esc(s.hint_fr || 'Pas d\'indice de structure pour cette phrase.') },
    ] : [
      { label: 'Lecture des mots de la liste', html: list(c => `<span class="jp hint-word">${esc(c.word)}</span> <span class="jp muted">${esc(c.reading)}</span>`) },
      { label: 'Sens de ces mots', html: list(c => `<span class="jp hint-word">${esc(c.word)}</span> ${esc(c.meaning)}`) },
      { label: 'Structure', html: esc(s.hint_fr || 'Pas d\'indice de structure pour cette phrase.') },
    ];
  }

  /** Mots de la liste présents dans la réponse japonaise (contrôle local, sans IA) */
  function wordsInAnswer(s, text) {
    return s.target_ids.map(id => S.get(id)).filter(Boolean).map(c => {
      if (!text) return { c, ok: false };
      const forms = R.wordForms(c).filter(f => f !== c.reading || c.reading === c.word);
      if (forms.some(f => text.includes(f))) return { c, ok: true };
      if (c.reading && c.reading !== c.word && text.includes(c.reading)) return { c, ok: true, kana: true };
      return { c, ok: false };
    });
  }

  function renderExercise(dir) {
    const st = state[dir], ex = st.ex, root = roots[dir], D = DIRS[dir];
    const i = st.idx, s = ex.sentences[i], a = ex.answers[i];
    const revealed = !!a;
    const hintsShown = ex.hints[i] || 0;
    const hints = hintsFor(dir, s);
    const source = dir === 'fr2jp'
      ? `<div class="tr-source fr">${esc(s.source)}</div>`
      : `<div class="tr-source jp">${renderJP(s.source, { readings: hintsShown >= 1 || revealed, reveal: revealed })}</div>`;

    root.innerHTML = `<div class="tr-wrap">
      <div class="tr-top">
        <button class="btn ghost" data-act="back">← Nouvel exercice</button>
        ${dotsHtml(ex, i)}
        <span class="session-count">Phrase ${i + 1} / ${ex.sentences.length}</span>
      </div>
      <article class="card tr-card">
        <div class="tr-instr">${D.instr}</div>
        ${source}
        ${hintsShown && !revealed ? `<div class="tr-hints">${hints.slice(0, hintsShown).map(h => `<div class="tr-hint"><span class="tr-hint-label">${esc(h.label)}</span><span>${h.html}</span></div>`).join('')}</div>` : ''}
        ${revealed ? '' : `<textarea class="input tr-answer ${D.answerLang === 'ja' ? 'jp' : ''}" lang="${D.answerLang}" rows="2" placeholder="${D.placeholder}" spellcheck="${D.answerLang === 'fr'}">${esc(st.draft || '')}</textarea>
        <div class="tr-actions">
          <button class="btn ghost" data-act="hint" ${hintsShown >= hints.length ? 'disabled' : ''}>💡 Indice${hintsShown < hints.length ? ` (${hints.length - hintsShown})` : ''}</button>
          <button class="btn ghost" data-act="skip">Je ne sais pas</button>
          <span class="spacer"></span>
          <button class="btn primary" data-act="check">Valider <kbd>Entrée</kbd></button>
        </div>`}
      </article>
      ${revealed ? `<div class="tr-feedback" data-feedback>${revealHtml(dir, ex, i)}</div>
        <div class="self-grade">
          <span class="self-q">Votre traduction était…</span>
          ${['incorrect', 'presque', 'correct'].map(v => `<button class="sg-btn ${VERDICTS[v].cls}" data-grade="${v}"><b>${VERDICTS[v].label}</b><kbd>${VERDICTS[v].key}</kbd></button>`).join('')}
        </div>` : ''}
    </div>`;

    wireExercise(dir);
    if (revealed) {
      wireFeedback(dir, $('[data-feedback]', root), i);
      if (st.justRevealed) { st.justRevealed = false; Motion.stagger(root, '.tr-feedback > *, .self-grade', { step: 55 }); }
    }
    if (st.animate) { st.animate = false; Motion.stagger(root, '.tr-top, .tr-card', { step: 50 }); }
    const ta = $('.tr-answer', root);
    if (ta) setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
  }

  function wireExercise(dir) {
    const st = state[dir], ex = st.ex, root = roots[dir];
    const ta = $('.tr-answer', root);
    if (ta) {
      ta.addEventListener('input', () => { st.draft = ta.value; autoGrow(ta); });
      autoGrow(ta);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); reveal(dir, false); }
      });
    }
    root.querySelector('.tr-wrap').onclick = (e) => {
      const g = e.target.closest('[data-grade]');
      if (g) return grade(dir, g.dataset.grade);
      const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'back') { st.mode = 'setup'; st.ex = null; st.targets = null; st.draft = ''; st.animate = true; render(dir); }
      else if (act === 'hint') { ex.hints[st.idx] = (ex.hints[st.idx] || 0) + 1; S.save(); renderExercise(dir); Motion.fadeIn($('.tr-hint:last-child', root)); }
      else if (act === 'skip') reveal(dir, true);
      else if (act === 'check') reveal(dir, false);
    };
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(220, ta.scrollHeight + 2) + 'px'; }

  /** Valide la réponse : la solution apparaît, aucune requête à l'IA */
  function reveal(dir, skipped) {
    const st = state[dir], ex = st.ex, root = roots[dir], i = st.idx;
    const ta = $('.tr-answer', root);
    const text = skipped ? '' : (ta ? ta.value.trim() : '');
    if (!skipped && !text) { toast('Écrivez votre traduction, ou choisissez « Je ne sais pas »'); return; }
    ex.answers[i] = { text, skipped: !!skipped, hints: ex.hints[i] || 0 };
    st.draft = '';
    S.save();
    const card = $('.tr-card', root);
    const h0 = card ? card.offsetHeight : 0;
    st.justRevealed = true;
    renderExercise(dir);
    if (h0) Motion.growFrom($('.tr-card', root), h0);
    // aucun bouton pré-sélectionné : la note se donne avec 1 / 2 / 3 ou un clic, jamais avec Entrée par mégarde
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /** Autonotation : enregistre et passe à la phrase suivante */
  async function grade(dir, verdict) {
    const st = state[dir], ex = st.ex, root = roots[dir], i = st.idx;
    if (!ex.answers[i] || st.grading) return;
    st.grading = true;
    ex.results[i] = { verdict, score: VERDICTS[verdict].score, self: true };
    if (ex.sentences.every((_, k) => ex.results[k])) ex.done = true;
    S.save();
    const wrap = $('.tr-wrap', root);
    const btn = $(`[data-grade="${verdict}"]`, root);
    if (btn) btn.classList.add('chosen');
    const color = { correct: 'var(--ok)', presque: 'var(--g2)', incorrect: 'var(--accent)' }[verdict];
    const anim = Motion.exit($('.tr-card', root), [{ boxShadow: `0 0 0 0 ${color}`, opacity: 1, transform: 'none' }, { boxShadow: `0 0 0 4px ${color}`, opacity: 0, transform: 'translateX(-30px)' }], 170);
    if (wrap && Motion.ok()) wrap.querySelectorAll('.tr-feedback, .self-grade').forEach(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }));
    if (anim) await anim.finished.catch(() => {});
    st.grading = false;
    const next = ex.sentences.findIndex((_, k) => k > i && !ex.results[k]);
    const any = next >= 0 ? next : ex.sentences.findIndex((_, k) => !ex.results[k]);
    if (any < 0) { st.mode = 'summary'; st.animate = true; return render(dir); }
    st.idx = any;
    renderExercise(dir);
    const c2 = $('.tr-card', root);
    if (c2 && Motion.ok()) c2.classList.add('card-in');
  }

  // touches 1 / 2 / 3 pour se noter, hors des champs de saisie
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (!$('#modal').hidden) return;
    for (const dir of Object.keys(DIRS)) {
      const st = state[dir], root = roots[dir];
      if (!root || !root.classList.contains('active') || st.mode !== 'exercise' || !st.ex) continue;
      if (!st.ex.answers[st.idx] || st.ex.results[st.idx]) continue;
      const v = Object.keys(VERDICTS).find(k => VERDICTS[k].key === e.key);
      if (v) { e.preventDefault(); grade(dir, v); }
      else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); }
    }
  });

  /* ---------- Solution à comparer (et détail du bilan) ---------- */
  function revealHtml(dir, ex, i, withVerdict) {
    const s = ex.sentences[i], a = ex.answers[i] || { text: '' }, r = ex.results[i];
    const lang = dir === 'fr2jp' ? 'ja' : 'fr';
    const ref = dir === 'fr2jp'
      ? `<div class="fb-ref jp">${renderJP(s.reference, { readings: true, reveal: true })}</div>${s.reference_kana ? `<div class="fb-kana jp">${esc(s.reference_kana)}</div>` : ''}`
      : `<div class="fb-ref">${esc(s.reference)}</div>`;
    const alts = s.alternatives && s.alternatives.length ? s.alternatives : (r && r.alternatives) || [];
    const words = dir === 'fr2jp' ? wordsInAnswer(s, a.text) : s.target_ids.map(id => S.get(id)).filter(Boolean).map(c => ({ c, ok: null }));
    const chat = ex.chats[i] || [];
    const legacy = r && !r.self && r.errors; // ancien exercice corrigé par l'IA
    return `${withVerdict && r ? `<div class="fb-head ${VERDICTS[r.verdict].cls}"><span class="fb-verdict"><b>${VERDICTS[r.verdict].label}</b> <span class="jp">${VERDICTS[r.verdict].jp}</span></span>
        ${a.hints ? `<span class="muted small">${a.hints} indice${a.hints > 1 ? 's' : ''}</span>` : ''}</div>` : ''}
      <div class="fb-compare">
        <div class="fb-block"><div class="fb-label">Votre réponse${a.hints && !withVerdict ? ` · ${a.hints} indice${a.hints > 1 ? 's' : ''}` : ''}</div>
          ${a.text ? `<div class="fb-mine ${lang === 'ja' ? 'jp' : ''}">${legacy && r.corrected && r.corrected !== a.text ? diffHTML(a.text, r.corrected, lang) : esc(a.text)}</div>` : '<div class="muted">Pas de réponse</div>'}
          ${dir === 'fr2jp' && words.length && a.text ? `<div class="fb-check">${words.map(w => `<span class="fb-word ${w.kana ? 'kana' : w.ok ? 'ok' : 'ko'}"><span class="jp">${esc(w.c.word)}</span> ${w.kana ? '✓ écrit en kana' : w.ok ? '✓ employé' : '✕ absent'}</span>`).join('')}</div>` : ''}
        </div>
        <div class="fb-block fb-solution"><div class="fb-label">Solution</div>${ref}
          ${alts.length ? `<div class="fb-alts"><span class="fb-label">Aussi possible</span>${alts.map(x => `<div class="${lang === 'ja' ? 'jp' : ''}">${dir === 'fr2jp' ? renderJP(x, { readings: true }) : esc(x)}</div>`).join('')}</div>` : ''}
        </div>
      </div>
      ${s.notes_fr ? `<div class="fb-block fb-comment"><span class="fb-label">À retenir</span>${esc(s.notes_fr)}</div>` : ''}
      ${legacy && r.errors.length ? `<div class="fb-block"><div class="fb-label">Erreurs relevées</div><ul class="fb-errors">${r.errors.map(e => `<li>${e.extrait ? `<span class="fb-x">${esc(e.extrait)}</span>` : ''}${e.correction ? ` → <span class="fb-c">${esc(e.correction)}</span>` : ''}<div class="fb-expl">${esc(e.explication_fr)}</div></li>`).join('')}</ul></div>` : ''}
      ${words.length ? `<div class="fb-block"><div class="fb-label">Mots de votre liste</div><div class="fb-words">${words.map(w =>
        `<button class="fb-word" data-card="${w.c.id}" title="Ouvrir la carte"><span class="jp">${esc(w.c.word)}</span> <span class="muted jp">${esc(w.c.reading)}</span> <span class="muted">${esc(w.c.meaning)}</span></button>`).join('')}</div></div>` : ''}
      <details class="fb-block fb-ask" ${chat.length ? 'open' : ''}><summary class="fb-label">Une question ? Demander à l'IA</summary>
        <div class="fb-chat">${chat.map(m => m.role === 'user' ? `<div class="msg user">${esc(m.text)}</div>` : `<div class="msg bot ${m.error ? 'err' : ''}">${m.error ? esc(m.text) : R.md(m.text)}</div>`).join('')}</div>
        <div class="ask-input"><textarea class="input" rows="1" data-ask placeholder="ex. Ma version avec が au lieu de は est-elle correcte ?"></textarea><button class="btn" data-act-ask>Demander</button></div>
      </details>`;
  }

  function wireFeedback(dir, fb, i) {
    fb.onclick = (e) => {
      const w = e.target.closest('[data-card]'); if (w) return window.App.openEditor(+w.dataset.card);
      if (e.target.closest('[data-act-ask]')) { const t = $('[data-ask]', fb); const q = t.value.trim(); if (q) { t.value = ''; askAbout(dir, i, fb, q); } }
    };
    const t = $('[data-ask]', fb);
    if (t) t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); const q = t.value.trim(); if (q) { t.value = ''; askAbout(dir, i, fb, q); } }
    });
  }

  async function askAbout(dir, i, fb, question) {
    const ex = state[dir].ex, s = ex.sentences[i], a = ex.answers[i] || {};
    ex.chats[i] = ex.chats[i] || [];
    const history = ex.chats[i].filter(m => !m.error).slice(-6);
    ex.chats[i].push({ role: 'user', text: question });
    const ans = { role: 'assistant', text: '' };
    ex.chats[i].push(ans);
    const box = $('.fb-chat', fb);
    box.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(question)}</div><div class="msg bot"><span class="typing"><i></i><i></i><i></i></span></div>`);
    const bubble = box.lastElementChild;
    const system = `Tu es un tuteur de japonais pour un apprenant francophone de niveau JLPT ${ex.prefs.level}. Réponds en français, de façon concise (150 mots environ), avec **gras** et listes « - » si utile. Cite le japonais avec sa lecture.
Exercice de ${DIRS[dir].exo}.
Phrase à traduire : ${dir === 'fr2jp' ? s.source : plainJP(s.source)}
Solution : ${dir === 'fr2jp' ? plainJP(s.reference) : s.reference}
Réponse de l'apprenant : ${a.text || '(aucune)'}`;
    const messages = history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })).concat([{ role: 'user', content: question }]);
    const res = await ai({ system, messages, maxTokens: maxTokens(1200), cache: true, cacheKey: `kotoba-exercice-${ex.id}-${i}` }, (pg) => {
      if (pg.textDelta) { ans.text += pg.textDelta; bubble.innerHTML = R.md(ans.text); }
    });
    if (res.error) { ans.text = res.error; ans.error = true; bubble.className = 'msg bot err'; bubble.textContent = res.error; }
    else { ans.text = res.text || ans.text || 'Réponse vide.'; ans.cached = !!res.cached; bubble.innerHTML = R.md(ans.text) + (res.cached ? R.cacheTag() : ''); }
    S.save();
  }

  /* ---------- Bilan ---------- */
  function avgScore(ex) {
    const rs = Object.values(ex.results || {});
    if (!rs.length) return null;
    return Math.round(rs.reduce((t, r) => t + (r.score || 0), 0) / ex.sentences.length);
  }

  function renderSummary(dir) {
    const st = state[dir], ex = st.ex, root = roots[dir];
    const avg = avgScore(ex) || 0;
    const counts = { correct: 0, presque: 0, incorrect: 0 };
    ex.sentences.forEach((_, i) => { const r = ex.results[i]; if (r) counts[r.verdict]++; });
    const toRedo = ex.sentences.map((_, i) => i).filter(i => !ex.results[i] || ex.results[i].verdict !== 'correct');
    root.innerHTML = `<div class="tr-wrap">
      <div class="tr-top"><button class="btn ghost" data-act="back">← Nouvel exercice</button>${dotsHtml(ex, -1)}<span></span></div>
      <div class="summary tr-summary">
        <div class="done-mark">${avg >= 80 ? '素晴らしい' : avg >= 50 ? 'お疲れ様' : '頑張って'}</div>
        <h1>Exercice terminé</h1>
        <p class="lead">${counts.correct} phrase${counts.correct > 1 ? 's' : ''} juste${counts.correct > 1 ? 's' : ''} sur ${ex.sentences.length}</p>
        <div class="counters">
          <div class="counter"><b>${counts.correct}</b><span>justes</span></div>
          <div class="counter"><b>${counts.presque}</b><span>presque</span></div>
          <div class="counter ${counts.incorrect ? 'hot' : ''}"><b>${counts.incorrect}</b><span>fausses</span></div>
        </div>
        <div class="home-actions">
          ${toRedo.length ? `<button class="btn primary big" data-act="redo">Refaire les ${toRedo.length} phrase${toRedo.length > 1 ? 's' : ''} à revoir</button>` : ''}
          <button class="btn big ${toRedo.length ? '' : 'primary'}" data-act="new">Nouvel exercice</button>
        </div>
      </div>
      <div class="tr-list">${ex.sentences.map((s, i) => {
        const r = ex.results[i], V = r ? VERDICTS[r.verdict] : null;
        return `<details class="tr-item" data-i="${i}">
          <summary><span class="tr-dot ${V ? V.cls : ''}"></span>
            <span class="tr-item-src ${dir === 'jp2fr' ? 'jp' : ''}">${dir === 'fr2jp' ? esc(s.source) : renderJP(s.source)}</span>
            <span class="tr-item-score">${V ? V.label : '—'}</span></summary>
          <div class="tr-feedback" data-feedback="${i}">${revealHtml(dir, ex, i, true)}</div>
        </details>`;
      }).join('')}</div>
    </div>`;
    $$('.tr-item', root).forEach(d => {
      const i = +d.dataset.i, fb = $('[data-feedback]', d);
      wireFeedback(dir, fb, i);
      d.addEventListener('toggle', () => { if (d.open) Motion.stagger(fb, '.fb-head, .fb-block, .fb-compare', { step: 40 }); });
    });
    root.querySelector('.tr-wrap').onclick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'back' || b.dataset.act === 'new') { st.mode = 'setup'; st.ex = null; st.targets = null; st.animate = true; render(dir); }
      if (b.dataset.act === 'redo') {
        const sub = {
          id: Date.now(), dir, day: S.today(), created: Date.now(), prefs: ex.prefs, targets: ex.targets,
          sentences: toRedo.map(i => ex.sentences[i]), answers: {}, results: {}, chats: {}, hints: {}, done: false,
        };
        exercises().push(sub); S.save(); openExercise(dir, sub);
      }
    };
    if (st.animate) {
      st.animate = false;
      Motion.stagger(root, '.counter, .home-actions .btn, .tr-item', { step: 40, delay: 200 });
      Motion.countUp(root, '.counter b', 700);
    }
  }

  window.Translate = { render, DIRS, _diff: diffHTML };
})();
