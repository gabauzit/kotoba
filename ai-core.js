/* =====================================================================
   Moteur commun d'accès aux services d'IA (Gemini, Mistral, Claude)
   Utilisé par l'application Windows (processus principal, Node) et par
   la version web (navigateur). Aucune clé n'est stockée ici : elle est
   passée à chaque appel par l'appelant.
   ===================================================================== */
(function (root) {
  'use strict';

  const MODELS = {
    gemini: (m) => ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'].includes(m),
    mistral: (m) => /^[a-z0-9][a-z0-9.\-]{2,63}$/.test(m),
    claude: (m) => ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'].includes(m),
  };
  const NAMES = { gemini: 'Gemini', mistral: 'Mistral', claude: 'Claude' };
  const GEMINI_THINKING = { 'gemini-3.8-flash': 'low', 'gemini-3.6-flash': 'low' };

  /* ---------- Format commun des messages ----------
     content : chaîne, ou tableau de parties [{ text, cache? }]. La première partie contient
     le contexte stable ; « cache: true » marque la fin du préfixe à réutiliser. */
  function partsOf(content) {
    if (Array.isArray(content)) return content.map(x => typeof x === 'string' ? { text: x } : { text: String(x.text || ''), cache: !!x.cache }).filter(x => x.text);
    return [{ text: String(content || '') }];
  }
  const joined = (content) => partsOf(content).map(x => x.text).join('\n\n');

  /* ---------- Erreurs ---------- */
  function networkError(e, browser) {
    const code = (e && e.cause && (e.cause.code || e.cause.name)) || '';
    const detail = [e && e.name !== 'Error' ? e.name : '', e && e.message, code].filter(Boolean).join(' · ');
    if (browser && /Failed to fetch|NetworkError|Load failed/i.test(detail)) return "Connexion impossible depuis la page web : vérifiez votre accès à Internet. (Si cela persiste pour ce service, il refuse peut-être les appels directs depuis un navigateur : utilisez un autre service ou l'application Windows.)";
    if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|ERR_NAME_NOT_RESOLVED|EAI_AGAIN/i.test(detail)) return `Pas de connexion Internet (${detail}).`;
    if (/ERR_PROXY|ERR_TUNNEL/i.test(detail)) return `Le proxy réseau a bloqué la requête (${detail}).`;
    if (/ERR_CERT|certificate/i.test(detail)) return `Problème de certificat de sécurité, souvent dû à un antivirus ou un proxy qui inspecte le trafic (${detail}).`;
    if (/TIMED_OUT|Timeout|ETIMEDOUT/i.test(detail)) return `Le délai de réponse a été dépassé (${detail}). Réessayez, éventuellement avec un texte plus court.`;
    return `La connexion avec le service a été interrompue (${detail || 'cause inconnue'}). Réessayez.`;
  }
  function geminiError(status, body) {
    const e = (body && body.error) || {};
    const msg = e.message || '', st = e.status || '';
    if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) return 'Clé Gemini refusée. Vérifiez-la dans Réglages → Service d\'IA.';
    if (/location is not supported|FAILED_PRECONDITION/i.test(msg + st)) return "L'API Gemini gratuite n'est pas disponible depuis votre région pour ce compte.";
    if (status === 429 || st === 'RESOURCE_EXHAUSTED') return "Quota gratuit de Gemini atteint. S'il s'agit de la limite par minute, réessayez dans une minute ; s'il s'agit de la limite par jour, elle se remet à zéro à minuit heure de Californie (8 h ou 9 h à Paris). Vous pouvez aussi essayer un autre modèle ou un autre service.";
    if (status === 403) return "Cette clé n'a pas accès à l'API Gemini (vérifiez le projet dans Google AI Studio).";
    if (status === 404) return "Ce modèle Gemini n'est pas disponible pour votre clé. Choisissez-en un autre.";
    if (status === 503 || st === 'UNAVAILABLE') return 'Les serveurs de Gemini sont surchargés. Réessayez dans quelques instants.';
    if (status >= 500) return `Erreur du service Gemini (${status}). Réessayez plus tard.`;
    return `Erreur Gemini ${status}${msg ? ' : ' + msg : ''}`;
  }
  function mistralMsg(body) {
    if (!body) return '';
    if (typeof body.message === 'string') return body.message;
    if (body.error && body.error.message) return body.error.message;
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map(d => d.msg || '').join(' ; ');
    return '';
  }
  function mistralError(status, body) {
    const msg = mistralMsg(body);
    if (status === 401) return 'Clé Mistral refusée. Vérifiez-la dans Réglages → Service d\'IA.';
    if (status === 403) return "Cette clé n'a pas accès à ce modèle Mistral.";
    if (status === 429) return 'Limite de requêtes Mistral atteinte (le mode gratuit limite le nombre de requêtes). Patientez un peu puis réessayez, ou utilisez Gemini.';
    if (status === 404 || (/model/i.test(msg) && status === 400)) return `Ce modèle Mistral n'est pas disponible pour votre clé${msg ? ` (${msg})` : ''}. Choisissez-en un autre.`;
    if (status >= 500) return `Erreur du service Mistral (${status}). Réessayez plus tard.`;
    return `Erreur Mistral ${status}${msg ? ' : ' + msg : ''}`;
  }
  function claudeError(status, body) {
    const msg = (body && body.error && body.error.message) || '';
    if (status === 401) return 'Clé Claude refusée. Vérifiez-la dans Réglages → Service d\'IA.';
    if (status === 403) return "Cette clé n'a pas accès à ce modèle ou à l'API.";
    if (status === 429) return 'Limite de requêtes atteinte. Patientez une minute puis réessayez.';
    if (status === 529 || /overloaded/i.test(msg)) return 'Les serveurs de Claude sont surchargés. Réessayez dans quelques instants.';
    if (status === 400 && /credit|balance|billing/i.test(msg)) return 'Crédit API insuffisant. Ajoutez du crédit sur console.anthropic.com (rubrique Billing).';
    if (status >= 500) return `Erreur du service (${status}). Réessayez plus tard.`;
    return `Erreur ${status}${msg ? ' : ' + msg : ''}`;
  }

  /* ---------- Clés collées ---------- */
  function cleanKey(raw) {
    return String(raw || '')
      .replace(/[​-‍⁠﻿ ]/g, '')
      .trim()
      .replace(/^["'«“‘`\s]+|["'»”’`\s]+$/g, '')
      .replace(/\s+/g, '');
  }
  function keyProblem(p, key) {
    if (!key) return 'Collez votre clé dans le champ.';
    if (key.length < 10) return 'Cette clé paraît incomplète : copiez-la en entier.';
    if (/[^\x21-\x7E]/.test(key)) return 'La clé contient des caractères inattendus (accents ou symboles). Copiez-la à nouveau avec le bouton de copie de la page.';
    if (p === 'claude' && !key.startsWith('sk-ant-')) return 'Cette clé ne ressemble pas à une clé Claude : elle doit commencer par « sk-ant- ».';
    return null;
  }

  /* ---------- Modèles Mistral disponibles ---------- */
  function pickMistralModels(data) {
    const now = Date.now();
    const list = (Array.isArray(data) ? data : []).filter(m => m && m.id)
      .filter(m => !m.capabilities || m.capabilities.completion_chat !== false)
      .filter(m => !m.deprecation || Date.parse(m.deprecation) > now)
      .map(m => m.id)
      .filter(id => /^(mistral-(small|medium|large)|ministral)/.test(id) && !/(embed|ocr|moderation|vision|audio|transcribe)/.test(id));
    const uniq = [...new Set(list)];
    const latest = uniq.filter(id => id.endsWith('-latest'));
    return (latest.length ? latest : uniq).sort((a, b) => {
      const rank = (id) => /small/.test(id) ? 0 : /large/.test(id) ? 1 : /medium/.test(id) ? 2 : 3;
      return rank(a) - rank(b) || a.localeCompare(b);
    }).slice(0, 8);
  }

  /* ---------- Outils ---------- */
  async function readSSE(response, onData) {
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
        const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (!data || data === '[DONE]') continue;
        let obj; try { obj = JSON.parse(data); } catch (_) { continue; }
        onData(obj);
      }
    }
  }
  function parseJSONText(text) {
    if (!text) return null;
    const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(t); } catch (_) {}
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
    return null;
  }
  const schemaHint = (schema) => '\n\nRéponds uniquement avec un objet JSON conforme à ce schéma :\n' + JSON.stringify(schema);
  async function jsonOf(r) { try { return await r.json(); } catch (_) { return null; } }

  /* =====================================================================
     Fabrique : create({ fetch, bases, browser })
     ===================================================================== */
  function create(opts) {
    const httpFetch = opts.fetch;
    const browser = !!opts.browser;
    const B = Object.assign({ gemini: 'https://generativelanguage.googleapis.com', mistral: 'https://api.mistral.ai', claude: 'https://api.anthropic.com' }, opts.bases || {});
    const claudeHeaders = (key) => Object.assign({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {});

    async function mistralModels(key) {
      const r = await httpFetch(`${B.mistral}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
      const b = await jsonOf(r);
      if (!r.ok) return { ok: false, status: r.status, body: b };
      return { ok: true, models: pickMistralModels(b && (b.data || b)) };
    }

    /** Vérifie une clé par une requête gratuite (liste des modèles) */
    async function validateKey(p, key) {
      try {
        if (p === 'gemini') {
          const r = await httpFetch(`${B.gemini}/v1beta/models?pageSize=1`, { headers: { 'x-goog-api-key': key } });
          if (r.ok) return { ok: true };
          const b = await jsonOf(r);
          const msg = (b && b.error && b.error.message) || '';
          const detail = msg ? ` (réponse de Google : « ${msg.slice(0, 200)} »)` : '';
          if ([400, 401].includes(r.status) || /API key|API_KEY|credential|unauthenticated/i.test(msg)) return { ok: false, error: geminiError(r.status, b) + detail };
          return { ok: true, warning: `Clé enregistrée, mais la vérification n'a pas abouti${detail}. Si la génération échoue, vérifiez la clé dans Google AI Studio.` };
        }
        if (p === 'mistral') {
          const r = await mistralModels(key);
          if (r.ok) return { ok: true, models: r.models };
          if (r.status === 401 || r.status === 403) return { ok: false, error: mistralError(r.status, r.body) };
          return { ok: true, warning: `Clé enregistrée, mais la vérification n'a pas abouti (erreur ${r.status}).` };
        }
        const r = await httpFetch(`${B.claude}/v1/models?limit=1`, { headers: claudeHeaders(key) });
        if (r.ok) return { ok: true };
        return { ok: false, error: claudeError(r.status, await jsonOf(r)) };
      } catch (e) { return { ok: false, error: networkError(e, browser) }; }
    }

    /* ---------- Gemini (cache implicite : début de requête identique) ---------- */
    async function gemini(req, key, signal, send) {
      const url = `${B.gemini}/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
      const base = { contents: req.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: partsOf(m.content).map(x => ({ text: x.text })) })) };
      if (req.system) base.systemInstruction = { parts: [{ text: req.system }] };
      const variants = req.json ? [
        (gc) => Object.assign(gc, { responseMimeType: 'application/json', responseJsonSchema: req.json.schema }),
        (gc) => Object.assign(gc, { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: req.json.schema } } }),
        (gc) => Object.assign(gc, { responseMimeType: 'application/json' }),
      ] : [(gc) => gc];
      let thinking = GEMINI_THINKING[req.model] || null;
      for (let v = 0; v < variants.length; v++) {
        const generationConfig = variants[v]({ maxOutputTokens: req.maxTokens });
        if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
        const body = Object.assign({}, base, { generationConfig });
        if (req.json && v === variants.length - 1) {
          body.contents = body.contents.slice();
          const last = body.contents[body.contents.length - 1];
          body.contents[body.contents.length - 1] = { role: last.role, parts: last.parts.concat([{ text: schemaHint(req.json.schema) }]) };
        }
        const r = await httpFetch(url, { method: 'POST', signal, headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) {
          const b = await jsonOf(r);
          const msg = (b && b.error && b.error.message) || '';
          if (r.status === 400 && thinking && /thinking/i.test(msg)) { thinking = null; v--; continue; }
          const schemaRefused = r.status === 400 && /responseJsonSchema|responseFormat|response_json_schema|response_format|Unknown name|Invalid JSON payload|schema/i.test(msg) && !/API key/i.test(msg);
          if (schemaRefused && v < variants.length - 1) continue;
          return { httpError: r.status, error: geminiError(r.status, b) };
        }
        let text = '', finish = null, usage = {}, chars = 0, blocked = null;
        await readSSE(r, (obj) => {
          if (obj.error) throw Object.assign(new Error('stream'), { apiError: obj.error });
          if (obj.promptFeedback && obj.promptFeedback.blockReason) blocked = obj.promptFeedback.blockReason;
          const cand = (obj.candidates || [])[0];
          if (cand) {
            for (const part of ((cand.content || {}).parts || [])) {
              if (part.thought || typeof part.text !== 'string') continue;
              text += part.text; chars += part.text.length;
              send({ chars, textDelta: req.json ? undefined : part.text });
            }
            if (cand.finishReason) finish = cand.finishReason;
          }
          if (obj.usageMetadata) usage = obj.usageMetadata;
        });
        if (blocked) return { error: `Gemini a refusé la demande (${blocked}). Modifiez le thème ou les options.` };
        const stop = finish === 'MAX_TOKENS' ? 'max_tokens' : ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'].includes(finish) ? 'blocked' : 'end';
        if (stop === 'blocked') return { error: `Gemini a interrompu sa réponse (${finish}). Réessayez ou changez de thème.` };
        const out = { text, stop, usage: { input: usage.promptTokenCount, output: usage.candidatesTokenCount, cached: usage.cachedContentTokenCount } };
        if (req.json) out.json = parseJSONText(text);
        return out;
      }
      return { error: 'Format de réponse non pris en charge par cette version de l\'API Gemini.' };
    }

    /* ---------- Mistral (prompt_cache_key) ---------- */
    async function mistral(req, key, signal, send) {
      const messages = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      req.messages.forEach(m => messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: joined(m.content) }));
      const variants = req.json ? [
        () => ({ response_format: { type: 'json_schema', json_schema: { name: req.json.name || 'resultat', schema: req.json.schema, strict: true } } }),
        () => ({ response_format: { type: 'json_object' }, _hint: true }),
      ] : [() => ({})];
      let cacheKey = req.cacheKey || null;
      for (let v = 0; v < variants.length; v++) {
        const extra = variants[v]();
        const msgs = messages.slice();
        if (extra._hint) { const last = msgs[msgs.length - 1]; msgs[msgs.length - 1] = { role: last.role, content: last.content + schemaHint(req.json.schema) }; delete extra._hint; }
        const body = Object.assign({ model: req.model, messages: msgs, max_tokens: req.maxTokens, stream: true }, extra);
        if (cacheKey) body.prompt_cache_key = cacheKey;
        const r = await httpFetch(`${B.mistral}/v1/chat/completions`, {
          method: 'POST', signal, body: JSON.stringify(body),
          headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'text/event-stream' },
        });
        if (!r.ok) {
          const b = await jsonOf(r);
          const msg = mistralMsg(b);
          if ((r.status === 400 || r.status === 422) && cacheKey && /prompt_cache_key/i.test(msg)) { cacheKey = null; v--; continue; }
          if ((r.status === 400 || r.status === 422) && req.json && v < variants.length - 1 && /schema|response_format|json/i.test(msg)) continue;
          return { httpError: r.status, error: mistralError(r.status, b) };
        }
        let text = '', finish = null, usage = {}, chars = 0;
        await readSSE(r, (obj) => {
          if (obj.object === 'error' || (obj.error && !obj.choices)) throw Object.assign(new Error('stream'), { apiError: { message: mistralMsg(obj) } });
          const ch = (obj.choices || [])[0];
          if (ch) {
            const c = ch.delta && ch.delta.content;
            let piece = '';
            if (typeof c === 'string') piece = c;
            else if (Array.isArray(c)) piece = c.filter(x => x && x.type === 'text' && typeof x.text === 'string').map(x => x.text).join('');
            if (piece) { text += piece; chars += piece.length; send({ chars, textDelta: req.json ? undefined : piece }); }
            if (ch.finish_reason) finish = ch.finish_reason;
          }
          if (obj.usage) usage = obj.usage;
        });
        if (finish === 'error') return { error: 'Mistral a interrompu sa réponse. Réessayez.' };
        const out = { text, stop: finish === 'length' || finish === 'model_length' ? 'max_tokens' : 'end', usage: { input: usage.prompt_tokens, output: usage.completion_tokens, cached: usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens } };
        if (req.json) out.json = parseJSONText(text);
        return out;
      }
      return { error: 'Format de réponse non pris en charge par cette version de l\'API Mistral.' };
    }

    /* ---------- Claude (cache_control) ---------- */
    async function claude(req, key, signal, send) {
      let marks = 0;
      const toBlocks = (content) => partsOf(content).map(x => {
        const b = { type: 'text', text: x.text };
        if (x.cache && marks < 3) { b.cache_control = { type: 'ephemeral' }; marks++; }
        return b;
      });
      const body = { model: req.model, max_tokens: req.maxTokens, stream: true, messages: req.messages.map(m => ({ role: m.role, content: toBlocks(m.content) })) };
      if (req.system) body.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
      if (req.json) {
        body.tools = [{ name: req.json.name, description: req.json.description || 'Publie le résultat.', input_schema: req.json.schema }];
        body.tool_choice = { type: 'tool', name: req.json.name };
      }
      const r = await httpFetch(`${B.claude}/v1/messages`, { method: 'POST', signal, body: JSON.stringify(body), headers: claudeHeaders(key) });
      if (!r.ok) return { httpError: r.status, error: claudeError(r.status, await jsonOf(r)) };
      const blocks = []; let stop = null, usage = {}, chars = 0;
      await readSSE(r, (evt) => {
        switch (evt.type) {
          case 'message_start': usage = Object.assign({}, evt.message.usage); break;
          case 'content_block_start': blocks[evt.index] = Object.assign({}, evt.content_block, { _json: '', text: evt.content_block.text || '' }); break;
          case 'content_block_delta': {
            const b = blocks[evt.index], d = evt.delta;
            if (d.type === 'text_delta') { b.text += d.text; chars += d.text.length; send({ chars, textDelta: d.text }); }
            else if (d.type === 'input_json_delta') { b._json += d.partial_json; chars += d.partial_json.length; send({ chars }); }
            break;
          }
          case 'message_delta': if (evt.delta && evt.delta.stop_reason) stop = evt.delta.stop_reason; if (evt.usage) Object.assign(usage, evt.usage); break;
          case 'error': throw Object.assign(new Error('stream'), { apiError: evt.error });
          default: break;
        }
      });
      const out = { text: blocks.filter(b => b && b.type === 'text').map(b => b.text).join(''), stop: stop === 'max_tokens' ? 'max_tokens' : 'end', usage: { input: usage.input_tokens, output: usage.output_tokens, cached: usage.cache_read_input_tokens } };
      if (req.json) { const t = blocks.find(b => b && b.type === 'tool_use'); out.json = t ? parseJSONText(t._json || '{}') : null; }
      return out;
    }

    const STREAMS = { gemini, mistral, claude };

    /** Requête complète, avec une nouvelle tentative si le service est surchargé */
    async function message(req, key, signal, send) {
      const p = req.provider;
      if (!STREAMS[p]) return { error: "Service d'IA inconnu." };
      if (!MODELS[p](req.model)) return { error: 'Modèle non pris en charge.' };
      try {
        let res = await STREAMS[p](req, key, signal, send);
        if ([503, 529].includes(res.httpError)) { await new Promise(r => setTimeout(r, 3000)); res = await STREAMS[p](req, key, signal, send); }
        return res;
      } catch (e) {
        if (e.name === 'AbortError' || /aborted/i.test(e.message || '')) throw e;
        if (e.apiError) return { error: `Erreur du service : ${e.apiError.message || e.apiError.status || e.apiError.type || 'inconnue'}` };
        return { error: networkError(e, browser) };
      }
    }

    return { message, validateKey, mistralModels };
  }

  /** Clé du cache local des réponses (empreinte stable de la requête) */
  function cacheKeyText(req) {
    return JSON.stringify({ p: req.provider, m: req.model, s: req.system || '', j: req.json ? JSON.stringify(req.json.schema) : '', msg: req.messages.map(m => [m.role, joined(m.content)]) });
  }

  const api = { create, cleanKey, keyProblem, pickMistralModels, partsOf, networkError, cacheKeyText, NAMES, MAX_DURATION: 10 * 60 * 1000 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KotobaAICore = api;
})(typeof window !== 'undefined' ? window : globalThis);
