/* =====================================================================
   Animations : courtes, discrètes, désactivables
   - Réglage « Animations » : comme Windows (respecte « réduire les animations »),
     toujours, ou désactivées.
   ===================================================================== */
(function () {
  'use strict';
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let mode = 'auto';

  function ok() {
    if (mode === 'off') return false;
    if (mode === 'on') return true;
    return !reduceQuery.matches;
  }

  function apply(m) {
    if (m) mode = m;
    document.documentElement.classList.toggle('no-anim', !ok());
  }
  reduceQuery.addEventListener('change', () => apply());

  /** Fait apparaître des éléments l'un après l'autre */
  function stagger(root, selector, opts = {}) {
    if (!ok() || !root) return;
    const step = opts.step ?? 30, max = opts.max ?? 24, base = opts.delay ?? 0;
    const els = Array.from(root.querySelectorAll(selector));
    els.forEach((el, i) => {
      if (i >= max) return;
      el.style.setProperty('--d', `${base + i * step}ms`);
      el.classList.remove('stag-in'); void el.offsetWidth; el.classList.add('stag-in');
      el.addEventListener('animationend', () => el.classList.remove('stag-in'), { once: true });
    });
  }

  /** Fait défiler un nombre jusqu'à sa valeur ; garde le suffixe (« 61 % », « 3 / 4 », « 12 j ») */
  function countUp(root, selector, duration = 650) {
    if (!ok() || !root) return;
    root.querySelectorAll(selector).forEach(el => {
      const txt = el.textContent.trim();
      const m = txt.match(/^(\d+)(.*)$/s);
      if (!m) return;
      const target = +m[1], suffix = m[2];
      if (target < 2) return;
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / duration);
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(target * e) + suffix;
        if (k < 1) requestAnimationFrame(tick);
      };
      el.textContent = '0' + suffix;
      requestAnimationFrame(tick);
    });
  }

  /** Petite impulsion (badge, valeur qui change) */
  function pop(el) {
    if (!ok() || !el) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 320, easing: EASE });
  }

  /** Fondu d'entrée d'un bloc */
  function fadeIn(el, dy = 6, duration = 220) {
    if (!ok() || !el) return;
    el.animate([{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }], { duration, easing: EASE });
  }

  /** Transition de hauteur entre deux états d'un même bloc (avant/après un rendu) */
  function growFrom(el, fromHeight, duration = 280) {
    if (!ok() || !el) return;
    const to = el.offsetHeight;
    if (Math.abs(to - fromHeight) < 2) return;
    const prev = el.style.overflow;
    el.style.overflow = 'hidden';
    const a = el.animate([{ height: fromHeight + 'px' }, { height: to + 'px' }], { duration, easing: EASE });
    a.onfinish = a.oncancel = () => { el.style.overflow = prev; };
  }

  /** Sortie d'un élément ; renvoie l'animation (null si désactivé) */
  function exit(el, keyframes, duration = 150) {
    if (!ok() || !el) return null;
    return el.animate(keyframes, { duration, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  }

  /* ---------- Indicateur glissant de la barre latérale ---------- */
  let ind = null;
  function syncNav() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    if (!ind) { ind = document.createElement('span'); ind.className = 'nav-ind'; nav.prepend(ind); }
    const act = nav.querySelector('.nav-item.active');
    if (!act) { ind.style.opacity = 0; return; }
    ind.style.opacity = 1;
    if (getComputedStyle(nav).flexDirection === 'row') {
      // petit écran : barre d'onglets horizontale
      ind.style.transform = `translateX(${act.offsetLeft}px)`;
      ind.style.width = act.offsetWidth + 'px';
      ind.style.height = act.offsetHeight + 'px';
      const l = act.offsetLeft, r = l + act.offsetWidth;
      if (l < nav.scrollLeft || r > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: Math.max(0, l - nav.clientWidth / 2 + act.offsetWidth / 2), behavior: ok() ? 'smooth' : 'auto' });
    } else {
      ind.style.width = '';
      ind.style.transform = `translateY(${act.offsetTop}px)`;
      ind.style.height = act.offsetHeight + 'px';
    }
    if (!ind.classList.contains('ready')) requestAnimationFrame(() => ind.classList.add('ready'));
  }
  window.addEventListener('resize', syncNav);

  /** Changement de thème en fondu */
  function themeFade() {
    if (!ok()) return;
    const r = document.documentElement;
    r.classList.add('theme-anim');
    clearTimeout(themeFade._t);
    themeFade._t = setTimeout(() => r.classList.remove('theme-anim'), 450);
  }

  window.Motion = { ok, apply, stagger, countUp, pop, fadeIn, growFrom, exit, syncNav, themeFade, EASE };
})();
