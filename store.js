/* =====================================================================
   Store : données, jours, planification FSRS, sauvegarde
   ===================================================================== */
(function () {
  'use strict';
  const { FSRS, NEW, LEARNING, REVIEW, RELEARNING } = window.FSRSLib;

  const DEFAULT_SETTINGS = {
    desiredRetention: 0.9,   // probabilité visée de se souvenir au moment de la révision
    newPerDay: 10,           // nouveaux mots présentés par jour
    studyNew: true,          // présenter les nouveaux mots avant la séance
    grammarNewPerDay: 5,     // grammaire : nouvelles structures par jour
    grammarStudyNew: true,   // grammaire : présenter les nouvelles structures avant la séance
    grammarAI: true,         // grammaire : phrases d'exemple générées par l'IA
    grammarFurigana: true,   // grammaire : furigana dans les phrases générées
    maxReviewsPerDay: 9999,
    rolloverHour: 4,         // la « journée » change à 4 h du matin
    leechThreshold: 4,       // oublis avant d'être marqué « mot difficile »
    newMixRatio: 3,          // 1 nouveau mot toutes les N révisions
    theme: 'system',
    motion: 'auto',         // animations : auto (comme Windows) | on | off
    autoKeyboard: true,      // Windows : clavier japonais / français choisi selon le champ
  };

  const M = window.KotobaMerge;
  const MASTERED_S = 21; // stabilité (jours) au-delà de laquelle un mot est « maîtrisé »

  const Store = {
    data: null,
    fsrs: null,
    _saveTimer: null,
    _snap: null,
    listeners: [],
    replaceListeners: [],

    async init() {
      let raw = null;
      try { raw = window.kotobaAPI ? await window.kotobaAPI.load() : JSON.parse(localStorage.getItem('kotoba') || 'null'); }
      catch (_) { raw = null; }
      this.data = this.migrate(raw);
      this.applySettings();
      this._snap = M.snapshot(this.data);
    },

    migrate(raw) {
      const d = raw && typeof raw === 'object' ? raw : {};
      d.version = 1;
      d.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
      // l'ancienne valeur par défaut (15) passe à 10, sauf si elle a été choisie par l'utilisateur
      if (!d.settings.newPerDayUserSet && d.settings.newPerDay === 15) d.settings.newPerDay = 10;
      d.cards = Array.isArray(d.cards) ? d.cards : [];
      d.logs = Array.isArray(d.logs) ? d.logs : [];
      d.nextId = d.nextId || (d.cards.reduce((m, c) => Math.max(m, c.id), 0) + 1);
      if (d.startDay == null) d.startDay = null; // fixé au premier mot ajouté
      return d;
    },

    applySettings() {
      const s = this.data.settings;
      this.fsrs = new FSRS({ requestRetention: s.desiredRetention });
    },

    onChange(fn) { this.listeners.push(fn); },
    emit() { this.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },

    serialize() { return JSON.stringify(this.data); },

    /** Date de modification des éléments changés depuis le dernier enregistrement (pour la synchronisation) */
    stampNow() {
      if (!this.data) return false;
      if (!this._snap) { this._snap = M.snapshot(this.data); return false; }
      const changed = M.stamp(this.data, this._snap);
      if (changed) this._snap = M.snapshot(this.data);
      return changed;
    },

    save(immediate) {
      clearTimeout(this._saveTimer);
      const doSave = () => {
        const changed = this.stampNow();
        const json = this.serialize();
        if (window.kotobaAPI) window.kotobaAPI.save(json).catch(e => console.error('save', e));
        else try { localStorage.setItem('kotoba', json); } catch (_) {}
        if (changed && window.Sync) window.Sync.dirty();
      };
      if (immediate) doSave(); else this._saveTimer = setTimeout(doSave, 250);
    },

    saveSync() {
      clearTimeout(this._saveTimer);
      const changed = this.stampNow();
      const json = this.serialize();
      if (window.kotobaAPI) window.kotobaAPI.saveSync(json);
      else try { localStorage.setItem('kotoba', json); } catch (_) {}
      if (changed && window.Sync) window.Sync.dirty();
    },

    /** Remplace les données par une version fusionnée, en gardant les mêmes objets en mémoire
        (un texte ou une séance ouverts restent valides). */
    replace(next) {
      next = this.migrate(JSON.parse(JSON.stringify(next)));
      const d = this.data;
      const reuse = (oldList, newList) => {
        const m = new Map((oldList || []).map(x => [x.id, x]));
        return (newList || []).map(n => {
          const o = m.get(n.id);
          if (!o) return n;
          for (const k of Object.keys(o)) if (!(k in n)) delete o[k];
          return Object.assign(o, n);
        });
      };
      const fillArray = (target, src) => { if (!Array.isArray(target)) return src; target.length = 0; for (const x of src) target.push(x); return target; };
      next.cards = fillArray(d.cards, reuse(d.cards, next.cards));
      next.logs = fillArray(d.logs, next.logs);
      if (Array.isArray(next.readings)) next.readings = fillArray(d.readings, reuse(d.readings, next.readings));
      if (Array.isArray(next.exercises)) next.exercises = fillArray(d.exercises, reuse(d.exercises, next.exercises));
      if (next.grammar && d.grammar && typeof d.grammar === 'object') {
        const g = d.grammar, ng = next.grammar;
        ng.items = fillArray(g.items, reuse(g.items, ng.items));
        ng.logs = fillArray(g.logs, ng.logs || []);
        for (const k of Object.keys(g)) if (!(k in ng)) delete g[k];
        next.grammar = Object.assign(g, ng);
      }
      for (const k of Object.keys(d)) if (!(k in next)) delete d[k];
      Object.assign(d, next);
      this.applySettings();
      this._snap = M.snapshot(d);
      clearTimeout(this._saveTimer);
      const json = this.serialize();
      if (window.kotobaAPI) window.kotobaAPI.save(json).catch(e => console.error('save', e));
      this.replaceListeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    },
    onReplace(fn) { this.replaceListeners.push(fn); },

    changed() { this.save(); this.emit(); },

    /* ---------- Jours ---------- */
    dayKey(ts) {
      const d = new Date(ts - this.data.settings.rolloverHour * 3600e3);
      return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400e3);
    },
    today() { return this.dayKey(Date.now()); },
    /** Jour 1 = jour du premier mot ajouté */
    dayNumber(key) { return this.data.startDay == null ? 1 : key - this.data.startDay + 1; },
    currentDayNumber() { return this.dayNumber(this.today()); },

    /* ---------- Cartes ---------- */
    blankFsrs() { return { state: NEW, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastDay: null, dueDay: null }; },

    addCard(fields) {
      const today = this.today();
      if (this.data.startDay == null) this.data.startDay = today;
      const card = {
        id: this.data.nextId++,
        word: fields.word.trim(),
        reading: (fields.reading || '').trim(),
        meaning: (fields.meaning || '').trim(),
        examples: (fields.examples || []).filter(e => e.jp && e.jp.trim()),
        notes: (fields.notes || '').trim(),
        createdDay: today,
        created: Date.now(),
        fsrs: this.blankFsrs(),
      };
      this.data.cards.push(card);
      this.changed();
      return card;
    },

    updateCard(id, fields) {
      const c = this.get(id);
      if (!c) return;
      Object.assign(c, {
        word: fields.word.trim(),
        reading: (fields.reading || '').trim(),
        meaning: (fields.meaning || '').trim(),
        examples: (fields.examples || []).filter(e => e.jp && e.jp.trim()),
        notes: (fields.notes || '').trim(),
      });
      this.changed();
    },

    deleteCard(id) {
      this.data.cards = this.data.cards.filter(c => c.id !== id);
      this.data.logs = this.data.logs.filter(l => l.id !== id);
      this.changed();
    },

    resetCard(id) {
      const c = this.get(id);
      if (!c) return;
      c.fsrs = this.blankFsrs();
      this.changed();
    },

    get(id) { return this.data.cards.find(c => c.id === id); },

    findDuplicate(word, exceptId) {
      const w = word.trim();
      return this.data.cards.find(c => c.word === w && c.id !== exceptId);
    },

    /* ---------- Classification ---------- */
    isMastered(c) { return c.fsrs.state === REVIEW && c.fsrs.stability >= MASTERED_S; },

    /** Mot difficile : oublié souvent, ou difficulté FSRS très élevée */
    isDifficult(c) {
      const f = c.fsrs;
      if (f.state === NEW) return false;
      return f.lapses >= this.data.settings.leechThreshold ||
        (f.difficulty >= 8 && f.reps >= 3) ||
        this.recentFailRate(c.id) >= 0.5;
    },

    /** Part des derniers jours de révision où le mot a été oublié à la première tentative */
    recentFailRate(id) {
      const firstOfDay = new Map();
      for (const l of this.data.logs) if (l.id === id && !firstOfDay.has(l.day)) firstOfDay.set(l.day, l.g);
      const firsts = [...firstOfDay.values()].slice(-5);
      if (firsts.length < 4) return 0;
      return firsts.filter(g => g === 1).length / firsts.length;
    },

    category(c) {
      const s = c.fsrs.state;
      if (s === NEW) return 'new';
      if (s === LEARNING || s === RELEARNING) return 'learning';
      return c.fsrs.stability >= MASTERED_S ? 'mastered' : 'young';
    },

    retrievabilityNow(c) {
      if (c.fsrs.state === NEW) return null;
      return this.fsrs.retrievability(this.today() - c.fsrs.lastDay, c.fsrs.stability);
    },

    daysUntilDue(c) {
      if (c.fsrs.state === NEW || c.fsrs.dueDay == null) return null;
      return c.fsrs.dueDay - this.today();
    },

    /* ---------- File du jour ---------- */
    newIntroducedToday() {
      const t = this.today();
      const seen = new Set();
      for (const l of this.data.logs) if (l.day === t && l.st === NEW) seen.add(l.id);
      return seen.size;
    },

    dueReviewCards() {
      const t = this.today();
      return this.data.cards.filter(c => c.fsrs.state !== NEW && c.fsrs.dueDay != null && c.fsrs.dueDay <= t);
    },

    newCardsForToday() {
      const left = Math.max(0, this.data.settings.newPerDay - this.newIntroducedToday());
      return this.data.cards
        .filter(c => c.fsrs.state === NEW)
        .sort((a, b) => a.created - b.created)
        .slice(0, left);
    },

    counts() {
      const due = this.dueReviewCards();
      return {
        learning: due.filter(c => c.fsrs.state === LEARNING || c.fsrs.state === RELEARNING).length,
        review: due.filter(c => c.fsrs.state === REVIEW).length,
        newCards: this.newCardsForToday().length,
        newTotal: this.data.cards.filter(c => c.fsrs.state === NEW).length,
        total: this.data.cards.length,
        difficult: this.data.cards.filter(c => this.isDifficult(c)).length,
      };
    },

    /** Construit la file de la séance : les mots les plus à risque d'abord, les nouveaux intercalés */
    buildSession() {
      const due = this.dueReviewCards();
      // les mots en (ré)apprentissage d'abord, puis par récupérabilité croissante (risque d'oubli)
      due.sort((a, b) => {
        const la = a.fsrs.state !== REVIEW ? 0 : 1, lb = b.fsrs.state !== REVIEW ? 0 : 1;
        if (la !== lb) return la - lb;
        return (this.retrievabilityNow(a) ?? 0) - (this.retrievabilityNow(b) ?? 0);
      });
      const reviews = due.slice(0, this.data.settings.maxReviewsPerDay);
      const news = this.newCardsForToday();
      const ratio = Math.max(1, this.data.settings.newMixRatio);
      const queue = [];
      let r = 0, n = 0;
      while (r < reviews.length || n < news.length) {
        for (let k = 0; k < ratio && r < reviews.length; k++) queue.push(reviews[r++].id);
        if (n < news.length) queue.push(news[n++].id);
      }
      return queue;
    },

    previewIntervals(c) {
      return this.fsrs.preview(c.fsrs, this.today(), c.id * 31 + c.fsrs.reps);
    },

    /** Enregistre une note. Retourne {interval, undo} */
    grade(id, g) {
      const c = this.get(id);
      const today = this.today();
      const before = JSON.parse(JSON.stringify(c.fsrs));
      const res = this.fsrs.review(c.fsrs, g, today, c.id * 31 + c.fsrs.reps);
      const f = res.card;
      f.dueDay = today + res.interval;
      c.fsrs = f;
      this.data.logs.push({
        id, day: today, t: Date.now(), g,
        st: before.state,
        el: res.elapsed,
        R: +res.retrievability.toFixed(4),
        S: +f.stability.toFixed(4),
        D: +f.difficulty.toFixed(4),
        ivl: res.interval,
      });
      this.changed();
      return {
        interval: res.interval,
        undo: () => {
          c.fsrs = before;
          const idx = this.data.logs.map(l => l.id).lastIndexOf(id);
          if (idx >= 0) this.data.logs.splice(idx, 1);
          this.changed();
        },
      };
    },

    /* ---------- Réglages / import ---------- */
    updateSettings(patch) {
      Object.assign(this.data.settings, patch);
      this.applySettings();
      this.changed();
    },

    /** Importe une sauvegarde : elle remplace les données sur tous les appareils synchronisés */
    importJSON(text) {
      const raw = JSON.parse(text);
      if (!raw || !Array.isArray(raw.cards)) throw new Error('Fichier non reconnu');
      this.stampNow();
      this.replace(M.restoreOver(this.data, this.migrate(raw)));
      if (window.Sync) window.Sync.dirty(true);
      this.emit();
    },

    MASTERED_S,
  };

  window.Store = Store;
})();
