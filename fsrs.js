/* =====================================================================
   FSRS-5 — Free Spaced Repetition Scheduler
   Modèle DSR : Difficulté (1–10), Stabilité (jours), Récupérabilité (0–1)
   Référence : https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
   ===================================================================== */
(function (root) {
  'use strict';

  // Paramètres par défaut de FSRS-5 (entraînés sur des millions de révisions)
  const DEFAULT_W = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
    1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
    2.9898, 0.51655, 0.6621,
  ];

  const DECAY = -0.5;
  const FACTOR = 19 / 81; // garantit R(S, S) = 0.9

  // Notes
  const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;
  // États
  const NEW = 0, LEARNING = 1, REVIEW = 2, RELEARNING = 3;

  const MIN_S = 0.01;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  class FSRS {
    constructor(opts = {}) {
      this.w = opts.w || DEFAULT_W;
      this.requestRetention = opts.requestRetention || 0.9;
      this.maximumInterval = opts.maximumInterval || 36500;
      this.enableFuzz = opts.enableFuzz !== false;
    }

    /** Probabilité de se souvenir après t jours avec une stabilité S */
    retrievability(t, S) {
      if (!S || S <= 0) return 0;
      return Math.pow(1 + FACTOR * Math.max(0, t) / S, DECAY);
    }

    initStability(g) { return Math.max(this.w[g - 1], 0.1); }

    initDifficulty(g) {
      return clamp(this.w[4] - Math.exp(this.w[5] * (g - 1)) + 1, 1, 10);
    }

    nextDifficulty(D, g) {
      const delta = -this.w[6] * (g - 3);
      const damped = D + delta * (10 - D) / 9; // amortissement linéaire
      // retour vers la moyenne (difficulté initiale d'un « Facile »)
      const reverted = this.w[7] * this.initDifficulty(EASY) + (1 - this.w[7]) * damped;
      return clamp(reverted, 1, 10);
    }

    nextRecallStability(D, S, R, g) {
      const hardPenalty = g === HARD ? this.w[15] : 1;
      const easyBonus = g === EASY ? this.w[16] : 1;
      return S * (1 +
        Math.exp(this.w[8]) * (11 - D) * Math.pow(S, -this.w[9]) *
        (Math.exp(this.w[10] * (1 - R)) - 1) * hardPenalty * easyBonus);
    }

    nextForgetStability(D, S, R) {
      const sf = this.w[11] * Math.pow(D, -this.w[12]) *
        (Math.pow(S + 1, this.w[13]) - 1) * Math.exp(this.w[14] * (1 - R));
      return Math.min(sf, S); // on ne devient jamais « plus stable » en oubliant
    }

    /** Révision dans la même journée (court terme) */
    shortTermStability(S, g) {
      return S * Math.exp(this.w[17] * (g - 3 + this.w[18]));
    }

    /** Intervalle (jours) pour atteindre la rétention souhaitée */
    nextInterval(S, fuzzSeed) {
      let ivl = (S / FACTOR) * (Math.pow(this.requestRetention, 1 / DECAY) - 1);
      ivl = clamp(Math.round(ivl), 1, this.maximumInterval);
      if (this.enableFuzz && ivl >= 3 && fuzzSeed !== undefined) ivl = this.fuzz(ivl, fuzzSeed);
      return ivl;
    }

    fuzz(ivl, seed) {
      // fuzz déterministe (évite que des mots ajoutés ensemble reviennent toujours ensemble)
      let delta = 1;
      if (ivl >= 7) delta += Math.min(ivl, 20) * 0.15 - 1.05 + 1;
      if (ivl >= 20) delta += (ivl - 20) * 0.05;
      delta = Math.max(1, Math.round(delta));
      const x = Math.sin(seed * 9301 + 49297) * 233280;
      const rnd = x - Math.floor(x);
      return clamp(ivl + Math.round((rnd * 2 - 1) * delta), 2, this.maximumInterval);
    }

    /** Applique une note à un état (sans contrainte d'ordre entre notes) */
    _step(card, g, today, seed) {
      const c = Object.assign({}, card);
      const elapsed = c.lastDay == null ? 0 : Math.max(0, today - c.lastDay);
      let R = 1;

      if (c.state === NEW) {
        c.stability = this.initStability(g);
        c.difficulty = this.initDifficulty(g);
      } else {
        R = this.retrievability(elapsed, c.stability);
        if (elapsed === 0) {
          c.stability = this.shortTermStability(c.stability, g);
        } else if (g === AGAIN) {
          c.stability = this.nextForgetStability(c.difficulty, c.stability, R);
        } else {
          c.stability = this.nextRecallStability(c.difficulty, c.stability, R, g);
        }
        c.difficulty = this.nextDifficulty(c.difficulty, g);
      }
      c.stability = Math.max(MIN_S, c.stability);

      let interval;
      if (g === AGAIN) {
        if (card.state === REVIEW) c.lapses = (c.lapses || 0) + 1;
        c.state = (card.state === REVIEW || card.state === RELEARNING) ? RELEARNING : LEARNING;
        interval = 0; // revient dans la séance
      } else if (g === HARD && card.state !== REVIEW) {
        c.state = card.state === NEW ? LEARNING : card.state;
        interval = 0; // encore une fois dans la séance
      } else {
        interval = this.nextInterval(c.stability, seed);
        c.state = REVIEW;
      }
      c.reps = (c.reps || 0) + 1;
      c.lastDay = today;
      return { card: c, interval, retrievability: R, elapsed };
    }

    /**
     * Calcule le résultat des 4 notes possibles pour une carte.
     * interval = jours avant la prochaine révision (0 = à revoir dans la séance)
     * Garantit : Difficile < Bien < Facile (en jours).
     */
    schedule(card, today, seed) {
      const out = {};
      for (const g of [AGAIN, HARD, GOOD, EASY]) out[g] = this._step(card, g, today, seed);
      const h = out[HARD], gd = out[GOOD], e = out[EASY];
      if (h.interval > 0) {
        h.interval = Math.min(h.interval, gd.interval);
        gd.interval = Math.max(gd.interval, h.interval + 1);
      }
      e.interval = Math.max(e.interval, gd.interval + 1);
      for (const g of [HARD, GOOD, EASY]) {
        out[g].interval = Math.min(out[g].interval, this.maximumInterval);
      }
      return out;
    }

    review(card, g, today, seed) { return this.schedule(card, today, seed)[g]; }

    preview(card, today, seed) {
      const s = this.schedule(card, today, seed);
      return { 1: s[1].interval, 2: s[2].interval, 3: s[3].interval, 4: s[4].interval };
    }
  }

  const api = { FSRS, DEFAULT_W, AGAIN, HARD, GOOD, EASY, NEW, LEARNING, REVIEW, RELEARNING, FACTOR, DECAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FSRSLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
