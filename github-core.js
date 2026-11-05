/* =====================================================================
   Accès au fichier de données dans le dépôt GitHub privé
   (API REST « contents »), commun à l'application Windows et à la page web.
   Le jeton est fourni par l'appelant à chaque appel ; il n'est jamais écrit ici.
   ===================================================================== */
(function (root) {
  'use strict';

  const API = 'https://api.github.com';
  const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

  /* ---------- Encodage UTF-8 ⇄ base64 (Node et navigateur) ---------- */
  function toB64(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromB64(b64) {
    const clean = String(b64 || '').replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- Configuration ---------- */
  function cleanConfig(c) {
    c = c || {};
    let owner = String(c.owner || '').trim(), repo = String(c.repo || '').trim();
    // « propriétaire/dépôt » ou adresse complète collée dans un seul champ
    const m = (owner + (repo ? '/' + repo : '')).replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').match(/^([^/\s]+)\/([^/\s]+)/);
    if (m) { owner = m[1]; repo = m[2]; }
    const path = String(c.path || 'kotoba-data.json').trim().replace(/^\/+|\/+$/g, '') || 'kotoba-data.json';
    const branch = String(c.branch || '').trim();
    return { owner, repo, path, branch };
  }
  function configProblem(c) {
    if (!c.owner || !c.repo) return 'Indiquez le dépôt sous la forme « propriétaire/nom-du-dépôt ».';
    if (!NAME_RE.test(c.owner) || !NAME_RE.test(c.repo)) return 'Nom de dépôt invalide.';
    if (c.path.split('/').some(s => !s || s === '.' || s === '..')) return 'Chemin de fichier invalide.';
    if (c.branch && !/^[A-Za-z0-9._\/-]{1,200}$/.test(c.branch)) return 'Nom de branche invalide.';
    return null;
  }
  function cleanToken(t) {
    return String(t || '').replace(/[​-‍⁠﻿ ]/g, '').trim().replace(/^["'«“]+|["'»”]+$/g, '').replace(/\s+/g, '');
  }
  function tokenProblem(t) {
    if (!t) return 'Collez votre jeton GitHub.';
    if (/[^\x21-\x7E]/.test(t)) return 'Le jeton contient des caractères inattendus : copiez-le à nouveau.';
    if (!/^(github_pat_|ghp_|gho_|ghu_)/.test(t) || t.length < 30) return 'Ce texte ne ressemble pas à un jeton GitHub (il commence par « github_pat_ »).';
    return null;
  }

  function create(opts) {
    const httpFetch = opts.fetch;
    const base = opts.base || API;

    const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
    const headers = (token, extra) => Object.assign({
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }, extra || {});
    async function call(url, init) {
      try { return await httpFetch(url, Object.assign({ cache: 'no-store' }, init)); }
      catch (e) {
        const detail = (e && (e.message || e.name)) || '';
        return { networkError: true, status: 0, detail };
      }
    }
    async function body(r) { try { return await r.json(); } catch (_) { return null; } }

    function errorOf(status, b, what) {
      const msg = (b && b.message) || '';
      if (status === 0) return { error: 'GitHub est injoignable : vérifiez votre connexion Internet.', offline: true };
      if (status === 401) return { error: 'Jeton GitHub refusé (expiré ou révoqué). Créez-en un nouveau et saisissez-le à nouveau.', auth: true };
      if (status === 403 && /rate limit/i.test(msg)) return { error: 'Limite de requêtes GitHub atteinte. Réessayez dans quelques minutes.' };
      if (status === 403 && what === 'write') return { error: "Le jeton n'a pas le droit d'écrire dans ce dépôt : donnez-lui la permission « Contents » en lecture et écriture.", auth: true };
      if (status === 403) return { error: "Le jeton n'a pas accès à ce dépôt : vérifiez qu'il est limité à ce dépôt avec la permission « Contents ».", auth: true };
      if (status === 404) return { error: 'Dépôt introuvable, ou le jeton n\'y a pas accès. Vérifiez le nom du dépôt et les dépôts autorisés pour ce jeton.', auth: true };
      if (status >= 500) return { error: `GitHub rencontre un problème (${status}). Réessayez plus tard.` };
      return { error: `Erreur GitHub ${status}${msg ? ' : ' + msg : ''}` };
    }

    /** Vérifie le dépôt et le jeton. Retourne { ok, private, defaultBranch } ou { error } */
    async function checkRepo(cfg, token) {
      const r = await call(`${base}/repos/${enc(cfg.owner)}/${enc(cfg.repo)}`, { headers: headers(token) });
      if (r.networkError) return errorOf(0);
      const b = await body(r);
      if (!r.ok) return errorOf(r.status, b);
      return { ok: true, private: !!b.private, defaultBranch: b.default_branch || 'main', fullName: b.full_name };
    }

    /** Lit le fichier. { ok, sha, text, etag } | { ok, notModified } | { ok, notFound } | { error } */
    async function get(cfg, token, etag) {
      const q = cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : '';
      const url = `${base}/repos/${enc(cfg.owner)}/${enc(cfg.repo)}/contents/${enc(cfg.path)}${q}`;
      const r = await call(url, { headers: headers(token, etag ? { 'If-None-Match': etag } : null) });
      if (r.networkError) return errorOf(0);
      if (r.status === 304) return { ok: true, notModified: true };
      const b = await body(r);
      if (r.status === 404) {
        // fichier absent, ou dépôt inaccessible ?
        const repo = await checkRepo(cfg, token);
        if (repo.ok) return { ok: true, notFound: true, private: repo.private };
        return repo;
      }
      if (!r.ok) return errorOf(r.status, b);
      if (Array.isArray(b) || b.type !== 'file') return { error: `« ${cfg.path} » n'est pas un fichier dans ce dépôt.` };
      let content = b.content;
      if (b.encoding !== 'base64' || !content) {
        // fichier de plus de 1 Mo : on le lit par son identifiant (blob)
        const rb = await call(`${base}/repos/${enc(cfg.owner)}/${enc(cfg.repo)}/git/blobs/${b.sha}`, { headers: headers(token) });
        if (rb.networkError) return errorOf(0);
        const bb = await body(rb);
        if (!rb.ok) return errorOf(rb.status, bb);
        content = bb.content;
      }
      const etagOut = r.headers && r.headers.get ? r.headers.get('etag') : null;
      return { ok: true, sha: b.sha, text: fromB64(content), etag: etagOut };
    }

    /** Écrit le fichier (nouvelle version). { ok, sha } | { conflict } | { error } */
    async function put(cfg, token, text, sha, message) {
      const url = `${base}/repos/${enc(cfg.owner)}/${enc(cfg.repo)}/contents/${enc(cfg.path)}`;
      const payload = { message: message || 'Mise à jour des données Kotoba', content: toB64(text) };
      if (sha) payload.sha = sha;
      if (cfg.branch) payload.branch = cfg.branch;
      const r = await call(url, { method: 'PUT', headers: headers(token, { 'content-type': 'application/json' }), body: JSON.stringify(payload) });
      if (r.networkError) return errorOf(0);
      const b = await body(r);
      if (r.status === 409 || (r.status === 422 && /sha/i.test((b && b.message) || ''))) return { conflict: true };
      if (!r.ok) return errorOf(r.status, b, 'write');
      return { ok: true, sha: b && b.content && b.content.sha };
    }

    return { checkRepo, get, put };
  }

  const api = { create, cleanConfig, configProblem, cleanToken, tokenProblem, toB64, fromB64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KotobaGitHub = api;
})(typeof window !== 'undefined' ? window : globalThis);
