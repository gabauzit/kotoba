/* =====================================================================
   文法 Grammaire — structures grammaticales, séparées du vocabulaire
   - Ajout / liste / modification des structures
   - Révision FSRS (données et historique propres)
   - Phrases d'exemple générées par l'IA : la traduction est cachée,
     l'apprenant traduit mentalement puis dit s'il a compris.
   ===================================================================== */
(function () {
  'use strict';
  const S = window.Store;
  const { NEW, LEARNING, REVIEW, RELEARNING } = window.FSRSLib;
  const API = window.kotobaAPI;
  const Motion = window.Motion;
  const R = () => window.Reading;
  const App = () => window.App;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const toast = (...a) => App().toast(...a);
  const touch = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const MASTERED_S = 21;

  /* =====================================================================
     Données
     ===================================================================== */
  const G = {
    data() {
      if (!S.data.grammar || typeof S.data.grammar !== 'object') S.data.grammar = {};
      const g = S.data.grammar;
      if (!Array.isArray(g.items)) g.items = [];
      if (!Array.isArray(g.logs)) g.logs = [];
      if (!g.nextId) g.nextId = g.items.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      for (const x of g.items) {
        if (x.description) {
          const lines = String(x.description).split(/\r?\n/).map(l => l.replace(/^\s*[·•・\-*]\s*/, '').trim()).filter(Boolean);
          x.usage = lines.concat((x.usage || []).filter(u => !lines.includes(u)));
          delete x.description;
        }
        if (!Array.isArray(x.usage)) x.usage = [];
        if (!Array.isArray(x.examples)) x.examples = [];
      }
      return g;
    },
    items() { return this.data().items; },
    get(id) { return this.items().find(x => x.id === id); },
    settings() {
      const s = S.data.settings;
      return {
        newPerDay: s.grammarNewPerDay ?? 5,
        studyNew: s.grammarStudyNew !== false,
        ai: s.grammarAI !== false,
        furigana: s.grammarFurigana !== false,
      };
    },
    blank() { return { state: NEW, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastDay: null, dueDay: null }; },
    clean(f) {
      return {
        ref: String(f.ref || '').trim(),
        title: String(f.title || '').trim(),
        usage: (f.usage || []).map(x => String(x).trim()).filter(Boolean), // lignes « · » de la Structure
        meaning: String(f.meaning || '').trim(),                                // Signification
        examples: (f.examples || []).map(e => ({ jp: String(e.jp || '').trim(), fr: String(e.fr || '').trim() })).filter(e => e.jp),
      };
    },
    add(f) {
      const today = S.today();
      if (S.data.startDay == null) S.data.startDay = today;
      const d = this.data();
      const item = Object.assign({ id: d.nextId++, created: Date.now(), createdDay: today, fsrs: this.blank(), seen: [] }, this.clean(f));
      d.items.push(item);
      S.save();
      return item;
    },
    update(id, f) { const x = this.get(id); if (!x) return; Object.assign(x, this.clean(f)); S.save(); },
    remove(id) { const d = this.data(); d.items = d.items.filter(x => x.id !== id); d.logs = d.logs.filter(l => l.id !== id); S.save(); },
    reset(id) { const x = this.get(id); if (x) { x.fsrs = this.blank(); S.save(); } },
    duplicate(title, exceptId) { const t = title.trim(); return t && this.items().find(x => x.title === t && x.id !== exceptId); },
    refs() { return [...new Set(this.items().map(x => x.ref).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })); },

    category(x) {
      const s = x.fsrs.state;
      if (s === NEW) return 'new';
      if (s === LEARNING || s === RELEARNING) return 'learning';
      return x.fsrs.stability >= MASTERED_S ? 'mastered' : 'young';
    },
    isDifficult(x) {
      const f = x.fsrs;
      return f.state !== NEW && (f.lapses >= S.data.settings.leechThreshold || (f.difficulty >= 8 && f.reps >= 3));
    },
    recall(x) { return x.fsrs.state === NEW ? null : S.fsrs.retrievability(S.today() - x.fsrs.lastDay, x.fsrs.stability); },
    dueIn(x) { return x.fsrs.state === NEW || x.fsrs.dueDay == null ? null : x.fsrs.dueDay - S.today(); },

    due() { const t = S.today(); return this.items().filter(x => x.fsrs.state !== NEW && x.fsrs.dueDay != null && x.fsrs.dueDay <= t); },
    introducedToday() { const t = S.today(); return new Set(this.data().logs.filter(l => l.day === t && l.st === NEW).map(l => l.id)).size; },
    newForToday() {
      const left = Math.max(0, this.settings().newPerDay - this.introducedToday());
      return this.items().filter(x => x.fsrs.state === NEW).sort((a, b) => a.created - b.created).slice(0, left);
    },
    counts() {
      const due = this.due();
      return {
        review: due.filter(x => x.fsrs.state === REVIEW).length,
        learning: due.filter(x => x.fsrs.state !== REVIEW).length,
        newCards: this.newForToday().length,
        newTotal: this.items().filter(x => x.fsrs.state === NEW).length,
        total: this.items().length,
      };
    },
    buildSession() {
      const due = this.due().sort((a, b) => {
        const la = a.fsrs.state !== REVIEW ? 0 : 1, lb = b.fsrs.state !== REVIEW ? 0 : 1;
        return la !== lb ? la - lb : (this.recall(a) ?? 0) - (this.recall(b) ?? 0);
      });
      const news = this.newForToday();
      const q = [];
      let r = 0, n = 0;
      while (r < due.length || n < news.length) {
        for (let k = 0; k < 3 && r < due.length; k++) q.push(due[r++].id);
        if (n < news.length) q.push(news[n++].id);
      }
      return q;
    },
    preview(x) { return S.fsrs.preview(x.fsrs, S.today(), x.id * 37 + x.fsrs.reps); },
    grade(id, g) {
      const x = this.get(id), today = S.today();
      const before = JSON.parse(JSON.stringify(x.fsrs));
      const res = S.fsrs.review(x.fsrs, g, today, x.id * 37 + x.fsrs.reps);
      res.card.dueDay = today + res.interval;
      x.fsrs = res.card;
      const logs = this.data().logs;
      logs.push({ id, day: today, t: Date.now(), g, st: before.state, S: +res.card.stability.toFixed(4), D: +res.card.difficulty.toFixed(4), ivl: res.interval });
      S.save();
      return {
        interval: res.interval,
        undo: () => { x.fsrs = before; const i = logs.map(l => l.id).lastIndexOf(id); if (i >= 0) logs.splice(i, 1); S.save(); },
      };
    },
    remember(id, sentence) {
      const x = this.get(id); if (!x || !sentence) return;
      x.seen = (x.seen || []).filter(s => s.jp !== sentence.jp);
      x.seen.unshift({ jp: sentence.jp, fr: sentence.fr });
      x.seen = x.seen.slice(0, 8);
      S.save();
    },
  };

  /* =====================================================================
     Affichage commun
     ===================================================================== */
  const catLabel = { new: 'Nouvelle', learning: 'Apprentissage', young: 'Jeune', mastered: 'Maîtrisée' };
  function fmtIvl(d) {
    if (d === 0) return 'dans la séance';
    if (d === 1) return '1 jour';
    if (d < 31) return `${d} jours`;
    if (d < 365) return `${Math.round(d / 30.4)} mois`;
    const y = d / 365; return `${y < 10 ? y.toFixed(1).replace('.', ',') : Math.round(y)} an${y >= 2 ? 's' : ''}`;
  }
  function fmtDue(d) {
    if (d == null) return '—';
    if (d < 0) return `en retard (${-d} j)`;
    if (d === 0) return "aujourd'hui";
    if (d === 1) return 'demain';
    return `dans ${d} j`;
  }

  /** Surligne dans un exemple le passage de la structure (titre sans 〜, ou son radical) */
  function exampleHl(jp, title) {
    const s = esc(jp);
    const cands = String(title || '').split(/[／/・、,\s]+/).map(t => t.replace(/[〜～~（）()]/g, '').trim()).filter(t => [...t].length >= 1);
    for (const c of cands) {
      const chars = [...c];
      for (let cut = 0; cut <= Math.min(2, chars.length - 2); cut++) {
        const stem = esc(chars.slice(0, chars.length - cut).join(''));
        if (stem && s.includes(stem)) return s.split(stem).join(`<mark>${stem}</mark>`);
      }
    }
    return s;
  }

  /** Corps d'une carte : référence en haut à gauche, titre, structure (lignes « · »), signification, exemples */
  function structureHtml(x, opts = {}) {
    const hide = opts.hide ? 'sw-hide' : '';
    const exs = x.examples || [];
    return `<div class="gs ${opts.compact ? 'compact' : ''}">
      ${opts.noRef ? '' : `<div class="gs-ref">${x.ref ? esc(x.ref) : '<span class="muted">Sans référence</span>'}</div>`}
      ${opts.noTitle ? '' : `<div class="gs-title">${esc(x.title) || '<span class="muted">Titre</span>'}</div>`}
      ${x.usage && x.usage.length ? `<ul class="gs-struct ${hide}">${x.usage.map(u => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}
      ${x.meaning ? `<div class="gs-meaning ${hide}">${esc(x.meaning)}</div>` : ''}
      ${exs.length ? `<ul class="gs-ex ${hide} ${opts.scroll ? 'scroll' : ''}" ${opts.scroll && exs.length > 2 ? `title="${exs.length} exemples : faites défiler"` : ''}>${exs.map(e => `<li><div class="jp">${exampleHl(e.jp, x.title)}</div>${e.fr ? `<div class="gs-ex-fr">${esc(e.fr)}</div>` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  /** Phrase japonaise avec furigana {漢字|よみ} et passage de la structure surligné */
  function sentenceHtml(s) {
    const { plain, pieces } = R()._parseMarkup(s.jp || '');
    let hs = -1, he = -1;
    if (s.highlight) {
      const h = R().stripMarkup(s.highlight);
      const i = plain.indexOf(h);
      if (i >= 0 && h.length) { hs = i; he = i + h.length; }
    }
    const inHl = (a, b) => hs >= 0 && a < he && b > hs;
    let html = '';
    for (const pc of pieces) {
      if (pc.type === 'text') {
        const cuts = [pc.s, ...[hs, he].filter(c => c > pc.s && c < pc.e), pc.e];
        for (let k = 0; k < cuts.length - 1; k++) {
          const a = cuts[k], b = cuts[k + 1], t = esc(pc.text.slice(a - pc.s, b - pc.s));
          html += inHl(a, b) ? `<mark class="g-hl">${t}</mark>` : t;
        }
      } else {
        const inner = pc.reading ? `<ruby>${esc(pc.text)}<rt>${esc(pc.reading)}</rt></ruby>` : esc(pc.text);
        html += inHl(pc.s, pc.e) ? `<mark class="g-hl">${inner}</mark>` : inner;
      }
    }
    return html;
  }

  /* =====================================================================
     Génération des phrases par l'IA (une requête par lot de structures)
     ===================================================================== */
  const SCHEMA = {
    type: 'object', required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object', required: ['id', 'sentences'],
          properties: {
            id: { type: 'integer' },
            sentences: {
              type: 'array',
              items: {
                type: 'object', required: ['jp', 'highlight', 'fr'],
                properties: {
                  jp: { type: 'string', description: 'Phrase japonaise, furigana {漢字|よみ} sur chaque mot écrit en kanji.' },
                  highlight: { type: 'string', description: 'Extrait EXACT de la phrase (sans balisage) qui correspond à la structure.' },
                  fr: { type: 'string', description: 'Traduction française naturelle.' },
                  note_fr: { type: 'string', description: 'Une phrase : comment la structure est employée ici.' },
                },
              },
            },
          },
        },
      },
    },
  };

  const aiModel = () => R().currentModel();
  const aiProvider = () => R().providerOf(aiModel());
  async function aiReady() { return !!(API && R() && G.settings().ai && (await API.aiKeyStatus(aiProvider())).hasKey); }

  async function fetchSentences(ids, perItem = 2) {
    const list = ids.map(id => G.get(id)).filter(Boolean).map(x => ({ id: x.id, reference: x.ref, titre: x.title, structure: x.usage, signification: x.meaning || '', exemples_de_l_apprenant: (x.examples || []).map(e => e.jp) }));
    if (!list.length) return {};
    // ordre stable (par ID) : le début de la requête reste identique → cache des services
    const vocab = S.data.cards.filter(c => c.fsrs.state !== 0).sort((a, b) => a.id - b.id).slice(0, 1500).map(c => c.word);
    const system = `Tu es un professeur de japonais. Pour chaque structure grammaticale fournie, écris le nombre de phrases d'exemple indiqué (PHRASES PAR STRUCTURE) pour un apprenant francophone, qui devra les traduire mentalement.
Ta réponse est uniquement l'objet JSON demandé, avec une entrée par structure (même "id").

EXIGENCES :
- Chaque phrase emploie clairement la structure, sous l'une des formes listées dans "structure" (varie les formes entre les phrases : verbe, nom, adjectif…), avec le sens décrit dans "signification".
- Ne recopie pas les exemples de l'apprenant : écris des phrases nouvelles.
- Niveau : déduis-le de la référence (ex. « N5 Leçon 5 » → JLPT N5) ; à défaut, phrases simples de niveau N4. Phrases courtes (10 à 30 caractères), naturelles, au contexte concret.
- Vocabulaire : emploie de préférence le vocabulaire déjà étudié par l'apprenant (liste fournie), sinon des mots simples et très courants.
- "jp" : furigana {漢字|よみ} sur CHAQUE mot écrit en kanji (ex. {学校|がっこう}へ{行|い}きたい). Aucun autre balisage.
- "highlight" : l'extrait exact de la phrase, sans balisage, qui réalise la structure (ex. 行きたい).
- "fr" : traduction française naturelle et fidèle.
- "note_fr" : en une phrase, comment la structure fonctionne dans cette phrase.`;
    const res = await API.aiMessage('gr-' + Date.now() + Math.random().toString(36).slice(2, 6), {
      provider: aiProvider(), model: aiModel(), system,
      maxTokens: aiProvider() === 'gemini' ? 32768 : Math.min(16000, 700 * list.length * perItem),
      json: { name: 'publier_phrases', description: 'Publie les phrases.', schema: SCHEMA },
      cacheKey: 'kotoba-grammaire',
      messages: [{ role: 'user', content: [
        { text: 'VOCABULAIRE DÉJÀ ÉTUDIÉ PAR L\'APPRENANT (à employer de préférence) :\n' + (vocab.join(' ') || '(aucun)'), cache: true },
        { text: `PHRASES PAR STRUCTURE : ${perItem}\nSTRUCTURES :\n` + JSON.stringify(list) },
      ] }],
    });
    if (res.error) throw new Error(res.error);
    const out = {};
    for (const it of ((res.json && res.json.items) || [])) {
      const id = Number(it.id);
      const sents = (Array.isArray(it.sentences) ? it.sentences : []).filter(s => s && s.jp && s.fr)
        .map(s => ({ jp: String(s.jp), highlight: String(s.highlight || ''), fr: String(s.fr), note_fr: String(s.note_fr || '') }));
      if (ids.includes(id) && sents.length) out[id] = sents;
    }
    if (!Object.keys(out).length) throw new Error(`Réponse illisible de ${R().aiName()}.`);
    return out;
  }

  /* =====================================================================
     État de l'onglet
     ===================================================================== */
  const st = { sub: 'review', session: null, list: { q: '', ref: '', sort: 'recent' }, draft: null, animate: false };
  let root = null;

  function newSession(queue, practice) {
    return {
      queue, practice, revealed: false, current: null, history: [], first: new Map(), shown: new Map(),
      undoStack: [], done: false, study: null, ai: false, sentences: new Map(), pending: new Set(), failed: new Set(), aiError: null,
    };
  }

  /* =====================================================================
     Rendu
     ===================================================================== */
  function render(el) {
    if (el) { root = el; st.animate = true; }
    if (!root) return;
    const c = G.counts();
    const due = c.review + c.learning;
    const head = `<div class="view-head g-head"><div><h1><span class="h-jp">文法</span>Grammaire</h1></div>
      <div class="seg g-tabs">
        <button data-sub="review" class="${st.sub === 'review' ? 'on' : ''}">Réviser${due + c.newCards ? ` <em>${due + c.newCards}</em>` : ''}</button>
        <button data-sub="list" class="${st.sub === 'list' ? 'on' : ''}">Structures${c.total ? ` <em>${c.total}</em>` : ''}</button>
        <button data-sub="add" class="${st.sub === 'add' ? 'on' : ''}">+ Ajouter</button>
      </div></div>`;
    const inSession = st.sub === 'review' && st.session && !st.session.done;
    root.innerHTML = (inSession ? '' : head) + '<div id="gBody"></div>';
    $$('.g-tabs button', root).forEach(b => b.onclick = () => { st.sub = b.dataset.sub; st.animate = true; render(); });
    const body = $('#gBody', root);
    if (st.sub === 'list') renderList(body);
    else if (st.sub === 'add') renderAdd(body);
    else renderReview(body);
    if (st.animate) {
      st.animate = false;
      Motion.stagger(root, '.g-head, .counter, .new-stepper, .g-ai-row, .home-actions .btn, .g-row, .g-form-wrap > *, .study-card', { step: 26, max: 30 });
      Motion.countUp(root, '.counter b');
    }
  }

  /* ---------- Formulaire (ajout et modification) ---------- */
  function formHtml(x = {}) {
    const usage = x.usage && x.usage.length ? x.usage : [''];
    return `<div class="field"><label for="gRef">Référence <span class="hint">affichée en haut à gauche de la carte, ex. « N5 Leçon 5 »</span></label>
        <input class="input" id="gRef" list="gRefList" value="${esc(x.ref)}" autocomplete="off" placeholder="N5 Leçon 5">
        <datalist id="gRefList">${G.refs().map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>
      <div class="field"><label for="gTitle">Titre</label>
        <input class="input jp-big" id="gTitle" value="${esc(x.title)}" autocomplete="off" lang="ja" placeholder="〜たい">
        <div class="warn" id="gDup" hidden></div></div>
      <div class="field"><label>Structure <span class="hint">une ligne « · » par forme (verbe, nom, adjectif…) ; Entrée ajoute une ligne</span></label>
        <div id="gUsage">${usage.map(usageRow).join('')}</div>
        <button class="btn ghost" type="button" id="gAddUsage">+ Ajouter une ligne</button></div>
      <div class="field"><label for="gMeaning">Signification</label>
        <textarea class="input" id="gMeaning" rows="3" placeholder="Sens, nuances, registre, pièges…">${esc(x.meaning)}</textarea></div>
      <div class="field"><label>Exemples <span class="hint">vos phrases ; le passage de la structure est surligné automatiquement</span></label>
        <div id="gEx">${(x.examples && x.examples.length ? x.examples : [{ jp: '', fr: '' }]).map(exampleRow).join('')}</div>
        <button class="btn ghost" type="button" id="gAddEx">+ Ajouter un exemple</button></div>`;
  }
  function exampleRow(e = { jp: '', fr: '' }) {
    return `<div class="ex-row g-ex-row"><input class="input jp g-ex-jp" placeholder="Phrase en japonais" value="${esc(e.jp)}" lang="ja">
      <input class="input g-ex-fr" placeholder="Traduction" value="${esc(e.fr)}"><button class="btn ghost g-ex-del" type="button" title="Retirer">✕</button></div>`;
  }
  function usageRow(v = '') {
    return `<div class="g-usage-row"><span class="g-dot">·</span><input class="input jp" value="${esc(v)}" placeholder="V（ます形）＋たい" lang="ja"><button class="btn ghost g-del" type="button" title="Retirer">✕</button></div>`;
  }
  function readForm(box) {
    return {
      ref: $('#gRef', box).value, title: $('#gTitle', box).value, meaning: $('#gMeaning', box).value,
      usage: $$('#gUsage input', box).map(i => i.value),
      examples: $$('#gEx .g-ex-row', box).map(r => ({ jp: $('.g-ex-jp', r).value, fr: $('.g-ex-fr', r).value })),
    };
  }
  function wireForm(box, exceptId, onChange) {
    const usage = $('#gUsage', box);
    const changed = () => onChange && onChange(readForm(box));
    const addRow = (after, value = '') => {
      const tmp = document.createElement('div'); tmp.innerHTML = usageRow(value);
      const row = tmp.firstElementChild;
      if (after) after.after(row); else usage.appendChild(row);
      Motion.fadeIn(row, 4, 160);
      $('input', row).focus();
      changed();
      return row;
    };
    $('#gAddUsage', box).onclick = () => addRow(null);
    const exBox = $('#gEx', box);
    $('#gAddEx', box).onclick = () => {
      exBox.insertAdjacentHTML('beforeend', exampleRow());
      const row = exBox.lastElementChild; Motion.fadeIn(row, 4, 160); $('.g-ex-jp', row).focus(); changed();
    };
    exBox.addEventListener('click', (e) => {
      const d = e.target.closest('.g-ex-del'); if (!d) return;
      const row = d.closest('.g-ex-row');
      if ($$('.g-ex-row', exBox).length > 1) row.remove(); else $$('input', row).forEach(i => i.value = '');
      changed();
    });
    usage.addEventListener('click', (e) => {
      const d = e.target.closest('.g-del'); if (!d) return;
      const row = d.closest('.g-usage-row');
      if ($$('.g-usage-row', usage).length > 1) row.remove(); else $('input', row).value = '';
      changed();
    });
    usage.addEventListener('keydown', (e) => {
      const input = e.target.closest('input'); if (!input) return;
      const row = input.closest('.g-usage-row');
      if (e.key === 'Enter' && !e.ctrlKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); addRow(row); }
      if (e.key === 'Backspace' && !input.value && $$('.g-usage-row', usage).length > 1) {
        e.preventDefault();
        const prev = row.previousElementSibling || row.nextElementSibling;
        row.remove(); changed();
        if (prev) { const i = $('input', prev); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
      }
    });
    // un collage de plusieurs lignes crée une ligne par usage
    usage.addEventListener('paste', (e) => {
      const input = e.target.closest('input'); if (!input) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const lines = text.split(/\r?\n/).map(l => l.replace(/^\s*[·•・\-*]\s*/, '').trim()).filter(Boolean);
      if (lines.length < 2) return;
      e.preventDefault();
      input.value = (input.value + lines[0]).trim();
      let row = input.closest('.g-usage-row');
      for (const l of lines.slice(1)) row = addRow(row, l);
      changed();
    });
    box.addEventListener('input', changed);
    const title = $('#gTitle', box), warn = $('#gDup', box);
    const check = () => {
      const d = G.duplicate(title.value, exceptId);
      warn.hidden = !d;
      if (d) warn.textContent = `Cette structure existe déjà${d.ref ? ` (${d.ref})` : ''}.`;
    };
    title.addEventListener('input', check); check();
  }

  function renderAdd(body) {
    const recent = G.items().slice().sort((a, b) => b.created - a.created).slice(0, 8);
    const draft = st.draft || { ref: (recent[0] && recent[0].ref) || '' };
    body.innerHTML = `<div class="g-form-wrap">
      <div class="form-card g-form" id="gAddForm">${formHtml(draft)}
        <div class="form-actions"><span class="muted small"><kbd>Ctrl</kbd> + <kbd>Entrée</kbd> pour ajouter</span><span class="spacer"></span>
          <button class="btn primary" id="gSave">Ajouter la structure</button></div></div>
      <div class="g-preview-col"><div class="fb-label">Aperçu de la carte</div><article class="g-card" id="gPreview">${structureHtml(G.clean(draft))}</article>
        ${recent.length ? `<div class="recent"><h3>Derniers ajouts</h3><div class="chips">${recent.map(x => `<div class="chip" data-id="${x.id}"><b>${esc(x.title)}</b><span>${esc(x.ref)}</span></div>`).join('')}</div></div>` : ''}</div>
    </div>`;
    const form = $('#gAddForm', body);
    wireForm(form, null, (f) => { st.draft = f; $('#gPreview', body).innerHTML = structureHtml(G.clean(f)); });
    const save = () => {
      const f = readForm(form);
      if (!f.title.trim()) { $('#gTitle', form).focus(); toast('Le titre est obligatoire'); return; }
      const x = G.add(f);
      st.draft = { ref: x.ref }; // la référence est gardée pour l'ajout suivant
      toast(`« ${x.title} » ajoutée`, { label: 'Annuler', fn: () => { G.remove(x.id); render(); App().renderChrome(); } });
      App().renderChrome();
      render();
      setTimeout(() => $('#gTitle') && $('#gTitle').focus(), 0);
    };
    $('#gSave', body).onclick = save;
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save(); } });
    $$('.chip[data-id]', body).forEach(ch => ch.onclick = () => openEditor(+ch.dataset.id));
    if (!touch()) setTimeout(() => { const t = $('#gTitle', body); if (t && !t.value) t.focus(); }, 0);
  }

  /* ---------- Modification (fenêtre) ---------- */
  function openEditor(id) {
    const x = G.get(id); if (!x) return;
    const f = x.fsrs, cat = G.category(x), Rc = G.recall(x);
    const box = App().openModal(`<h2>Modifier « ${esc(x.title)} »</h2>
      <div class="modal-cols">
        <div class="form-card" id="gEditForm">${formHtml(x)}</div>
        <aside class="card-meta"><h4>Mémoire de cette structure</h4>
          <dl>
            <dt>État</dt><dd><span class="pill ${cat}">${catLabel[cat]}</span></dd>
            ${G.isDifficult(x) ? '<dt>Statut</dt><dd style="color:var(--accent)">Difficile</dd>' : ''}
            <dt>Ajoutée</dt><dd>jour ${S.dayNumber(x.createdDay)}</dd>
            <dt>Révisions</dt><dd>${f.reps}</dd>
            <dt>Oublis</dt><dd>${f.lapses}</dd>
            <dt>Rappel actuel</dt><dd>${Rc == null ? '—' : Math.round(Rc * 100) + ' %'}</dd>
            <dt>Prochaine</dt><dd>${fmtDue(G.dueIn(x))}</dd>
          </dl>
          ${x.seen && x.seen.length ? `<h4 style="margin-top:14px">Phrases déjà vues</h4><ul class="g-seen">${x.seen.slice(0, 4).map(s => `<li><div class="jp">${sentenceHtml({ jp: s.jp })}</div><div class="muted">${esc(s.fr)}</div></li>`).join('')}</ul>` : ''}
          <div class="meta-actions">
            <button class="btn" id="gReset" ${f.state === NEW ? 'disabled' : ''}>Réapprendre de zéro</button>
            <button class="btn danger" id="gDelete">Supprimer la structure</button>
          </div>
        </aside>
      </div>
      <div class="form-actions" style="margin-top:16px"><span class="spacer"></span>
        <button class="btn ghost" id="gCancel">Annuler <kbd>Échap</kbd></button>
        <button class="btn primary" id="gEditSave">Enregistrer <kbd>Ctrl+Entrée</kbd></button></div>`);
    const form = $('#gEditForm', box);
    wireForm(form, id);
    const save = () => {
      const d = readForm(form);
      if (!d.title.trim()) { toast('Le titre est obligatoire'); return; }
      G.update(id, d); App().closeModal(); toast('Modifications enregistrées'); render();
    };
    $('#gEditSave', box).onclick = save;
    $('#gCancel', box).onclick = App().closeModal;
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save(); } });
    $('#gReset', box).onclick = async () => {
      if (await App().confirmBox('Réapprendre cette structure ?', 'Sa progression sera remise à zéro.', 'Réinitialiser')) { G.reset(id); toast('La structure redevient nouvelle'); render(); App().renderChrome(); }
      else openEditor(id);
    };
    $('#gDelete', box).onclick = async () => {
      if (await App().confirmBox('Supprimer cette structure ?', `« ${x.title} » et son historique seront supprimés.`, 'Supprimer')) {
        if (st.session) st.session.queue = st.session.queue.filter(q => q !== id);
        G.remove(id); toast('Structure supprimée'); render(); App().renderChrome();
      } else openEditor(id);
    };
    if (!touch()) setTimeout(() => $('#gTitle', box).focus(), 0);
  }

  /* ---------- Liste ---------- */
  function renderList(body) {
    if (!G.items().length) {
      body.innerHTML = `<div class="empty"><div class="empty-kanji">文法</div><p>Aucune structure pour l'instant.</p><button class="btn primary" id="gGoAdd">Ajouter une structure</button></div>`;
      $('#gGoAdd', body).onclick = () => { st.sub = 'add'; render(); };
      return;
    }
    const L = st.list;
    body.innerHTML = `<div class="toolbar">
        <input class="input search" id="gSearch" placeholder="Rechercher (titre, structure, signification, exemples)…" value="${esc(L.q)}">
        <select class="select" id="gRefFilter"><option value="">Toutes les références</option>${G.refs().map(r => `<option value="${esc(r)}" ${L.ref === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        <select class="select" id="gSort">
          <option value="recent">Ajout le plus récent</option><option value="ref">Par référence</option>
          <option value="due">Prochaine révision</option><option value="difficulty">Plus difficiles</option>
        </select></div>
      <div id="gList"></div>`;
    $('#gSort', body).value = L.sort;
    const draw = () => {
      const q = L.q.trim().toLowerCase();
      let xs = G.items().filter(x => (!L.ref || x.ref === L.ref) && (!q || [x.title, x.ref, x.meaning || '', ...(x.usage || []), ...(x.examples || []).map(e => e.jp + ' ' + e.fr)].join(' ').toLowerCase().includes(q)));
      const due = (x) => x.fsrs.dueDay == null ? Infinity : x.fsrs.dueDay;
      const sorts = {
        recent: (a, b) => b.created - a.created,
        ref: (a, b) => (a.ref || '￿').localeCompare(b.ref || '￿', 'fr', { numeric: true }) || a.created - b.created,
        due: (a, b) => due(a) - due(b),
        difficulty: (a, b) => (b.fsrs.difficulty + b.fsrs.lapses) - (a.fsrs.difficulty + a.fsrs.lapses),
      };
      xs.sort(sorts[L.sort]);
      $('#gList', body).innerHTML = xs.length ? `<div class="g-grid">${xs.map(x => {
        const cat = G.category(x);
        return `<article class="g-card g-row" data-id="${x.id}">${structureHtml(x, { compact: true, scroll: true })}
          <div class="g-row-foot"><span class="pill ${cat} ${G.isDifficult(x) ? 'hard' : ''}">${G.isDifficult(x) ? 'Difficile' : catLabel[cat]}</span>
          <span class="muted small">${x.fsrs.state === NEW ? '' : fmtDue(G.dueIn(x))}</span></div></article>`;
      }).join('')}</div>` : '<div class="empty" style="padding:6vh 0"><p>Aucune structure ne correspond.</p></div>';
      $$('.g-row', body).forEach(r => r.onclick = () => openEditor(+r.dataset.id));
    };
    $('#gSearch', body).oninput = (e) => { L.q = e.target.value; draw(); };
    $('#gRefFilter', body).onchange = (e) => { L.ref = e.target.value; draw(); };
    $('#gSort', body).onchange = (e) => { L.sort = e.target.value; draw(); };
    draw();
  }

  /* ---------- Révision : accueil ---------- */
  async function renderReview(body) {
    const s = st.session;
    if (s && s.study) return renderStudy(body);
    if (s && !s.done) return renderCard(body);
    if (s && s.done) return renderSummary(body);
    const c = G.counts(), set = G.settings();
    if (!c.total) {
      body.innerHTML = `<div class="home"><div class="home-day">はじめまして</div><h1>Ajoutez vos premières structures</h1>
        <p class="lead">Chaque structure devient une carte : référence, titre, structure, signification et exemples. Elles sont révisées avec FSRS, séparément du vocabulaire.</p>
        <div class="home-actions" style="margin-top:26px"><button class="btn primary big" id="gFirst">Ajouter une structure</button></div></div>`;
      $('#gFirst', body).onclick = () => { st.sub = 'add'; render(); };
      return;
    }
    const due = c.review + c.learning, nothing = due + c.newCards === 0;
    body.innerHTML = `<div class="home g-home">
      ${nothing ? `<div class="done-mark">完</div><h1>Toutes les structures sont révisées</h1>` : `<h1>${due + c.newCards} structure${due + c.newCards > 1 ? 's' : ''} à travailler</h1>`}
      <div class="counters">
        <div class="counter ${c.review ? 'hot' : ''}"><b>${c.review}</b><span>à réviser</span></div>
        <div class="counter"><b>${c.learning}</b><span>en apprentissage</span></div>
        <div class="counter"><b>${c.newCards}</b><span>nouvelles</span></div>
      </div>
      <div class="new-stepper"><span>Nouvelles structures par jour</span>
        <button class="step-btn" data-step="-1">−</button><b id="gNewVal">${set.newPerDay}</b><button class="step-btn" data-step="1">+</button>
        ${c.newTotal ? `<span class="muted small">${c.newTotal} en attente</span>` : ''}</div>
      <label class="g-ai-row"><input type="checkbox" id="gAI" ${set.ai ? 'checked' : ''}>
        <span><b>Phrases d'exemple générées par l'IA</b><em id="gAIStatus">Une phrase par structure, traduction cachée : vous traduisez, puis vous dites si vous avez compris.</em></span></label>
      <div class="home-actions">
        ${nothing ? '' : `<button class="btn primary big" id="gStart">Commencer <kbd>Entrée</kbd></button>`}
        ${nothing ? `<button class="btn primary big" id="gPractice">Entraînement libre</button>` : ''}
        ${nothing && c.newTotal ? `<button class="btn big" id="gMore">+ ${Math.min(c.newTotal, set.newPerDay || 5)} nouvelles</button>` : ''}
      </div>
      ${nothing ? `<p class="home-note">L'entraînement libre ne modifie pas la planification.</p>` : ''}
    </div>`;
    $$('.step-btn', body).forEach(b => b.onclick = () => {
      S.updateSettings({ grammarNewPerDay: Math.max(0, Math.min(50, set.newPerDay + +b.dataset.step)) });
      render(); App().renderChrome(); Motion.pop($('#gNewVal'));
    });
    $('#gAI', body).onchange = (e) => { S.updateSettings({ grammarAI: e.target.checked }); updateAIStatus(); };
    if ($('#gStart', body)) $('#gStart', body).onclick = () => start(G.buildSession(), false);
    if ($('#gPractice', body)) $('#gPractice', body).onclick = () => start(G.items().filter(x => x.fsrs.state !== NEW).map(x => x.id).sort(() => Math.random() - .5).slice(0, 20), true);
    if ($('#gMore', body)) $('#gMore', body).onclick = () => start(G.items().filter(x => x.fsrs.state === NEW).sort((a, b) => a.created - b.created).slice(0, set.newPerDay || 5).map(x => x.id), false);
    updateAIStatus();
  }

  async function updateAIStatus() {
    const el = $('#gAIStatus'); if (!el) return;
    if (!G.settings().ai) { el.textContent = 'Désactivé : révision en mode carte (titre → structure, signification et exemples).'; return; }
    if (!API || !R()) return;
    const ks = await API.aiKeyStatus(aiProvider());
    el.innerHTML = ks.hasKey
      ? `Une phrase par structure avec ${esc(R().aiName())}, traduction cachée : vous traduisez, puis vous dites si vous avez compris. Une seule requête pour la séance.`
      : `<span style="color:var(--accent)">Aucune clé ${esc(R().aiName())} : connectez-la dans Réglages → Service d'IA.</span> En attendant, révision en mode carte.`;
  }

  /* ---------- Démarrage d'une séance ---------- */
  async function start(queue, practice) {
    if (!queue.length) { toast(practice ? 'Aucune structure déjà révisée pour l\'entraînement' : 'Rien à réviser'); return; }
    const s = newSession(queue, practice);
    st.session = s;
    const news = queue.filter(id => { const x = G.get(id); return x && x.fsrs.state === NEW; });
    if (!practice && news.length && G.settings().studyNew) s.study = news;
    s.ai = await aiReady();
    if (s.ai) prefetch(s, [...new Set(queue)]); // la génération commence pendant l'étude des nouvelles structures
    st.animate = true;
    render();
  }

  /** Génère les phrases par lots, en arrière-plan ; le premier lot est attendu avant la première carte */
  async function prefetch(s, ids) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += 12) chunks.push(ids.slice(i, i + 12));
    ids.forEach(id => s.pending.add(id));
    for (const chunk of chunks) {
      if (st.session !== s) return;
      try {
        const out = await fetchSentences(chunk);
        chunk.forEach(id => { s.pending.delete(id); if (out[id]) s.sentences.set(id, out[id]); else s.failed.add(id); });
      } catch (e) {
        chunk.forEach(id => { s.pending.delete(id); s.failed.add(id); });
        if (!s.aiError) { s.aiError = e.message; toast(`Phrases indisponibles (${e.message}) : révision en mode carte.`); }
      }
      if (st.session === s && s.waiting && !s.pending.has(s.waiting)) { s.waiting = null; if (isActive()) render(); }
    }
  }

  /* ---------- Découverte des nouvelles structures ---------- */
  function renderStudy(body) {
    const s = st.session;
    const xs = s.study.map(id => G.get(id)).filter(Boolean);
    if (!xs.length) { s.study = null; return render(); }
    const n = xs.length;
    body.innerHTML = `<div class="study">
      <div class="study-head"><div><div class="home-day">新しい文法</div>
          <h1>${n} nouvelle${n > 1 ? 's' : ''} structure${n > 1 ? 's' : ''} à découvrir</h1>
          <p class="lead">Lisez-les avant d'être interrogé : structure, signification et exemples.${s.ai ? ' Les phrases d\'exemple se préparent pendant ce temps.' : ''}</p></div>
        <label class="study-toggle"><input type="checkbox" id="gHide" ${s.studyHide ? 'checked' : ''}><span>Me tester</span><em>masque structure, signification et exemples ; cliquez sur une carte pour la retourner</em></label></div>
      <div class="study-grid g-study ${s.studyHide ? 'hide' : ''}">${xs.map(x => `<article class="study-card g-card" data-id="${x.id}">
          <button class="icon-btn g-edit" data-edit="${x.id}" title="Modifier">✎</button>${structureHtml(x, { hide: true, scroll: true })}</article>`).join('')}</div>
      <div class="study-foot"><button class="btn ghost" id="gStudyBack">← Retour</button><span class="muted small"></span>
        <button class="btn primary big" id="gStudyGo">J'ai étudié ces structures, commencer <kbd>Entrée</kbd></button></div>
    </div>`;
    $('#gStudyBack', body).onclick = quit;
    $('#gStudyGo', body).onclick = afterStudy;
    $('#gHide', body).onchange = (e) => { s.studyHide = e.target.checked; $('.study-grid', body).classList.toggle('hide', s.studyHide); $$('.study-card', body).forEach(c => c.classList.remove('shown')); };
    $('.study-grid', body).onclick = (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) return openEditor(+ed.dataset.edit);
      const card = e.target.closest('.study-card'); if (card && s.studyHide) card.classList.toggle('shown');
    };
  }
  function afterStudy() { const s = st.session; if (!s || !s.study) return; s.study = null; s.enter = true; render(); }

  /* ---------- Carte de révision ---------- */
  function sentenceFor(s, id) {
    const list = s.sentences.get(id);
    if (!list || !list.length) return null;
    const k = s.shown.get(id) || 0;
    return list[k % list.length];
  }

  function renderCard(body) {
    const s = st.session;
    if (!s.queue.length) { s.done = true; return render(); }
    const id = s.queue[0], x = G.get(id);
    if (!x) { s.queue.shift(); return renderCard(body); }
    s.current = id;
    const done = s.history.length, total = done + s.queue.length, pct = Math.round(done / total * 100);
    const set = G.settings();
    let mode = 'card';
    let sent = null;
    if (s.ai && !s.forceCard?.has(id)) {
      sent = sentenceFor(s, id);
      if (sent) mode = 'ai';
      else if (s.pending.has(id)) mode = 'wait';
    }
    s.mode = mode; s.sentence = sent;

    const top = `<div class="session-top">
        <button class="btn ghost" id="gQuit" title="Quitter (Échap)">← Quitter</button>
        <div class="progress"><i style="width:${s.lastPct ?? pct}%"></i></div>
        <div class="session-count">${done} / ${total}</div></div>`;
    const tools = `<div class="card-tools">
        ${mode === 'ai' ? `<button class="icon-btn ${set.furigana ? 'on' : ''}" id="gFuri" title="Furigana (F)">ふりがな</button>
          <button class="icon-btn" id="gOther" title="Générer une autre phrase">↻ Autre phrase</button>` : ''}
        ${s.undoStack.length ? '<button class="icon-btn" id="gUndo" title="Annuler la dernière réponse (Ctrl+Z)">↶ Annuler</button>' : ''}
        <button class="icon-btn" id="gEditCur" title="Modifier (E)">✎ Modifier</button></div>`;

    let front, back = '', grades = '', help;
    if (mode === 'wait') {
      body.innerHTML = `<div class="session g-session">${top}<article class="card g-rev"><div class="card-tags"><span class="gs-ref">${esc(x.ref)}</span></div>
        <div class="g-wait"><span class="typing"><i></i><i></i><i></i></span><p>${esc(R().aiName())} prépare les phrases d'exemple…</p>
        <button class="btn ghost" id="gNoAI">Continuer sans phrase</button></div></article></div>`;
      s.waiting = id;
      $('#gQuit', body).onclick = quit;
      $('#gNoAI', body).onclick = () => { s.ai = false; render(); };
      return;
    }
    if (mode === 'ai') {
      front = `<div class="g-sentence ${set.furigana ? '' : 'no-furi'}" lang="ja">${sentenceHtml(sent)}</div>`;
      help = s.revealed ? 'Avez-vous bien compris la phrase ? <kbd>1</kbd> non · <kbd>2</kbd> oui' : 'Traduisez la phrase dans votre tête, puis affichez la traduction.';
      if (s.revealed) back = `<div class="answer g-answer">
          <div class="g-fr">${esc(sent.fr)}</div>
          ${sent.note_fr ? `<div class="g-note">${esc(sent.note_fr)}</div>` : ''}
          <div class="g-struct">${structureHtml(x, { noRef: true })}</div></div>`;
    } else {
      front = `<div class="g-title-front">${esc(x.title)}</div>`;
      help = s.revealed ? 'Vous en souveniez-vous ? <kbd>1</kbd> non · <kbd>2</kbd> oui' : 'Rappelez-vous l\'utilisation et le sens de cette structure.';
      if (s.revealed) back = `<div class="answer g-answer"><div class="g-struct">${structureHtml(x, { noRef: true, noTitle: true })}</div></div>`;
    }
    if (s.revealed) {
      const p = s.practice ? null : G.preview(x);
      const no = mode === 'ai' ? 'Non, pas compris' : 'Je ne savais pas';
      const yes = mode === 'ai' ? 'Oui, compris' : 'Je savais';
      grades = `<div class="grades g-grades">
        <button class="grade" data-g="1"><span class="g-name">${no}</span><span class="g-hint"><kbd>1</kbd></span>${p ? `<span class="g-ivl">${fmtIvl(p[1])}</span>` : ''}</button>
        <button class="grade" data-g="3"><span class="g-name">${yes}</span><span class="g-hint"><kbd>2</kbd></span>${p ? `<span class="g-ivl">${fmtIvl(p[3])}</span>` : ''}</button></div>`;
    }

    body.innerHTML = `<div class="session g-session">${top}
      <article class="card g-rev ${s.enter ? 'card-in' : ''}">
        <div class="card-tags">${x.ref ? `<span class="gs-ref">${esc(x.ref)}</span>` : ''}${s.practice ? '<span class="tag">Entraînement</span>' : ''}${x.fsrs.state === NEW ? '<span class="tag new">Nouvelle</span>' : ''}${G.isDifficult(x) ? '<span class="tag hard">Difficile</span>' : ''}</div>
        ${tools}
        <div class="card-front">${front}</div>
        ${back || `<div class="reveal-row"><button class="btn primary big" id="gReveal">${mode === 'ai' ? 'Afficher la traduction' : 'Afficher la réponse'} <kbd>Espace</kbd></button></div>`}
      </article>
      ${grades}
      <div class="session-help">${help} · <kbd>E</kbd> modifier · <kbd>Échap</kbd> quitter</div>
    </div>`;
    s.enter = false;
    const bar = $('.progress i', body);
    if (s.lastPct !== pct) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = pct + '%'; }));
    s.lastPct = pct;

    $('#gQuit', body).onclick = quit;
    $('#gEditCur', body).onclick = () => openEditor(id);
    if ($('#gReveal', body)) $('#gReveal', body).onclick = reveal;
    if ($('#gUndo', body)) $('#gUndo', body).onclick = undo;
    if ($('#gFuri', body)) $('#gFuri', body).onclick = toggleFurigana;
    if ($('#gOther', body)) $('#gOther', body).onclick = otherSentence;
    $$('.grade', body).forEach(b => b.onclick = () => answer(+b.dataset.g));
  }

  function toggleFurigana() {
    S.updateSettings({ grammarFurigana: !G.settings().furigana });
    const el = $('.g-sentence', root); if (el) el.classList.toggle('no-furi', !G.settings().furigana);
    const b = $('#gFuri', root); if (b) b.classList.toggle('on', G.settings().furigana);
  }

  async function otherSentence() {
    const s = st.session, id = s && s.current; if (!id || s.busy) return;
    const btn = $('#gOther', root);
    s.busy = true; if (btn) { btn.disabled = true; btn.textContent = '↻ Génération…'; }
    try {
      const out = await fetchSentences([id], 1);
      if (out[id] && st.session === s && s.current === id) {
        const list = s.sentences.get(id) || [];
        const k = (s.shown.get(id) || 0) % Math.max(1, list.length);
        list.splice(k, 1, out[id][0]);
        s.sentences.set(id, list);
        s.revealed = false;
        renderCard($('#gBody', root));
        Motion.fadeIn($('.g-sentence', root));
      }
    } catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.textContent = '↻ Autre phrase'; } }
    s.busy = false;
  }

  function reveal() {
    const s = st.session; if (!s || s.revealed || s.anim || s.mode === 'wait') return;
    const card = $('.g-rev', root); const h0 = card ? card.offsetHeight : 0;
    s.revealed = true;
    renderCard($('#gBody', root));
    if (h0) Motion.growFrom($('.g-rev', root), h0);
    Motion.stagger(root, '.grade', { step: 40, delay: 60 });
  }

  function answer(g) {
    const s = st.session; if (!s || !s.revealed || s.anim) return;
    const id = s.queue.shift();
    let undoFn = null, requeue = false;
    if (s.practice) requeue = g === 1;
    else { const r = G.grade(id, g); undoFn = r.undo; requeue = r.interval === 0; }
    if (s.mode === 'ai' && s.sentence) G.remember(id, s.sentence);
    s.shown.set(id, (s.shown.get(id) || 0) + 1);
    if (!s.first.has(id)) s.first.set(id, g);
    s.history.push(id);
    let at = -1;
    if (requeue) { at = Math.min(s.queue.length, 3 + Math.floor(Math.random() * 3)); s.queue.splice(at, 0, id); }
    s.undoStack.push({ id, g, undoFn, at });
    s.revealed = false;
    App().renderChrome();
    const card = $('.g-rev', root);
    const color = getComputedStyle(document.documentElement).getPropertyValue(g === 1 ? '--g1' : '--g3').trim();
    const a = Motion.exit(card, [{ transform: 'none', opacity: 1, boxShadow: `0 0 0 0 ${color}` }, { transform: 'translateX(-34px) scale(.985)', opacity: 0, boxShadow: `0 0 0 4px ${color}` }], 160);
    const next = () => { s.anim = null; if (!s.queue.length) { s.done = true; st.animate = true; return render(); } s.enter = true; renderCard($('#gBody', root)); };
    if (!a) return next();
    s.anim = a; a.finished.then(next, next);
  }

  function undo() {
    const s = st.session; if (!s || !s.undoStack.length) return;
    const u = s.undoStack.pop();
    if (u.undoFn) u.undoFn();
    if (u.at >= 0) { const i = s.queue.indexOf(u.id, u.at); if (i >= 0) s.queue.splice(i, 1); }
    s.queue.unshift(u.id);
    s.history.pop();
    s.shown.set(u.id, Math.max(0, (s.shown.get(u.id) || 1) - 1));
    if (!s.history.includes(u.id)) s.first.delete(u.id);
    s.revealed = true; s.done = false;
    App().renderChrome();
    render(); toast('Réponse annulée');
  }

  function quit() { st.session = null; st.animate = true; render(); App().renderChrome(); }

  function renderSummary(body) {
    const s = st.session;
    const firsts = [...s.first.entries()];
    const ok = firsts.filter(([, g]) => g > 1).length, ko = firsts.length - ok;
    const missed = firsts.filter(([, g]) => g === 1).map(([id]) => G.get(id)).filter(Boolean);
    body.innerHTML = `<div class="summary">
      <div class="done-mark">${firsts.length ? 'お疲れ様' : '完'}</div>
      <h1>${s.practice ? 'Entraînement terminé' : 'Séance terminée'}</h1>
      <p class="lead">${firsts.length} structure${firsts.length > 1 ? 's' : ''} révisée${firsts.length > 1 ? 's' : ''}</p>
      <div class="counters g-counters2">
        <div class="counter"><b>${ok}</b><span>comprises</span></div>
        <div class="counter ${ko ? 'hot' : ''}"><b>${ko}</b><span>pas comprises</span></div>
      </div>
      ${missed.length ? `<p class="muted">À revoir — elles reviendront plus tôt :</p><div class="forgot-list">${missed.map(x => `<span>${esc(x.title)}</span>`).join('')}</div>` : ''}
      <div class="home-actions"><button class="btn primary big" id="gEnd">Terminer <kbd>Entrée</kbd></button></div>
    </div>`;
    $('#gEnd', body).onclick = quit;
    Motion.stagger(body, '.counter, .forgot-list span, .home-actions .btn', { step: 45, delay: 250 });
    Motion.countUp(body, '.counter b', 700);
  }

  /* =====================================================================
     Clavier (onglet Grammaire uniquement)
     ===================================================================== */
  function isActive() { return !!(root && root.classList.contains('active')); }
  document.addEventListener('keydown', (e) => {
    if (!isActive() || st.sub !== 'review') return;
    if (!$('#modal').hidden) return;
    const s = st.session;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing) return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'Escape' && s && !s.done) { stop(); return quit(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && s && !s.done) { stop(); return undo(); }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (s && s.anim) { stop(); s.anim.finish(); return; }
    if (!s) { if (e.key === 'Enter' && $('#gStart', root)) { stop(); $('#gStart', root).click(); } return; }
    if (s.done) { if (e.key === 'Enter') { stop(); quit(); } return; }
    if (s.study) { if (e.key === 'Enter') { stop(); afterStudy(); } return; }
    if (!s.revealed) { if (e.key === ' ' || e.key === 'Enter') { stop(); reveal(); } }
    else if (e.key === '1') { stop(); answer(1); }
    else if (e.key === '2' || e.key === '3') { stop(); answer(3); }
    if (e.key.toLowerCase() === 'e' && s.current) { stop(); openEditor(s.current); }
    if (e.key.toLowerCase() === 'f' && s.mode === 'ai') { stop(); toggleFurigana(); }
  });

  window.Grammar = { G, render, counts: () => G.counts(), openEditor, _sentenceHtml: sentenceHtml };
})();
