/* =====================================================================
   Clavier adapté au champ : japonais (hiragana ou katakana) ou français
   ---------------------------------------------------------------------
   Chaque champ de saisie porte la langue attendue (lang="ja" ou "fr", ou
   data-ime="kata" pour forcer les katakana). Quand il reçoit le focus :
     - application Windows : le clavier change tout seul (voir ime.js) ;
     - navigateur (téléphone, ordinateur) : la langue est indiquée au
       clavier, mais aucun navigateur ne permet à une page de changer le
       clavier du système ; on règle au moins la correction et les
       majuscules automatiques selon la langue.
   Un champ sans langue (recherche, jeton, clé…) ne change rien.
   ===================================================================== */
(function () {
  'use strict';
  const API = () => window.kotobaAPI;
  const KATA_ONLY = /^[゠-ヿㇰ-ㇿｦ-ﾟ\s・ー〜～]+$/;

  /** Mode voulu pour un champ : 'hira' | 'kata' | 'latin' | null */
  function modeOf(el) {
    if (!el || !el.matches || !el.matches('input, textarea, [contenteditable="true"]')) return null;
    if (el.matches('[type="checkbox"], [type="radio"], [type="range"], [type="number"], [type="password"], [type="file"]')) return null;
    const forced = el.dataset && el.dataset.ime;
    if (forced === 'kata' || forced === 'hira' || forced === 'latin') return forced;
    if (forced === 'off') return null;
    const lang = (el.getAttribute('lang') || '').toLowerCase();
    if (lang.startsWith('ja')) {
      let v = String(el.value || '').trim();
      // champ vide qui suit un autre champ (la lecture suit le mot : コーヒー → katakana)
      if (!v && el.dataset.imeFrom) {
        const scope = el.closest('.form-card, .modal, form') || document;
        const src = scope.querySelector(el.dataset.imeFrom);
        if (src) v = String(src.value || '').trim();
      }
      return v && KATA_ONLY.test(v) ? 'kata' : 'hira';
    }
    if (lang.startsWith('fr') || lang.startsWith('en')) return 'latin';
    return null;
  }

  /** Réglages navigateur selon la langue (utile surtout sur téléphone) */
  function hint(el) {
    const lang = (el.getAttribute('lang') || '').toLowerCase();
    if (lang.startsWith('ja')) {
      if (!el.hasAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'off');
      if (!el.hasAttribute('autocorrect')) el.setAttribute('autocorrect', 'off');
      if (!el.hasAttribute('spellcheck')) el.spellcheck = false;
    } else if (lang.startsWith('fr')) {
      if (!el.hasAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'sentences');
    }
  }

  let warned = false;
  async function apply(el) {
    const mode = modeOf(el);
    if (!mode) return;
    hint(el);
    const api = API();
    if (!api || !api.imeSet) return;
    if (window.Store && Store.data && Store.data.settings.autoKeyboard === false) return;
    try {
      const r = await api.imeSet(mode);
      if (r && r.noJapanese && r.first && !warned && window.App) {
        warned = true;
        window.App.toast("Clavier japonais introuvable : ajoutez la langue japonaise dans Paramètres Windows → Heure et langue → Langue et région.");
      }
    } catch (_) { /* sans effet */ }
  }

  document.addEventListener('focusin', (e) => apply(e.target));
  // retour dans la fenêtre : on réapplique pour le champ actif (le clavier a pu changer dans une autre application)
  window.addEventListener('focus', () => { if (document.activeElement && document.activeElement !== document.body) apply(document.activeElement); });
  window.KotobaIME = { modeOf, apply };
})();
