/* =====================================================================
   Synchronisation des données avec le dépôt GitHub privé
   ---------------------------------------------------------------------
   Le fichier du dépôt est la référence commune de l'application Windows
   et de la page web. À l'ouverture, puis régulièrement, on lit la version
   du dépôt et on la fusionne avec celle de l'appareil ; après des
   modifications, on envoie la version fusionnée. Si un autre appareil a
   écrit entre-temps, GitHub refuse l'envoi : on relit, on refusionne,
   puis on renvoie. Rien n'est jamais écrasé sans fusion.
   ===================================================================== */
(function () {
  'use strict';
  const M = window.KotobaMerge;
  const S = window.Store;
  const API = () => window.kotobaAPI;

  const PUSH_IDLE = 40e3;     // envoi 40 s après la dernière modification…
  const PUSH_MAX_WAIT = 180e3; // …et au plus tard 3 min après la première
  const PULL_EVERY = 120e3;    // relecture toutes les 2 min quand l'app est au premier plan

  const st = {
    enabled: false,
    config: null,
    sha: null,          // identifiant de la version du dépôt sur laquelle on s'appuie
    etag: null,
    known: false,       // version du dépôt déjà lue au moins une fois
    remoteCanon: null,  // contenu de cette version, pour éviter les envois inutiles
    phase: 'off',       // off | idle | pulling | pushing | error | offline | blocked
    error: null,
    lastSync: 0,
    pending: false,
    firstDirty: 0,
  };
  let queue = Promise.resolve();
  let pushTimer = null, pullTimer = null;
  const listeners = [];

  const run = (fn) => (queue = queue.then(fn, fn).catch(e => { console.error('sync', e); }));
  const setPhase = (phase, error) => {
    st.phase = phase; st.error = error || null;
    listeners.forEach(fn => { try { fn(status()); } catch (_) {} });
  };
  function status() {
    return { enabled: st.enabled, phase: st.phase, error: st.error, lastSync: st.lastSync, pending: st.pending, config: st.config };
  }
  const device = () => (API() && API().platform === 'web') ? 'web' : 'Windows';

  /* ---------- Lecture du dépôt et fusion ---------- */
  async function pullNow(force) {
    if (!st.enabled) return { ok: false };
    if (st.phase !== 'pushing') setPhase('pulling');
    const r = await API().syncGet(force ? null : st.etag);
    if (r.error) {
      setPhase(r.offline ? 'offline' : 'error', r.error);
      return { ok: false, error: r.error, auth: r.auth };
    }
    st.lastSync = Date.now();
    if (r.notModified) { setPhase(st.pending ? 'idle' : 'idle'); return { ok: true, same: true }; }
    if (r.notFound) {
      // premier envoi : le fichier n'existe pas encore dans le dépôt
      st.sha = null; st.etag = null; st.known = true; st.remoteCanon = null; st.pending = true;
      setPhase('idle');
      return { ok: true, created: true };
    }
    let remote;
    try { remote = JSON.parse(r.text); } catch (_) { remote = null; }
    if (!remote || typeof remote !== 'object' || !Array.isArray(remote.cards)) {
      // on ne touche à rien : mieux vaut s'arrêter que d'écraser un fichier qu'on ne comprend pas
      setPhase('blocked', `Le fichier « ${(st.config && st.config.path) || 'kotoba-data.json'} » du dépôt est illisible. Rien n'a été envoyé. Restaurez une version depuis l'historique, ou corrigez le fichier sur GitHub.`);
      return { ok: false, blocked: true };
    }
    S.stampNow();
    const before = M.canon(S.data);
    const res = M.merge(remote, S.data);
    st.sha = r.sha; st.etag = r.etag || null; st.known = true;
    st.remoteCanon = M.canon(remote);
    let changedHere = false;
    if (M.canon(res.data) !== before) { S.replace(res.data); changedHere = true; }
    st.pending = M.canon(S.data) !== st.remoteCanon;
    setPhase('idle');
    if (res.renamed.length && window.App) window.App.toast(`${res.renamed.length} élément(s) ajouté(s) en même temps sur un autre appareil : renuméroté(s), rien n'est perdu.`);
    return { ok: true, changed: changedHere };
  }

  /* ---------- Envoi de la version fusionnée ---------- */
  async function pushNow() {
    if (!st.enabled || st.phase === 'blocked') return { ok: false };
    S.stampNow();
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!st.known) { const p = await pullNow(); if (!p.ok) return p; }
      const canon = M.canon(S.data);
      if (canon === st.remoteCanon) { st.pending = false; setPhase('idle'); return { ok: true, nothing: true }; }
      setPhase('pushing');
      const day = S.data.startDay == null ? 1 : S.currentDayNumber();
      const r = await API().syncPut(M.toText(S.data), st.sha, `Kotoba · ${device()} · jour ${day}`);
      if (r.ok) {
        st.sha = r.sha || null; st.etag = null; st.remoteCanon = canon; st.lastSync = Date.now();
        st.pending = M.canon(S.data) !== canon; // modifié pendant l'envoi ?
        st.firstDirty = st.pending ? Date.now() : 0;
        setPhase('idle');
        if (st.pending) schedulePush();
        return { ok: true };
      }
      if (r.conflict) { st.known = false; continue; } // un autre appareil a écrit : on relit et on refusionne
      setPhase(r.offline ? 'offline' : 'error', r.error);
      if (r.offline) schedulePush(60e3);
      return { ok: false, error: r.error };
    }
    setPhase('error', "Envoi impossible : le dépôt change trop souvent. Réessayez dans un instant.");
    return { ok: false };
  }

  function schedulePush(delay) {
    clearTimeout(pushTimer);
    if (!st.enabled) return;
    const now = Date.now();
    if (!st.firstDirty) st.firstDirty = now;
    const wait = delay != null ? delay : Math.max(1000, Math.min(PUSH_IDLE, st.firstDirty + PUSH_MAX_WAIT - now));
    pushTimer = setTimeout(() => run(pushNow), wait);
  }

  /* ---------- Démarrage et événements ---------- */
  async function refreshStatus() {
    let s = null;
    try { s = API() && API().syncStatus ? await API().syncStatus() : null; } catch (_) { s = null; }
    st.enabled = !!(s && s.configured);
    st.config = s && s.config;
    if (!st.enabled) { clearTimeout(pushTimer); setPhase('off'); }
    return s;
  }

  const Sync = {
    status,
    onStatus(fn) { listeners.push(fn); },

    /** Au démarrage : lit le dépôt et fusionne (la page web attend ce résultat) */
    async start() {
      await refreshStatus();
      if (!st.enabled) return { ok: true, off: true };
      const r = await run(() => pullNow(true));
      if (st.pending) schedulePush(3000);
      clearInterval(pullTimer);
      pullTimer = setInterval(() => { if (!document.hidden) Sync.pull(); }, PULL_EVERY);
      return r || { ok: false };
    },

    /** Relit le dépôt (sans effet si rien n'a changé) */
    pull(force) {
      if (!st.enabled) return Promise.resolve({ ok: false });
      return run(async () => {
        const r = await pullNow(force);
        if (st.pending) schedulePush(3000);
        return r;
      });
    },

    /** Une modification a été enregistrée sur cet appareil */
    dirty(soon) {
      if (!st.enabled) return;
      st.pending = true;
      if (st.phase === 'idle' || st.phase === 'off') setPhase('idle');
      schedulePush(soon ? 1500 : null);
    },

    /** Envoie tout de suite ce qui reste à envoyer (fermeture, bouton « Synchroniser ») */
    flush() {
      clearTimeout(pushTimer);
      if (!st.enabled) return Promise.resolve({ ok: true });
      return run(async () => {
        if (!st.known) await pullNow();
        if (st.phase === 'blocked') return { ok: false };
        return pushNow();
      });
    },

    /** Synchronisation complète demandée par l'utilisateur */
    syncNow() {
      clearTimeout(pushTimer);
      return run(async () => {
        const p = await pullNow(true);
        if (!p.ok) return p;
        return pushNow();
      });
    },

    /** Connexion / changement de dépôt depuis les réglages */
    async connected() {
      st.sha = null; st.etag = null; st.known = false; st.remoteCanon = null; st.firstDirty = 0;
      const r = await this.start();
      if (r && r.ok) await this.flush();
      return r;
    },
    async disconnected() {
      clearInterval(pullTimer); clearTimeout(pushTimer);
      st.sha = null; st.etag = null; st.known = false; st.remoteCanon = null;
      await refreshStatus();
    },

    /** Restaure une version de l'historique pour tous les appareils */
    restore(text) {
      return run(async () => {
        const old = JSON.parse(text);
        if (!old || !Array.isArray(old.cards)) throw new Error('Version illisible');
        S.stampNow();
        if (API().historySave) await API().historySave(M.toText(S.data), 'avant-restauration');
        S.replace(M.restoreOver(S.data, S.migrate(old)));
        if (st.phase === 'blocked') setPhase('idle');
        if (!st.enabled) return { ok: true };
        st.known = false;
        return pushNow();
      });
    },
  };

  // retour au premier plan : on relit le dépôt ; passage en arrière-plan : on envoie
  const onVisible = () => {
    if (!st.enabled) return;
    if (!document.hidden && Date.now() - st.lastSync > 20e3) Sync.pull();
    if (document.hidden && st.pending) Sync.flush();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', () => { if (st.enabled && (st.phase === 'offline' || st.pending)) Sync.syncNow(); });

  window.Sync = Sync;
})();
