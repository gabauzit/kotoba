/* =====================================================================
   Fusion des données entre appareils (application Windows, page web)
   ---------------------------------------------------------------------
   Chaque élément (mot, structure, texte, exercice) porte une date de
   modification « updated », posée automatiquement à l'enregistrement
   (voir stamp). Une suppression laisse une « pierre tombale » dans
   data.deleted, pour qu'un autre appareil ne fasse pas réapparaître
   l'élément. Les historiques de révision (logs) sont réunis.
   Règles :
     - même élément des deux côtés : la version modifiée en dernier gagne ;
     - deux éléments différents créés avec le même numéro sur deux
       appareils : celui de cet appareil reçoit un nouveau numéro ;
     - un élément supprimé ne revient que s'il a été modifié après la
       suppression (on ne perd jamais une modification récente) ;
     - réglages et préférences : la dernière modification gagne.
   ===================================================================== */
(function (root) {
  'use strict';

  const COLLS = [
    { key: 'cards', get: d => d.cards, set: (d, v) => { d.cards = v; } },
    { key: 'grammar', get: d => d.grammar && d.grammar.items, set: (d, v) => { d.grammar = d.grammar || {}; d.grammar.items = v; } },
    { key: 'readings', get: d => d.readings, set: (d, v) => { d.readings = v; } },
    { key: 'exercises', get: d => d.exercises, set: (d, v) => { d.exercises = v; } },
  ];
  const LOGS = [
    { key: 'logs', owner: 'cards', get: d => d.logs, set: (d, v) => { d.logs = v; } },
    { key: 'glogs', owner: 'grammar', get: d => d.grammar && d.grammar.logs, set: (d, v) => { d.grammar = d.grammar || {}; d.grammar.logs = v; } },
  ];
  // clés gérées à part ; toutes les autres clés de premier niveau suivent leur date dans data.stamps
  const STRUCT = new Set(['version', 'settings', 'cards', 'logs', 'nextId', 'startDay', 'grammar', 'readings', 'exercises', 'deleted', 'stamps', 'modified']);
  const LOG_TOMB_DAYS = 120;

  const arr = (x) => Array.isArray(x) ? x : [];
  const clone = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const logKey = (l) => `${l.id}|${l.t}|${l.g}`;
  const itemJSON = (x) => JSON.stringify(Object.assign({}, x, { updated: undefined }));
  const when = (x) => (x && (x.updated || x.created)) || 0;

  /** JSON à clés triées : sert à comparer deux versions */
  function canon(x) {
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }
  const same = (a, b) => canon(a) === canon(b);

  /** Texte du fichier partagé : un élément par ligne, pour un historique lisible sur GitHub */
  function toText(data) {
    const val = (v, depth) => {
      if (Array.isArray(v) && depth <= 2 && v.length) return '[\n' + v.map(x => JSON.stringify(x)).join(',\n') + '\n]';
      if (v && typeof v === 'object' && !Array.isArray(v) && depth <= 1) {
        const ks = Object.keys(v).filter(k => v[k] !== undefined);
        if (ks.some(k => Array.isArray(v[k]) && v[k].length)) return '{\n' + ks.map(k => JSON.stringify(k) + ': ' + val(v[k], depth + 1)).join(',\n') + '\n}';
      }
      return JSON.stringify(v);
    };
    return val(data, 0) + '\n';
  }

  /* ---------------------------------------------------------------------
     Dates de modification
     --------------------------------------------------------------------- */
  /** Photographie de l'état enregistré, pour repérer ensuite ce qui a changé */
  function snapshot(data) {
    const s = { colls: {}, logs: {}, others: {}, settings: JSON.stringify(data.settings || {}) };
    for (const c of COLLS) {
      const m = new Map();
      for (const x of arr(c.get(data))) if (x && x.id != null) m.set(x.id, { json: itemJSON(x), created: x.created });
      s.colls[c.key] = m;
    }
    for (const l of LOGS) s.logs[l.key] = new Set(arr(l.get(data)).map(logKey));
    for (const k of Object.keys(data)) if (!STRUCT.has(k)) s.others[k] = JSON.stringify(data[k]);
    return s;
  }

  /** Pose les dates de modification et les pierres tombales depuis la photographie « snap ».
      Retourne true si quelque chose a changé. */
  function stamp(data, snap, now) {
    now = now || Date.now();
    if (!snap) return false;
    let changed = false;
    data.deleted = data.deleted || {};
    data.stamps = data.stamps || {};
    for (const c of COLLS) {
      const prev = snap.colls[c.key] || new Map();
      const seen = new Set();
      for (const x of arr(c.get(data))) {
        if (!x || x.id == null) continue;
        seen.add(x.id);
        const p = prev.get(x.id);
        if (!p || p.json !== itemJSON(x)) { x.updated = now; changed = true; }
      }
      for (const [id, p] of prev) {
        if (seen.has(id)) continue;
        const tomb = data.deleted[c.key] = data.deleted[c.key] || {};
        tomb[id] = { t: now, c: p.created };
        changed = true;
      }
    }
    for (const l of LOGS) {
      const prev = snap.logs[l.key] || new Set();
      const cur = new Set(arr(l.get(data)).map(logKey));
      const owners = new Set(arr((COLLS.find(c => c.key === l.owner)).get(data)).map(x => x.id));
      for (const k of prev) {
        if (cur.has(k)) continue;
        changed = true;
        // note annulée d'un élément toujours présent : on s'en souvient pour qu'elle ne revienne pas
        if (owners.has(Number(k.split('|')[0]))) { const t = data.deleted[l.key] = data.deleted[l.key] || {}; t[k] = now; }
      }
      if (cur.size !== prev.size) changed = true;
    }
    if (JSON.stringify(data.settings || {}) !== snap.settings) { data.stamps.settings = now; changed = true; }
    for (const k of Object.keys(data)) {
      if (STRUCT.has(k)) continue;
      if (JSON.stringify(data[k]) !== snap.others[k]) { data.stamps[k] = now; changed = true; }
    }
    if (changed) data.modified = now;
    return changed;
  }

  /* ---------------------------------------------------------------------
     Fusion
     --------------------------------------------------------------------- */
  function mergeTombs(a, b) {
    const out = {};
    for (const src of [a || {}, b || {}]) for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === 'object') { if (!out[k] || (out[k].t || 0) < v.t) out[k] = { t: v.t, c: v.c }; }
      else if (!out[k] || out[k] < v) out[k] = v;
    }
    return out;
  }
  const tombKills = (tomb, x) => !!tomb && (tomb.c == null || x.created == null || tomb.c === x.created) && tomb.t >= when(x);

  /**
   * Fusionne la version partagée (remote) et celle de cet appareil (local).
   * Ne modifie pas les entrées. Retourne { data, renamed: [{coll, from, to}] }.
   */
  function merge(remote, local, now) {
    remote = clone(remote || {}) || {}; local = clone(local || {}) || {};
    now = now || Date.now();
    const out = {};
    const renamed = [];
    const rs = remote.stamps || {}, ls = local.stamps || {};
    const stamps = {};

    // autres clés (préférences de lecture, d'exercices, …)
    for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      if (STRUCT.has(k)) continue;
      const lt = ls[k] || 0, rt = rs[k] || 0;
      const useLocal = (k in local) && (!(k in remote) || lt > rt);
      out[k] = useLocal ? local[k] : remote[k];
      if (lt || rt) stamps[k] = Math.max(lt, rt);
    }
    // réglages
    {
      const lt = ls.settings || 0, rt = rs.settings || 0;
      out.settings = (local.settings && (!remote.settings || lt > rt)) ? local.settings : (remote.settings || local.settings || {});
      if (lt || rt) stamps.settings = Math.max(lt, rt);
    }
    out.version = Math.max(remote.version || 1, local.version || 1);
    const sd = [remote.startDay, local.startDay].filter(x => x != null);
    out.startDay = sd.length ? Math.min(...sd) : null;
    out.modified = Math.max(remote.modified || 0, local.modified || 0) || undefined;

    // pierres tombales
    const rd = remote.deleted || {}, ld = local.deleted || {};
    const deleted = {};
    for (const k of new Set([...Object.keys(rd), ...Object.keys(ld)])) deleted[k] = mergeTombs(rd[k], ld[k]);

    // grammaire : on garde les autres champs éventuels de l'objet
    out.grammar = Object.assign({}, remote.grammar || {}, local.grammar || {});

    // --- numéros identiques pour deux éléments différents : on renumérote ceux de cet appareil
    const maxId = (list) => arr(list).reduce((m, x) => Math.max(m, Number(x && x.id) || 0), 0);
    let nextCard = Math.max(remote.nextId || 1, local.nextId || 1, maxId(remote.cards) + 1, maxId(local.cards) + 1);
    let nextGram = Math.max((remote.grammar || {}).nextId || 1, (local.grammar || {}).nextId || 1, maxId(COLLS[1].get(remote)) + 1, maxId(COLLS[1].get(local)) + 1);
    const renumber = (cKey, logDef, alloc) => {
      const coll = COLLS.find(c => c.key === cKey);
      const rItems = new Map(arr(coll.get(remote)).map(x => [x.id, x]));
      const rLogKeys = new Set(arr(logDef.get(remote)).map(logKey));
      for (const x of arr(coll.get(local))) {
        const r = rItems.get(x.id);
        if (!r || r.created == null || x.created == null || r.created === x.created) continue;
        const from = x.id, to = alloc();
        x.id = to;
        renamed.push({ coll: cKey, from, to });
        for (const l of arr(logDef.get(local))) if (l.id === from && !rLogKeys.has(logKey(l))) l.id = to;
        if (cKey === 'cards') {
          // textes créés sur cet appareil qui font référence au mot
          const rReadings = new Set(arr(remote.readings).map(r2 => r2.id));
          const rExercises = new Set(arr(remote.exercises).map(r2 => r2.id));
          const fix = (doc) => {
            if (Array.isArray(doc.targets)) doc.targets = doc.targets.map(i => i === from ? to : i);
            if (Array.isArray(doc.missing)) doc.missing = doc.missing.map(i => i === from ? to : i);
            if (doc.content) doc.content = JSON.parse(JSON.stringify(doc.content).replace(new RegExp(`\\|v${from}(?=[|\\]])`, 'g'), `|v${to}`));
          };
          arr(local.readings).filter(d => !rReadings.has(d.id)).forEach(fix);
          arr(local.exercises).filter(d => !rExercises.has(d.id)).forEach(fix);
        }
      }
    };
    renumber('cards', LOGS[0], () => nextCard++);
    renumber('grammar', LOGS[1], () => nextGram++);

    // --- éléments
    const finalIds = {};
    for (const c of COLLS) {
      const byId = new Map();
      for (const x of arr(c.get(remote))) if (x && x.id != null) byId.set(x.id, x);
      for (const x of arr(c.get(local))) {
        if (!x || x.id == null) continue;
        const r = byId.get(x.id);
        if (!r) { byId.set(x.id, x); continue; }
        const wl = when(x), wr = when(r);
        if (wl > wr || (wl === wr && JSON.stringify(x).length > JSON.stringify(r).length)) byId.set(x.id, x);
      }
      const tombs = deleted[c.key] || {};
      const list = [...byId.values()].filter(x => !tombKills(tombs[x.id], x));
      // un élément gardé malgré une pierre tombale (modifié après) : la pierre tombale ne le concerne plus
      for (const x of list) if (tombs[x.id] && (tombs[x.id].c == null || tombs[x.id].c === x.created)) delete tombs[x.id];
      list.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
      c.set(out, list);
      finalIds[c.key] = new Set(list.map(x => x.id));
    }

    // --- historiques de révision
    const limit = now - LOG_TOMB_DAYS * 86400e3;
    for (const l of LOGS) {
      const tombs = deleted[l.key] || {};
      for (const k of Object.keys(tombs)) if (tombs[k] < limit) delete tombs[k];
      const seen = new Map();
      for (const src of [arr(l.get(remote)), arr(l.get(local))]) for (const x of src) {
        const k = logKey(x);
        if (!seen.has(k) && !tombs[k] && finalIds[l.owner].has(x.id)) seen.set(k, x);
      }
      l.set(out, [...seen.values()].sort((a, b) => (a.t - b.t) || (a.id - b.id)));
    }

    out.nextId = Math.max(nextCard, maxId(out.cards) + 1);
    out.grammar.nextId = Math.max(nextGram, maxId(out.grammar.items) + 1);
    for (const k of Object.keys(deleted)) if (!Object.keys(deleted[k]).length) delete deleted[k];
    out.deleted = deleted;
    out.stamps = stamps;
    if (out.modified === undefined) delete out.modified;
    return { data: out, renamed };
  }

  /**
   * Restaure une ancienne version pour tous les appareils : les éléments de cette version
   * deviennent les plus récents, et ceux qui n'y figurent pas sont marqués supprimés.
   */
  function restoreOver(current, old, now) {
    now = now || Date.now();
    const out = clone(old) || {};
    current = current || {};
    const deleted = {};
    const cd = current.deleted || {}, od = out.deleted || {};
    for (const k of new Set([...Object.keys(cd), ...Object.keys(od)])) deleted[k] = mergeTombs(cd[k], od[k]);
    for (const c of COLLS) {
      const keep = arr(c.get(out));
      const tombs = deleted[c.key] = deleted[c.key] || {};
      const ids = new Map(keep.map(x => [x.id, x]));
      for (const x of keep) { x.updated = now; delete tombs[x.id]; }
      for (const x of arr(c.get(current))) {
        const o = ids.get(x.id);
        if (!o || (o.created != null && x.created != null && o.created !== x.created)) tombs[x.id] = { t: now, c: x.created };
      }
    }
    for (const l of LOGS) {
      const keep = new Set(arr(l.get(out)).map(logKey));
      const tombs = deleted[l.key] = deleted[l.key] || {};
      for (const k of keep) delete tombs[k];
      for (const x of arr(l.get(current))) if (!keep.has(logKey(x))) tombs[logKey(x)] = now;
    }
    out.deleted = deleted;
    out.stamps = {};
    for (const k of Object.keys(out)) if (!STRUCT.has(k)) out.stamps[k] = now;
    out.stamps.settings = now;
    out.modified = now;
    out.nextId = Math.max(out.nextId || 1, current.nextId || 1);
    out.grammar = out.grammar || {};
    out.grammar.nextId = Math.max(out.grammar.nextId || 1, (current.grammar || {}).nextId || 1);
    return out;
  }

  const api = { merge, snapshot, stamp, restoreOver, canon, same, toText, logKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KotobaMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
