/* =====================================================================
   Version web (GitHub Pages) : remplace le pont de l'application Windows
   ---------------------------------------------------------------------
   La page est publique mais ne contient aucune donnée : tout est dans le
   dépôt GitHub privé. À l'ouverture, un écran de verrouillage demande un
   jeton GitHub (fine-grained, limité au dépôt de données) ; sans lui, la
   page ne peut rien lire. Le jeton et les clés d'IA restent dans ce
   navigateur (localStorage si « Se souvenir de cet appareil », sinon
   seulement le temps de l'onglet).
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.KOTOBA_WEB || {};
  const GH = window.KotobaGitHub, AIC = window.KotobaAICore;

  const K = { token: 'kotoba-gh-token', cfg: 'kotoba-gh-config', data: 'kotoba-web-data', key: 'kotoba-ai-key-', aiCache: 'kotoba-ai-cache', remember: 'kotoba-remember' };
  const store = (s) => ({
    get(k) { try { return s.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { s.setItem(k, v); return true; } catch (_) { return false; } },
    del(k) { try { s.removeItem(k); } catch (_) { /* rien */ } },
  });
  let LS, SS;
  try { LS = store(window.localStorage); } catch (_) { LS = store({ getItem: () => null, setItem: () => { throw 0; }, removeItem() {} }); }
  try { SS = store(window.sessionStorage); } catch (_) { SS = LS; }
  const remember = () => LS.get(K.remember) !== '0';
  const box = () => remember() ? LS : SS;
  const get = (k) => SS.get(k) || LS.get(k);
  const put = (k, v) => { (remember() ? SS : LS).del(k); box().set(k, v); };
  const drop = (k) => { SS.del(k); LS.del(k); };

  const gh = GH.create({ fetch: (u, o) => fetch(u, o), base: CFG.githubBase || undefined });
  const ai = AIC.create({ fetch: (u, o) => fetch(u, o), browser: true, bases: CFG.aiBases || {} });

  function config() {
    let c = null;
    try { c = JSON.parse(LS.get(K.cfg) || 'null'); } catch (_) { c = null; }
    return GH.cleanConfig(c || { owner: CFG.owner, repo: CFG.repo, path: CFG.path });
  }
  const token = () => get(K.token);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ---------- Écran de verrouillage ---------- */
  let unlock;
  const unlocked = new Promise(r => { unlock = r; });
  let lockedNow = false;
  let primed = null; // première lecture du dépôt, réutilisée par la synchronisation

  const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
  function lockHTML(cfg, msg, offlineOk) {
    const known = cfg.owner && cfg.repo;
    return `<div class="lock-card" role="dialog" aria-labelledby="lockTitle">
      <div class="lock-brand"><span class="brand-mark">言</span><div><div class="brand-name" id="lockTitle">Kotoba</div><div class="brand-sub">Accès réservé</div></div></div>
      <p class="lock-lead">Vos données sont dans un dépôt GitHub privé. Saisissez votre jeton d'accès GitHub pour les ouvrir sur cet appareil.</p>
      <form id="lockForm" autocomplete="off">
        <label class="lock-repo ${known ? 'known' : ''}">Dépôt de données
          <input class="input" id="lkRepo" data-ime="latin" lang="en" value="${esc(known ? cfg.owner + '/' + cfg.repo : '')}" placeholder="propriétaire/kotoba-data" spellcheck="false" autocapitalize="off"></label>
        <label>Jeton GitHub
          <input class="input" id="lkToken" type="password" placeholder="github_pat_…" spellcheck="false" autocapitalize="off" autocomplete="off"></label>
        <label class="lock-check"><input type="checkbox" id="lkRemember" ${remember() ? 'checked' : ''}> Se souvenir de cet appareil</label>
        <div class="lock-msg ${msg ? 'bad' : ''}" id="lkMsg">${esc(msg || '')}</div>
        <button class="btn primary big" id="lkGo" type="submit">Déverrouiller</button>
        ${offlineOk ? '<button class="btn ghost" id="lkOffline" type="button">Continuer hors ligne avec la copie de cet appareil</button>' : ''}
      </form>
      <details class="sync-help"><summary>Créer un jeton</summary><ol>
        <li>Ouvrez <a href="${TOKEN_URL}" target="_blank" rel="noopener">GitHub → Fine-grained personal access tokens → Generate new token</a> (connectez-vous à GitHub si besoin).</li>
        <li><b>Repository access</b> : « Only select repositories » → uniquement le dépôt de données.</li>
        <li><b>Permissions → Contents</b> : « Read and write ». Rien d'autre.</li>
        <li>Générez, copiez le jeton (<code>github_pat_…</code>) et collez-le ici. Un jeton par appareil permet d'en révoquer un seul en cas de perte.</li>
      </ol><p>Sans ce jeton, la page ne contient et ne peut lire aucune donnée.</p></details>
    </div>`;
  }

  function showLock(msg, offlineOk) {
    let el = document.getElementById('lock');
    if (!el) { el = document.createElement('div'); el.id = 'lock'; el.className = 'lock'; document.body.appendChild(el); }
    el.innerHTML = lockHTML(config(), msg, offlineOk);
    el.hidden = false;
    document.documentElement.classList.add('locked');
    const repoIn = el.querySelector('#lkRepo');
    if (repoIn.value) el.querySelector('#lkToken').focus(); else repoIn.focus();
    el.querySelector('#lkRemember').onchange = (e) => LS.set(K.remember, e.target.checked ? '1' : '0');
    const off = el.querySelector('#lkOffline');
    if (off) off.onclick = () => finish(null);
    el.querySelector('#lockForm').onsubmit = async (e) => {
      e.preventDefault();
      const m = el.querySelector('#lkMsg'), go = el.querySelector('#lkGo');
      const cfg = GH.cleanConfig(Object.assign({}, config(), (() => { const [o, r] = repoIn.value.trim().replace(/^https?:\/\/github\.com\//i, '').split('/'); return { owner: o, repo: r }; })()));
      const problem = GH.configProblem(cfg);
      const tok = GH.cleanToken(el.querySelector('#lkToken').value);
      const tp = problem || GH.tokenProblem(tok);
      if (tp) { m.textContent = tp; m.className = 'lock-msg bad'; return; }
      go.disabled = true; m.className = 'lock-msg'; m.textContent = 'Vérification…';
      const r = await tryOpen(cfg, tok);
      go.disabled = false;
      if (!r.ok) { m.textContent = r.error; m.className = 'lock-msg bad'; return; }
      LS.set(K.cfg, JSON.stringify(cfg));
      put(K.token, tok);
      if (r.warning) alertBanner(r.warning);
      finish(r);
    };
  }
  function showLoading(text) {
    let el = document.getElementById('lock');
    if (!el) { el = document.createElement('div'); el.id = 'lock'; el.className = 'lock'; document.body.appendChild(el); }
    el.innerHTML = `<div class="lock-card lock-loading"><span class="brand-mark">言</span><p>${esc(text)}</p></div>`;
    el.hidden = false;
    document.documentElement.classList.add('locked');
  }
  function alertBanner(text) { setTimeout(() => { if (window.App) window.App.toast(text); }, 1500); }

  /** Vérifie le dépôt et lit le fichier de données */
  async function tryOpen(cfg, tok) {
    const repo = await gh.checkRepo(cfg, tok);
    if (!repo.ok) return repo;
    const r = await gh.get(cfg, tok, null);
    if (r.error) return r;
    if (r.text) { try { const d = JSON.parse(r.text); if (!d || !Array.isArray(d.cards)) throw 0; } catch (_) { return { error: 'Le fichier de données du dépôt est illisible.' }; } }
    return Object.assign({ ok: true }, r, { warning: repo.private ? null : 'Attention : ce dépôt est PUBLIC, tout le monde peut lire vos données. Rendez-le privé sur GitHub.' });
  }

  function finish(r) {
    primed = r && r.ok ? { at: Date.now(), r } : null;
    const el = document.getElementById('lock');
    if (el) { el.classList.add('leaving'); setTimeout(() => { el.hidden = true; el.classList.remove('leaving'); }, 260); }
    document.documentElement.classList.remove('locked');
    unlock();
  }

  async function startLock() {
    const tok = token(), cfg = config();
    if (!tok || GH.configProblem(cfg)) return showLock(null, false);
    showLoading('Ouverture de vos données…');
    const r = await tryOpen(cfg, tok);
    if (r.ok) return finish(r);
    if (r.auth) drop(K.token);
    showLock(r.error, !!r.offline && !!LS.get(K.data));
  }

  /* ---------- Clés d'IA et cache des réponses ---------- */
  const keyHint = (k) => k ? `${k.slice(0, 6)}…${k.slice(-4)}` : null;
  const progress = [];
  const pending = new Map();
  const CACHE_MAX = 150, CACHE_TTL = 90 * 864e5;
  function aiCache() { try { return JSON.parse(LS.get(K.aiCache) || '{}') || {}; } catch (_) { return {}; } }
  function aiCacheSave(c) {
    let keys = Object.keys(c);
    if (keys.length > CACHE_MAX) keys.sort((a, b) => c[a].u - c[b].u).slice(0, keys.length - CACHE_MAX).forEach(k => delete c[k]);
    while (!LS.set(K.aiCache, JSON.stringify(c))) { // stockage plein : on retire les plus anciennes
      keys = Object.keys(c).sort((a, b) => c[a].u - c[b].u);
      if (!keys.length) break;
      keys.slice(0, Math.max(1, Math.ceil(keys.length / 4))).forEach(k => delete c[k]);
    }
  }
  async function hash(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- Fichiers (export / import) ---------- */
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function pickFile() {
    return new Promise(resolve => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = '.json,application/json';
      i.onchange = () => { const f = i.files && i.files[0]; if (!f) return resolve(null); f.text().then(resolve, () => resolve(null)); };
      i.click();
    });
  }

  /* ---------- Pont exposé à l'application (même interface que l'application Windows) ---------- */
  window.kotobaAPI = {
    platform: 'web',

    async load() {
      await unlocked;
      try { return JSON.parse(LS.get(K.data) || 'null'); } catch (_) { return null; }
    },
    // copie locale (pour un usage hors ligne) ; si le navigateur manque de place, on s'en passe
    async save(json) { if (!lockedNow && !LS.set(K.data, json)) LS.del(K.data); return true; },
    saveSync(json) { if (!lockedNow && !LS.set(K.data, json)) LS.del(K.data); return true; },
    async dataPath() { const c = config(); return `Dépôt GitHub ${c.owner}/${c.repo} · ${c.path} (copie locale dans ce navigateur)`; },
    async openFolder() { const c = config(); window.open(`https://github.com/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/commits`, '_blank', 'noopener'); },
    async exportData(json) { download('kotoba-export.json', json); return 'kotoba-export.json'; },
    importData: () => pickFile(),

    async setFullscreen(on) {
      try { if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen(); else if (!on && document.fullscreenElement) await document.exitFullscreen(); } catch (_) { /* refusé */ }
    },
    async isFullscreen() { return !!document.fullscreenElement; },
    onFullscreen(fn) { document.addEventListener('fullscreenchange', () => fn(!!document.fullscreenElement)); },

    // --- IA : appels directs du navigateur vers le service choisi
    async aiKeyStatus(p) { const k = get(K.key + p); return { provider: p, hasKey: !!k, hint: keyHint(k), encrypted: false, web: true }; },
    async aiSetKey(p, raw) {
      if (!['gemini', 'mistral', 'claude'].includes(p)) return { ok: false, error: "Service d'IA inconnu." };
      const key = AIC.cleanKey(raw);
      const problem = AIC.keyProblem(p, key);
      if (problem) return { ok: false, error: problem };
      const v = await ai.validateKey(p, key);
      if (!v.ok) return v;
      put(K.key + p, key);
      return Object.assign({ ok: true, warning: v.warning || null, models: v.models || null }, await this.aiKeyStatus(p));
    },
    async aiClearKey(p) { drop(K.key + p); return this.aiKeyStatus(p); },
    async aiListModels(p) {
      if (p !== 'mistral') return null;
      const key = get(K.key + p); if (!key) return null;
      try { const r = await ai.mistralModels(key); return r.ok ? r.models : null; } catch (_) { return null; }
    },
    async aiMessage(id, req) {
      const p = req.provider;
      const key = get(K.key + p);
      const names = AIC.NAMES;
      if (!key) return { error: `Aucune clé ${names[p] || ''} enregistrée sur cet appareil. Connectez le service dans Réglages → Service d'IA.`, noKey: true };
      const send = (payload) => progress.forEach(fn => { try { fn(Object.assign({ id }, payload)); } catch (_) {} });
      let ck = null;
      if (req.cache) {
        ck = await hash(AIC.cacheKeyText(req));
        const c = aiCache(), e = c[ck];
        if (e && Date.now() - e.t < CACHE_TTL) {
          e.u = Date.now(); aiCacheSave(c);
          if (e.r.text && !req.json) send({ chars: e.r.text.length, textDelta: e.r.text });
          return Object.assign({}, e.r, { cached: true });
        }
      }
      const ctrl = new AbortController();
      pending.set(id, ctrl);
      let timedOut = false;
      const guard = setTimeout(() => { timedOut = true; ctrl.abort(); }, AIC.MAX_DURATION);
      try {
        const res = await ai.message(req, key, ctrl.signal, send);
        if (ck && !res.error && res.stop !== 'max_tokens' && (res.text || res.json)) {
          const c = aiCache(); c[ck] = { t: Date.now(), u: Date.now(), r: { text: res.text, json: res.json || undefined, stop: res.stop } }; aiCacheSave(c);
        }
        return res;
      } catch (e) {
        if (timedOut) return { error: `Le service n'a pas terminé sa réponse en ${AIC.MAX_DURATION / 60000} minutes. Réessayez, avec un texte plus court ou un autre modèle.` };
        if (e.name === 'AbortError' || /aborted/i.test(e.message || '')) return { error: 'Génération annulée.', aborted: true };
        return { error: AIC.networkError(e, true) };
      } finally { clearTimeout(guard); pending.delete(id); }
    },
    async aiCancel(id) { const c = pending.get(id); if (c) c.abort(); return true; },
    async aiCacheInfo() { const raw = LS.get(K.aiCache) || ''; let n = 0; try { n = Object.keys(JSON.parse(raw || '{}')).length; } catch (_) {} return { entries: n, bytes: raw.length * 2 }; },
    async aiCacheClear() { LS.del(K.aiCache); return this.aiCacheInfo(); },
    onAiProgress(fn) { progress.push(fn); },

    // --- synchronisation avec le dépôt
    async syncStatus() {
      const t = token(), cfg = config();
      return { configured: !!t && !GH.configProblem(cfg), config: cfg, hasToken: !!t, hint: t ? `${t.slice(0, 11)}…${t.slice(-4)}` : null, platform: 'web' };
    },
    async syncConnect(rawCfg, rawToken) {
      const cfg = GH.cleanConfig(rawCfg);
      const problem = GH.configProblem(cfg);
      if (problem) return { ok: false, error: problem };
      const tok = rawToken ? GH.cleanToken(rawToken) : token();
      if (rawToken) { const tp = GH.tokenProblem(tok); if (tp) return { ok: false, error: tp }; }
      const repo = await gh.checkRepo(cfg, tok);
      if (!repo.ok) return { ok: false, error: repo.error };
      LS.set(K.cfg, JSON.stringify(cfg)); put(K.token, tok);
      return Object.assign({ ok: true, private: repo.private }, await this.syncStatus());
    },
    // « Verrouiller » : on efface le jeton, les clés et la copie locale de ce navigateur
    async syncDisconnect() {
      lockedNow = true; // plus aucune écriture locale jusqu'au rechargement
      [K.token, K.data, K.aiCache, K.key + 'gemini', K.key + 'mistral', K.key + 'claude'].forEach(drop);
      return this.syncStatus();
    },
    async syncGet(etag) {
      const t = token(); if (!t) return { error: 'Appareil verrouillé.', auth: true };
      if (primed && !etag && Date.now() - primed.at < 15000) { const r = primed.r; primed = null; return r; }
      primed = null;
      const r = await gh.get(config(), t, etag || null);
      if (r.auth) setTimeout(() => location.reload(), 2500); // jeton révoqué : retour à l'écran de verrouillage
      if (r.auth) drop(K.token);
      return r;
    },
    async syncPut(text, sha, message) {
      const t = token(); if (!t) return { error: 'Appareil verrouillé.', auth: true };
      return gh.put(config(), t, text, sha, message);
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startLock);
  else startLock();
})();
