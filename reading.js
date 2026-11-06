/* =====================================================================
   読解 — Compréhension écrite générée par IA (Gemini ou Claude), style JLPT
   ===================================================================== */
(function () {
  'use strict';
  const S = window.Store;
  const { NEW } = window.FSRSLib;
  const API = window.kotobaAPI;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const toast = (...a) => window.App.toast(...a);
  const Motion = window.Motion;

  /* ---------- Paramètres ---------- */
  const PROVIDERS = {
    gemini: {
      name: 'Gemini', label: 'Google Gemini — gratuit',
      keyUrl: 'https://aistudio.google.com/apikey', keyPlace: 'Collez votre clé Gemini…',
      help: `Kotoba utilise l'API Gemini avec <b>votre</b> clé gratuite. Créez-la dans <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio → Get API key</a> (compte Google, 18 ans minimum), puis collez-la ici.
        L'offre gratuite est limitée en nombre de requêtes par minute et par jour (vos quotas sont visibles dans AI Studio).`,
      models: [
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', desc: 'Recommandé : le plus récent de l\'offre gratuite' },
        { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', desc: 'Bonne alternative au 3.8' },
        { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', desc: 'Le plus rapide, textes plus simples' },
      ],
    },
    mistral: {
      name: 'Mistral', label: 'Mistral — gratuit',
      keyUrl: 'https://console.mistral.ai/api-keys', keyPlace: 'Collez votre clé Mistral…',
      help: `Kotoba utilise l'API Mistral avec <b>votre</b> clé. Créez-la dans <a href="https://console.mistral.ai/api-keys" target="_blank">Mistral Studio → API Keys</a> : l'accès gratuit (mode Free) ne demande pas de carte bancaire, avec des limites de requêtes.
        Pour que vos requêtes ne servent pas à améliorer les modèles, désactivez « Anonymous improvement data » dans <a href="https://admin.mistral.ai" target="_blank">admin.mistral.ai → Privacy</a>.`,
      models: [], // liste lue depuis l'API à la connexion de la clé
    },
    claude: {
      name: 'Claude', label: 'Claude — payant',
      keyUrl: 'https://console.anthropic.com/settings/keys', keyPlace: 'sk-ant-…',
      help: `Utilise l'API Claude avec votre clé, facturée sur votre compte de la <a href="https://console.anthropic.com/settings/keys" target="_blank">Claude Console</a> (séparément d'un abonnement claude.ai).`,
      models: [
        { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', desc: 'Rapide, très bon japonais, coût modéré' },
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', desc: 'Qualité maximale, plus cher' },
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', desc: 'Le plus rapide et le plus économique' },
      ],
    },
  };
  /* ---------- Modèles Mistral : lus depuis l'API pour la clé de l'utilisateur ---------- */
  const MISTRAL_DEFAULT = ['mistral-small-latest', 'mistral-large-latest', 'ministral-8b-latest'];
  function mistralModel(id) {
    const name = id.replace(/-latest$/, '').split('-').map(w => /^\d+b$/i.test(w) ? w.toUpperCase() : /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const desc = /small/.test(id) ? 'Rapide, bon équilibre : recommandé' : /large/.test(id) ? 'Meilleure qualité, plus lent' : /medium/.test(id) ? 'Intermédiaire' : /ministral/.test(id) ? 'Le plus léger et le plus rapide' : 'Modèle Mistral';
    return { id, name, desc };
  }
  const MODELS = [];
  function rebuildModels() {
    const ids = (S.data && S.data.settings && Array.isArray(S.data.settings.mistralModels) && S.data.settings.mistralModels.length) ? S.data.settings.mistralModels : MISTRAL_DEFAULT;
    PROVIDERS.mistral.models = ids.map(mistralModel);
    MODELS.length = 0;
    Object.entries(PROVIDERS).forEach(([p, v]) => v.models.forEach(m => MODELS.push(Object.assign({ provider: p }, m))));
  }
  rebuildModels();
  function setMistralModels(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    S.data.settings.mistralModels = ids; S.save();
    rebuildModels();
  }
  let mistralChecked = false;
  async function refreshMistralModels() {
    if (mistralChecked || !API || !API.aiListModels) return;
    mistralChecked = true;
    if (!(await API.aiKeyStatus('mistral')).hasKey) return;
    const ids = await API.aiListModels('mistral');
    if (ids && ids.length && JSON.stringify(ids) !== JSON.stringify(S.data.settings.mistralModels)) setMistralModels(ids);
  }
  const cacheTag = () => '<div class="cache-tag" title="Même demande que précédemment : réponse reprise du cache, sans nouvelle requête">⚡ réponse en cache</div>';
  const providerOf = (modelId) => (MODELS.find(m => m.id === modelId) || MODELS[0]).provider;
  const aiName = (modelId) => PROVIDERS[providerOf(modelId || prefs().model)].name;
  function modelOptions(selected) {
    rebuildModels();
    return Object.entries(PROVIDERS).map(([, v]) => `<optgroup label="${esc(v.label)}">${v.models.map(m => `<option value="${m.id}" ${selected === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</optgroup>`).join('');
  }
  const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
  const LENGTHS = { // nombre de caractères visé par niveau
    N5: { court: 150, moyen: 250, long: 400 }, N4: { court: 200, moyen: 350, long: 550 },
    N3: { court: 300, moyen: 500, long: 800 }, N2: { court: 400, moyen: 700, long: 1000 },
    N1: { court: 500, moyen: 900, long: 1300 },
  };
  const GENRES = {
    recit: 'Récit / histoire courte', dialogue: 'Dialogue', journal: 'Journal intime / blog',
    lettre: 'Lettre ou e-mail', annonce: 'Annonce, avis, mode d\'emploi', article: 'Article / chronique',
    essai: 'Essai d\'opinion', libre: "Au choix de l'IA",
  };
  const QTYPES = {
    contenu: 'Compréhension du contenu', vocabulaire: 'Sens des mots en contexte',
    grammaire: 'Grammaire en contexte', idee: 'Idée principale / intention de l\'auteur',
  };
  const QTYPE_JP = { contenu: '内容理解', vocabulaire: '語彙', grammaire: '文法', idee: '主旨' };
  const DEFAULT_PREFS = {
    level: 'N4', length: 'moyen', genre: 'recit', register: 'auto', theme: '',
    targetMode: 'travail', targetCount: 8, includeUnseen: false, repeatTargets: true,
    newWords: 'aucun', furigana: 'niveau', grammarCount: 3, grammarFocus: '',
    qCount: 5, qTypes: ['contenu', 'vocabulaire', 'grammaire'], translation: true,
    model: 'gemini-3.8-flash',
  };

  /* ---------- État ---------- */
  const st = {
    mode: 'setup',             // setup | loading | read
    targets: null,             // ids choisis pour le prochain texte
    current: null,             // lecture affichée
    tab: 'questions',
    display: { furi: true, mine: true, nouv: true, gram: true, trad: false, size: 21 },
    loading: null,
    keyStatus: null,
    askBusy: false,
  };

  function prefs() {
    if (!S.data.readingPrefs) S.data.readingPrefs = {};
    const p = Object.assign({}, DEFAULT_PREFS, S.data.readingPrefs);
    if (!MODELS.some(m => m.id === p.model)) p.model = DEFAULT_PREFS.model;
    return p;
  }
  function setPref(k, v) {
    S.data.readingPrefs = Object.assign(prefs(), { [k]: v });
    S.save();
  }
  function readings() {
    if (!Array.isArray(S.data.readings)) S.data.readings = [];
    return S.data.readings;
  }

  /* =====================================================================
     Choix des mots à travailler
     ===================================================================== */
  function pickTargets(p) {
    const ids = rankTargets(p);
    if (ids.length >= p.targetCount || p.includeUnseen) return ids;
    // pas assez de mots déjà révisés : on complète avec les mots jamais révisés (les plus anciens d'abord)
    const extra = S.data.cards.filter(c => c.fsrs.state === NEW && !ids.includes(c.id))
      .sort((a, b) => a.created - b.created).slice(0, p.targetCount - ids.length).map(c => c.id);
    return ids.concat(extra);
  }

  function rankTargets(p) {
    const today = S.today();
    let pool = S.data.cards.filter(c => p.includeUnseen || c.fsrs.state !== NEW);
    const rnd = () => Math.random();
    let scored;
    if (p.targetMode === 'difficiles') {
      scored = pool.map(c => ({ c, s: c.fsrs.state === NEW ? rnd() : (S.isDifficult(c) ? 20 : 10) + c.fsrs.difficulty + c.fsrs.lapses + rnd() }));
    } else if (p.targetMode === 'recents') {
      scored = pool.map(c => ({ c, s: c.created }));
    } else if (p.targetMode === 'hasard') {
      scored = pool.map(c => ({ c, s: rnd() }));
    } else { // à travailler : risque d'oubli + difficulté + échéance
      scored = pool.map(c => {
        if (c.fsrs.state === NEW) return { c, s: 0.9 + rnd() * 0.3 };
        const R = S.retrievabilityNow(c) ?? 1;
        const due = c.fsrs.dueDay != null && c.fsrs.dueDay <= today + 1;
        return { c, s: (1 - R) * 2 + (S.isDifficult(c) ? 1 : 0) + (due ? 0.6 : 0) + Math.min(c.fsrs.lapses, 5) * 0.1 + rnd() * 0.35 };
      });
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, p.targetCount).map(x => x.c.id);
  }

  /* =====================================================================
     Prompt et schéma
     ===================================================================== */
  const TOOL = {
    name: 'publier_lecture',
    description: 'Publie le texte de compréhension écrite, ses annotations et le questionnaire.',
    input_schema: {
      type: 'object',
      required: ['targets_used', 'title', 'title_fr', 'paragraphs', 'translation_fr', 'new_words', 'grammar_points', 'questions'],
      properties: {
        targets_used: {
          type: 'array',
          description: 'Vérification : pour CHAQUE mot ciblé, son ID et l\'extrait exact du texte où il apparaît.',
          items: { type: 'object', required: ['id', 'quote'], properties: { id: { type: 'integer' }, quote: { type: 'string' } } },
        },
        title: { type: 'string', description: 'Titre en japonais (sans balisage).' },
        title_fr: { type: 'string', description: 'Traduction française du titre (en français, jamais en japonais).' },
        paragraphs: { type: 'array', items: { type: 'string' }, description: 'Paragraphes en japonais, avec le balisage [[…|vID]], [[…|nK|lecture]] et {漢字|よみ}.' },
        translation_fr: { type: 'array', items: { type: 'string' }, description: 'Traduction française naturelle, un élément par paragraphe (tableau vide si non demandée).' },
        new_words: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'word', 'reading', 'meaning_fr'],
            properties: {
              key: { type: 'integer', description: 'Numéro K utilisé dans [[…|nK]], à partir de 1.' },
              word: { type: 'string', description: 'Forme du dictionnaire, en kanji si le mot s\'écrit normalement en kanji.' },
              reading: { type: 'string', description: 'Lecture de la forme du dictionnaire, en kana.' },
              meaning_fr: { type: 'string' },
              pos_fr: { type: 'string', description: 'Nature : nom, verbe godan, adjectif en -i, etc.' },
              jlpt: { type: 'string', description: 'Niveau JLPT estimé (N5…N1).' },
              example_jp: { type: 'string', description: 'La phrase du texte où le mot apparaît, sans balisage.' },
              example_fr: { type: 'string' },
            },
          },
        },
        grammar_points: {
          type: 'array',
          items: {
            type: 'object',
            required: ['pattern', 'quote', 'meaning_fr', 'explanation_fr'],
            properties: {
              pattern: { type: 'string', description: 'Forme générale, ex. 〜ようにする' },
              quote: { type: 'string', description: 'Extrait EXACT du texte (sans balisage) où le point apparaît.' },
              level: { type: 'string' },
              meaning_fr: { type: 'string', description: 'Sens en quelques mots.' },
              explanation_fr: { type: 'string', description: '2 à 4 phrases : usage, nuance, pièges.' },
              formation: { type: 'string', description: 'Construction, ex. V(forme dictionnaire) + ようにする' },
              examples: { type: 'array', items: { type: 'object', properties: { jp: { type: 'string' }, fr: { type: 'string' } } } },
            },
          },
        },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'question_jp', 'choices_jp', 'answer', 'explanation_fr'],
            properties: {
              type: { type: 'string', enum: ['contenu', 'vocabulaire', 'grammaire', 'idee'] },
              question_jp: { type: 'string' },
              question_fr: { type: 'string' },
              choices_jp: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
              choices_fr: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
              answer: { type: 'integer', minimum: 1, maximum: 4 },
              explanation_fr: { type: 'string', description: 'Pourquoi la bonne réponse est juste et pourquoi les autres sont fausses.' },
              evidence_quote: { type: 'string', description: 'Extrait EXACT du texte (sans balisage) qui justifie la réponse.' },
            },
          },
        },
      },
    },
  };

  function buildPrompt(p, targetIds) {
    const L = LENGTHS[p.level][p.length];
    const targets = targetIds.map(id => S.get(id)).filter(Boolean);
    const targetSet = new Set(targetIds);
    // toute la liste de l'apprenant, ordre stable (par ID) : identique d'une requête à l'autre → cache des services
    const known = S.data.cards.slice().sort((a, b) => a.id - b.id).slice(0, 2500);

    const newPolicy = {
      aucun: "AUCUN. Tous les mots de contenu (noms, verbes, adjectifs, adverbes) viennent des MOTS CIBLÉS ou de la LISTE DE L'APPRENANT. Seuls sont permis en plus : particules, auxiliaires, conjonctions, pronoms, nombres et compteurs, et un tout petit noyau de mots N5 élémentaires (する, ある, いる, なる, 行く, 来る, 人, 日, 時, 今日, 私, これ, それ, とても…). new_words doit être vide, sauf mot hors liste absolument indispensable (balisé comme nouveau mot).",
      quelques: "AU PLUS 5. Les mots de contenu viennent d'abord des MOTS CIBLÉS et de la LISTE DE L'APPRENANT. Tu peux ajouter au plus 5 mots nouveaux utiles, adaptés au niveau, chacun balisé comme nouveau mot.",
      libre: `LIBRES. Les mots ciblés restent le cœur du texte, mais tu peux utiliser le vocabulaire naturel du niveau ${p.level}. Balise comme nouveau mot ([[…|nK]]) les 15 mots hors liste les plus utiles ; les autres peuvent simplement porter des furigana.`,
    }[p.newWords];
    const furiPolicy = {
      aucun: 'Ne mets aucun furigana {…|…}. Les nouveaux mots n\'ont pas de troisième champ de lecture.',
      nouveaux: 'Furigana uniquement sur les nouveaux mots (troisième champ de [[…|nK|lecture]]). Pas de {…|…}.',
      niveau: `Furigana sur les nouveaux mots et, avec {漢字|よみ}, sur les mots en kanji au-dessus du niveau ${p.level} ou peu courants.`,
      tous: 'Furigana sur tous les mots en kanji (nouveaux mots via le troisième champ, autres via {漢字|よみ}).',
    }[p.furigana];
    const register = { auto: 'adapté au type de texte', poli: 'poli (です／ます)', neutre: 'neutre (だ／である, forme simple)' }[p.register];

    const system = `Tu es un professeur de japonais expérimenté qui rédige des épreuves de compréhension écrite (読解) dans le style du JLPT, pour un apprenant francophone.
Ta réponse est uniquement l'objet structuré demandé (champs du schéma JSON fourni), sans aucun texte autour.

BALISAGE DU TEXTE (dans "paragraphs" uniquement) :
- Chaque occurrence d'un mot des listes de l'apprenant : [[forme telle qu'écrite dans le texte|vID]] (ID numérique fourni). Le mot peut être conjugué : [[食べた|v12]]. Balise aussi les mots du vocabulaire connu quand ils apparaissent.
- Chaque occurrence d'un nouveau mot : [[forme dans le texte|nK|lecture de cette forme]] où K est sa clé dans new_words (le 3e champ est omis si les furigana ne sont pas demandés). Exemple : [[散歩して|n1|さんぽして]].
- Furigana pour un autre mot : {漢字|かんじ}.
- Ne mets JAMAIS de furigana sur les mots des listes de l'apprenant : il doit retrouver leur lecture lui-même.
- Pas d'imbrication, pas de balise à cheval sur deux mots, pas d'autre balisage (ni markdown, ni HTML).
- Respecte EXACTEMENT ce format : crochets doubles ASCII [[ ]], barre ASCII |, la lettre « v » (mot de la liste) ou « n » (nouveau mot) collée au numéro. Correct : [[約束|v7]]. Incorrect : [[約束|7]], [[約束｜v7]], ［［約束|v7］］.
- N'utilise que les ID présents dans la liste ; si un mot n'y figure pas, n'invente pas d'ID.

TITRE : "title" en japonais SANS aucun balisage ; "title_fr" = sa traduction en français.

EXIGENCES :
- Japonais naturel, idiomatique, cohérent, du niveau demandé (vocabulaire, kanji, grammaire, longueur des phrases). Ponctuation japonaise.
- PRIORITÉ ABSOLUE : le texte est construit autour des MOTS CIBLÉS. Chacun DOIT apparaître, avec exactement la graphie donnée (mêmes kanji, pas de réécriture en kana ; un verbe ou adjectif peut être conjugué), dans un contexte qui aide à en deviner le sens. Un texte où il manque un mot ciblé est refusé.
- Avant de répondre, vérifie mot par mot et remplis targets_used avec l'extrait exact où chaque mot ciblé apparaît.
- Les champs "quote" et "evidence_quote" sont des extraits recopiés à l'identique du texte SANS balisage (ce que lit l'apprenant), courts (une proposition ou une phrase).
- Questions au format JLPT : énoncé en japonais, exactement 4 choix en japonais, une seule bonne réponse, distracteurs plausibles qui reprennent des éléments du texte. Varie la position de la bonne réponse. Donne aussi la traduction française de l'énoncé et des choix.
- Explications en français, claires et pédagogiques.`;

    const lines = [];
    lines.push(`NIVEAU : JLPT ${p.level}`);
    lines.push(`LONGUEUR : environ ${L} caractères japonais (±20 %), en ${L < 300 ? '1 à 2' : L < 700 ? '2 à 4' : '3 à 6'} paragraphes.`);
    lines.push(`TYPE DE TEXTE : ${GENRES[p.genre]}${p.genre === 'dialogue' ? ' (indique le locuteur en début de réplique, ex. 田中：)' : ''}`);
    lines.push(`REGISTRE : ${register}`);
    lines.push(`THÈME : ${p.theme.trim() || 'au choix, vivant et concret, adapté aux mots ciblés'}`);
    lines.push('');
    const head = [];
    if (targets.length) {
      head.push(`MOTS CIBLÉS — ${targets.length} mots, TOUS OBLIGATOIRES${p.repeatTargets ? ', chacun deux fois si possible' : ''}. Le texte est écrit pour les faire travailler. Format ID | mot | lecture | sens :`);
      targets.forEach(c => head.push(`${c.id} | ${c.word} | ${c.reading || ''} | ${c.meaning || ''}`));
    } else {
      head.push("MOTS CIBLÉS : aucun (l'apprenant n'a pas encore de liste). Choisis un vocabulaire du niveau.");
    }
    head.push('');
    head.push(`MOTS HORS DE SA LISTE : ${newPolicy}`);
    head.push('');
    lines.unshift(...head);
    lines.splice(head.length, 0, '');
    lines.push(`FURIGANA : ${furiPolicy}`);
    lines.push('');
    lines.push(p.grammarCount > 0
      ? `GRAMMAIRE : explique ${p.grammarCount} point(s) de grammaire du niveau présents dans le texte, avec 1 ou 2 exemples supplémentaires chacun.${p.grammarFocus.trim() ? ` Le texte doit utiliser et expliquer en priorité : ${p.grammarFocus.trim()}.` : ''}`
      : 'GRAMMAIRE : grammar_points doit être un tableau vide.');
    lines.push(`QUESTIONNAIRE : ${p.qCount} questions, types : ${p.qTypes.map(t => `${t} (${QTYPES[t]})`).join(', ')}.${p.qTypes.includes('vocabulaire') && targets.length ? ' Les questions de vocabulaire portent de préférence sur les mots ciblés.' : ''}`);
    lines.push(`TRADUCTION : ${p.translation ? 'fournis translation_fr (un élément par paragraphe).' : 'translation_fr doit être un tableau vide.'}`);

    const L2 = LENGTHS[p.level][p.length];
    const provider = providerOf(p.model);
    // Gemini compte sa réflexion interne dans la limite de sortie : on lui laisse de la marge
    const maxTokens = provider === 'gemini' ? 32768 : Math.min(32000, 6000 + L2 * 6 + p.qCount * 500 + p.grammarCount * 500);
    const vocab = known.length
      ? "LISTE DE L'APPRENANT (son vocabulaire personnel, à utiliser en priorité pour le reste du texte, à baliser avec son ID ; elle contient aussi les mots ciblés) — format ID:mot :\n" + known.map(c => `${c.id}:${c.word}`).join(' ')
      : "LISTE DE L'APPRENANT : vide.";
    return {
      provider, model: p.model, maxTokens, system, cacheKey: 'kotoba-lecture-generation',
      json: { name: TOOL.name, description: TOOL.description, schema: TOOL.input_schema },
      messages: [{ role: 'user', content: [{ text: vocab, cache: true }, { text: lines.join('\n') }] }],
    };
  }

  /* =====================================================================
     Analyse du balisage
     ===================================================================== */
  const MARK_RE = /\[\[([^\[\]|]+?)\|([vn])(\d+)(?:\|([^\[\]|]*?))?\]\]|\{([^{}|]+?)\|([^{}|]+?)\}/g;

  /* ---------- Balisage tolérant ----------
     Les modèles n'écrivent pas toujours exactement [[forme|vID]] : [[forme|9]], [[forme|V9]], [[forme|id9]],
     barres ou crochets pleine largeur (｜［］｛｝), [[forme]] seul, [[forme|lecture]]… On normalise avant l'analyse. */
  const KANJI = /[\u3400-\u9FFF々]/;
  /** Le mot écrit dans le texte correspond-il bien à cette carte (même conjugué) ? */
  function formMatches(c, text) {
    if (!c || !text) return false;
    if (text.includes(c.word) || c.word.includes(text)) return true;
    if (c.reading && (text.includes(c.reading) || c.reading.includes(text))) return true;
    const kanji = [...c.word].filter(ch => KANJI.test(ch));
    if (kanji.length) return kanji.some(k => text.includes(k));
    return text.startsWith([...c.word].slice(0, 2).join(''));
  }
  /** Retrouve dans la liste la carte d'un mot écrit (forme du dictionnaire ou conjuguée) */
  function findCardByForm(text) {
    if (!text) return null;
    const cards = S.data.cards;
    const exact = cards.find(x => x.word === text) || cards.find(x => x.reading && x.reading === text && [...x.reading].length >= 2);
    if (exact) return exact;
    return cards.find(x => {
      const stem = x.word.replace(/[\u3041-\u309F]+$/, ''); // 行く → 行, 食べる → 食
      return stem && stem !== x.word && KANJI.test(stem) && text.startsWith(stem) && (text.length === stem.length || /[\u3041-\u309F]/.test(text[stem.length]));
    }) || null;
  }
  function normalizeMarkup(str) {
    let s = String(str || '')
      .replace(/［［|【【|〚/g, '[[').replace(/］］|】】|〛/g, ']]')
      .replace(/｛/g, '{').replace(/｝/g, '}');
    s = s.replace(/\{([^{}]*?)\}/g, (m, inner) => '{' + inner.replace(/｜/g, '|') + '}');
    s = s.replace(/\[\[([^\[\]]*?)\]\]/g, (m, inner) => {
      const parts = inner.replace(/｜/g, '|').split('|').map(x => x.trim());
      const form = parts[0];
      if (!form) return '';
      const tag = parts[1] || '';
      const mm = tag.match(/^(?:([vVnN])|id|ID|Id|mot|word)?\s*[:#=\-]?\s*(\d+)$/);
      if (mm) return `[[${form}|${(mm[1] || 'v').toLowerCase()}${mm[2]}${parts[2] ? '|' + parts[2] : ''}]]`;
      const c = findCardByForm(form);
      if (c) return `[[${form}|v${c.id}]]`;
      if (/^[\u3040-\u30FFー]+$/.test(tag)) return `{${form}|${tag}}`;
      return form;
    });
    return s;
  }

  function parseMarkup(str) {
    str = normalizeMarkup(str);
    const pieces = [];
    let plain = '', last = 0, m;
    const pushText = (t) => { if (!t) return; pieces.push({ type: 'text', text: t, s: plain.length, e: plain.length + t.length }); plain += t; };
    MARK_RE.lastIndex = 0;
    while ((m = MARK_RE.exec(str))) {
      pushText(str.slice(last, m.index));
      if (m[1] != null) {
        const text = m[1];
        pieces.push({ type: m[2], ref: +m[3], reading: m[4] || '', text, s: plain.length, e: plain.length + text.length });
        plain += text;
      } else {
        const text = m[5];
        pieces.push({ type: 'ruby', text, reading: m[6], s: plain.length, e: plain.length + text.length });
        plain += text;
      }
      last = MARK_RE.lastIndex;
    }
    pushText(str.slice(last));
    // référence absente ou qui ne correspond pas au mot écrit (ID inventé) : on cherche le bon mot, sinon texte simple
    for (const pc of pieces) {
      if (pc.type !== 'v') continue;
      const c = S.get(pc.ref);
      if (c && formMatches(c, pc.text)) continue;
      const alt = findCardByForm(pc.text);
      if (alt) pc.ref = alt.id; else pc.type = 'text';
    }
    return { plain, pieces };
  }

  const stripMarkup = (s) => parseMarkup(s).plain;

  function locate(parsed, quote) {
    if (!quote) return null;
    const variants = [quote, quote.replace(/^[「『（(]|[」』）)。、]$/g, ''), quote.replace(/[「」『』。、\s]/g, '')];
    for (const q of variants) {
      if (!q || q.length < 2) continue;
      for (let p = 0; p < parsed.length; p++) {
        const i = parsed[p].plain.indexOf(q);
        if (i >= 0) return { p, s: i, e: i + q.length };
      }
    }
    return null;
  }

  /** Formes à rechercher pour un mot : graphie exacte, puis radical pour les verbes/adjectifs conjugués */
  function wordForms(c) {
    const forms = [c.word];
    const hasKanji = /[\u3400-\u9FFF々]/;
    if (hasKanji.test(c.word) && /[\u3041-\u309F]$/.test(c.word)) {
      for (let cut = 1; cut <= 2; cut++) {
        const stem = [...c.word].slice(0, -cut).join('');
        if ([...stem].length >= 2 && hasKanji.test(stem)) forms.push(stem);
      }
    }
    if (c.reading && c.reading !== c.word && [...c.reading].length >= 3) forms.push(c.reading); // écrit en kana par l'IA
    return forms;
  }

  /**
   * Repère les mots de la liste (ciblés en priorité) présents dans le texte mais non balisés par l'IA,
   * et les transforme en mots surlignés. Renvoie l'ensemble des ID présents.
   */
  function tagWords(parsed, ids) {
    const found = new Set();
    parsed.forEach(pp => pp.pieces.forEach(pc => { if (pc.type === 'v') found.add(pc.ref); }));
    for (const id of ids) {
      if (found.has(id)) continue;
      const c = S.get(id); if (!c) continue;
      for (const form of wordForms(c)) {
        let hit = false;
        for (const pp of parsed) {
          const out = [];
          for (const pc of pp.pieces) {
            if (pc.type !== 'text' || !pc.text.includes(form)) { out.push(pc); continue; }
            let rest = pc.text, s0 = pc.s, i;
            while ((i = rest.indexOf(form)) >= 0) {
              if (i) out.push({ type: 'text', text: rest.slice(0, i), s: s0, e: s0 + i });
              out.push({ type: 'v', ref: id, reading: '', text: form, s: s0 + i, e: s0 + i + form.length, auto: true });
              rest = rest.slice(i + form.length); s0 += i + form.length; hit = true;
            }
            if (rest) out.push({ type: 'text', text: rest, s: s0, e: s0 + rest.length });
          }
          pp.pieces = out;
        }
        if (hit) { found.add(id); break; }
      }
    }
    return found;
  }

  /** Mots ciblés absents du texte */
  function missingTargets(content, targets) {
    const parsed = content.paragraphs.map(parseMarkup);
    const found = tagWords(parsed, targets);
    return targets.filter(id => S.get(id) && !found.has(id));
  }

  /** Prépare une lecture reçue de l'API : analyse, positions des citations, contrôles */
  function prepare(content, targets) {
    const parsed = content.paragraphs.map(parseMarkup);
    tagWords(parsed, targets || []);
    const newByKey = new Map((content.new_words || []).map(w => [w.key, w]));
    for (const pp of parsed) for (const pc of pp.pieces) if (pc.type === 'n' && !newByKey.has(pc.ref)) pc.type = pc.reading ? 'ruby' : 'text';
    const grammar = (content.grammar_points || []).map(g => Object.assign({}, g, { loc: locate(parsed, g.quote) }));
    const questions = (content.questions || [])
      .filter(q => Array.isArray(q.choices_jp) && q.choices_jp.length === 4 && q.answer >= 1 && q.answer <= 4)
      .map(q => Object.assign({}, q, { loc: locate(parsed, q.evidence_quote) }));
    const usedIds = new Set();
    parsed.forEach(pp => pp.pieces.forEach(pc => { if (pc.type === 'v') usedIds.add(pc.ref); }));
    return { parsed, newByKey, grammar, questions, usedIds };
  }

  /* =====================================================================
     Génération
     ===================================================================== */
  let progressHooked = false;
  function hookProgress() {
    if (progressHooked || !API) return;
    progressHooked = true;
    API.onAiProgress((pg) => {
      if (st.loading && pg.id === st.loading.id) { st.loading.chars = pg.chars; updateLoading(); }
      if (st.ask && pg.id === st.ask.id && pg.textDelta) st.ask.onDelta(pg.textDelta);
    });
  }

  async function generate() {
    const p = prefs();
    if (!st.targets) st.targets = pickTargets(p);
    const body = buildPrompt(p, st.targets);
    const id = 'gen-' + Date.now();
    st.mode = 'loading';
    st.loading = { id, started: Date.now(), chars: 0 };
    render();
    const timer = setInterval(updateLoading, 500);
    const res = await API.aiMessage(id, body);
    clearInterval(timer);
    st.loading = null;

    if (res.error) {
      st.mode = 'setup'; await render();
      if (!res.aborted) showError(res.error);
      return;
    }
    if (res.stop === 'max_tokens') { st.mode = 'setup'; await render(); showError('La réponse a été coupée (trop longue). Choisissez un texte plus court ou moins de questions.'); return; }
    const c = res.json;
    if (!c || !Array.isArray(c.paragraphs) || !c.paragraphs.length) { st.mode = 'setup'; await render(); showError(`Réponse incomplète ou illisible de ${aiName(p.model)}. Réessayez.`); return; }
    if (!Array.isArray(c.new_words)) c.new_words = [];
    if (!Array.isArray(c.grammar_points)) c.grammar_points = [];
    if (!Array.isArray(c.questions)) c.questions = [];
    if (!Array.isArray(c.translation_fr)) c.translation_fr = [];
    c.title = c.title || '読解';

    // Contrôle : tous les mots ciblés sont-ils dans le texte ? Sinon, une demande de correction.
    let content = c;
    let missing = missingTargets(content, st.targets);
    if (missing.length) {
      const fixed = await reviseForMissing(body, content, missing);
      if (fixed) {
        const m2 = missingTargets(fixed, st.targets);
        if (m2.length < missing.length) { content = fixed; missing = m2; }
      }
    }

    const reading = {
      id: Date.now(), day: S.today(), created: Date.now(), prefs: p, targets: st.targets.slice(),
      content, missing, answers: {}, checked: false, score: null, chat: [], added: [],
      usage: res.usage || null,
    };
    readings().push(reading);
    while (readings().length > 60) readings().shift();
    S.save();
    st.targets = null;
    openReading(reading);
  }

  /** Redemande le texte en exigeant les mots ciblés manquants. Renvoie le nouveau contenu ou null. */
  async function reviseForMissing(body, content, missing) {
    const words = missing.map(id => S.get(id)).filter(Boolean);
    const id = 'fix-' + Date.now();
    st.loading = { id, started: Date.now(), chars: 0, fixing: words.map(c => c.word) };
    renderLoading();
    const timer = setInterval(updateLoading, 500);
    const res = await API.aiMessage(id, Object.assign({}, body, {
      messages: body.messages.concat([
        { role: 'assistant', content: JSON.stringify(content) },
        { role: 'user', content: `Ce texte est refusé : il manque ${words.length} mot(s) ciblé(s) obligatoire(s) :\n${words.map(c => `${c.id} | ${c.word} | ${c.reading || ''} | ${c.meaning || ''}`).join('\n')}\n\nRéécris le texte pour intégrer naturellement CHACUN de ces mots (graphie exacte, balisé [[…|vID]]) tout en gardant les autres mots ciblés. Mets à jour toutes les autres parties (traduction, nouveaux mots, grammaire, questions, citations exactes, targets_used). Réponds avec l'objet complet.` },
      ]),
    }));
    clearInterval(timer);
    st.loading = null;
    const f = res && !res.error && res.stop !== 'max_tokens' ? res.json : null;
    if (!f || !Array.isArray(f.paragraphs) || !f.paragraphs.length) return null;
    ['new_words', 'grammar_points', 'questions', 'translation_fr'].forEach(k => { if (!Array.isArray(f[k])) f[k] = []; });
    f.title = f.title || content.title;
    return f;
  }

  function showError(msg) {
    const box = $('#rdError');
    if (box) { box.hidden = false; box.textContent = msg; box.scrollIntoView({ block: 'nearest' }); }
    else toast(msg);
  }

  function updateLoading() {
    const el = $('#rdLoadInfo');
    if (!el || !st.loading) return;
    const s = Math.round((Date.now() - st.loading.started) / 1000);
    if (st.loading.fixing) {
      const s2 = Math.round((Date.now() - st.loading.started) / 1000);
      el.innerHTML = `Ajout des mots ciblés oubliés : <b class="jp">${st.loading.fixing.map(esc).join('、')}</b>… <span class="muted">${s2} s</span>`;
      return;
    }
    const steps = [`${aiName()} réfléchit au texte`, 'Rédaction du texte', 'Annotation du vocabulaire', 'Préparation des questions', 'Relecture'];
    const step = st.loading.chars === 0 ? 0 : Math.min(4, 1 + Math.floor(st.loading.chars / 1800));
    const time = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
    el.innerHTML = `${steps[step]}… <span class="muted">${time}${st.loading.chars ? ` · ${st.loading.chars.toLocaleString('fr-FR')} caractères reçus` : ''}</span>`
      + (!st.loading.chars && s >= 45 ? `<br><span class="muted small">L'IA réfléchit avant d'écrire : rien ne s'affiche pendant cette étape, c'est normal.</span>` : '');
  }

  /* =====================================================================
     Rendu principal
     ===================================================================== */
  let rootEl = null;

  async function render(root) {
    if (root) { rootEl = root; st.animateNext = true; }
    if (!rootEl) return;
    hookProgress();
    closeFloating();
    if (!API) { rootEl.innerHTML = `<div class="empty"><p>La lecture générée n'est disponible que dans l'application Windows.</p></div>`; return; }
    rebuildModels();
    refreshMistralModels();
    st.keyStatus = await API.aiKeyStatus(providerOf(prefs().model));
    if (st.mode === 'read' && st.current) return renderReader();
    if (st.mode === 'loading') return renderLoading();
    renderSetup();
  }

  /* ---------- Connexion du compte API (réutilisée dans Réglages) ---------- */
  async function renderKeyBox(container, onChange, provider) {
    provider = provider || providerOf(prefs().model);
    const P = PROVIDERS[provider];
    const ks = await API.aiKeyStatus(provider);
    container.innerHTML = ks.hasKey
      ? `<div class="key-ok"><span class="key-dot"></span><div><b>${esc(P.name)} connecté</b>
          <span class="muted">Clé ${esc(ks.hint)} · ${ks.web ? 'mémorisée dans ce navigateur' : ks.encrypted ? 'chiffrée par Windows sur cet ordinateur' : 'stockée sans chiffrement (chiffrement système indisponible)'}</span></div>
          <button class="btn ghost" data-k="out">Déconnecter</button></div>`
      : `<div class="key-form">
          <p class="key-help">${P.help} ${API.platform === 'web' ? `La clé est vérifiée puis gardée dans ce navigateur uniquement (jamais dans le dépôt GitHub) ; elle n'est envoyée qu'au service ${esc(P.name)}.${provider === 'mistral' ? ' Remarque : Mistral peut refuser les appels faits directement depuis une page web ; dans ce cas, utilisez Gemini ici, ou Mistral dans l\'application Windows.' : ''}` : `La clé est vérifiée, chiffrée par Windows et conservée uniquement sur cet ordinateur ; elle n'est envoyée qu'au service ${esc(P.name)}.`}</p>
          <div class="key-row"><input class="input" type="password" data-k="input" placeholder="${esc(P.keyPlace)}" autocomplete="off" spellcheck="false">
          <button class="btn primary" data-k="save">Connecter</button></div>
          <div class="warn" data-k="err" hidden></div></div>`;
    const btnOut = $('[data-k="out"]', container);
    if (btnOut) btnOut.onclick = async () => {
      if (await window.App.confirmBox(`Déconnecter ${P.name} ?`, 'La clé sera effacée de cet ordinateur. Vos textes déjà générés restent disponibles.', 'Déconnecter')) {
        await API.aiClearKey(provider); toast(`${P.name} déconnecté`); onChange && onChange();
      } else onChange && onChange();
    };
    const save = $('[data-k="save"]', container);
    if (save) {
      const input = $('[data-k="input"]', container), err = $('[data-k="err"]', container);
      const go = async () => {
        save.disabled = true; save.textContent = 'Vérification…'; err.hidden = true;
        const r = await API.aiSetKey(provider, input.value);
        if (r.ok && r.models) setMistralModels(r.models);
        save.disabled = false; save.textContent = 'Connecter';
        if (!r.ok) { err.hidden = false; err.textContent = r.error; return; }
        input.value = '';
        toast(r.warning ? r.warning : `${P.name} connecté`);
        onChange && onChange();
      };
      save.onclick = go;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    }
  }

  /* ---------- Écran de configuration ---------- */
  function seg(name, options, value) {
    return `<div class="seg" data-pref="${name}">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(value) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  }

  function renderSetup() {
    const p = prefs();
    if (!st.targets) st.targets = pickTargets(p);
    const ks = st.keyStatus;
    const hist = readings().slice().reverse();
    const L = LENGTHS[p.level];

    rootEl.innerHTML = `<div class="view-head"><div><h1><span class="h-jp">読解</span>Compréhension écrite</h1>
      <p class="lead">L'IA rédige un texte de niveau JLPT avec vos mots à travailler, puis un questionnaire.</p></div></div>
      ${ks.hasKey ? '' : `<section class="rd-card key-card"><h3>Connectez ${esc(PROVIDERS[providerOf(p.model)].label.replace(' — ', ' ('))})</h3><div id="rdKey"></div>
        <p class="muted small key-alt">Vous préférez un autre service ? Choisissez un autre modèle en bas de page.</p></section>`}
      <div class="rd-setup">
        <section class="rd-card">
          <div class="rd-card-head"><h3><span class="step">1</span>Mots à travailler</h3>
            <span class="muted" id="rdTargetCount">${st.targets.length} mot${st.targets.length > 1 ? 's' : ''}</span></div>
          <div class="opt-row"><label>Sélection</label>${seg('targetMode', [['travail', 'À travailler'], ['difficiles', 'Difficiles'], ['recents', 'Récents'], ['hasard', 'Au hasard']], p.targetMode)}</div>
          <div class="opt-row"><label>Nombre</label><div class="range-wrap"><input type="range" min="0" max="20" value="${p.targetCount}" id="rdCount"><output>${p.targetCount}</output></div>
            <button class="btn ghost small" id="rdReshuffle" title="Choisir d'autres mots">↻ Autre sélection</button></div>
          <div class="chip-box" id="rdChips">${chipsHtml()}</div>
          <div class="add-word"><input class="input" id="rdAddWord" list="rdWordList" placeholder="Ajouter un mot de ma liste…" autocomplete="off">
            <datalist id="rdWordList">${S.data.cards.map(c => `<option value="${esc(c.word)}">${esc(c.reading)} — ${esc(c.meaning)}</option>`).join('')}</datalist></div>
          <div class="checks">
            <label><input type="checkbox" data-pref="includeUnseen" ${p.includeUnseen ? 'checked' : ''}> Inclure des mots jamais révisés <span class="muted small">(sinon, utilisés seulement pour compléter)</span></label>
            <label><input type="checkbox" data-pref="repeatTargets" ${p.repeatTargets ? 'checked' : ''}> Faire apparaître chaque mot plusieurs fois</label>
          </div>
        </section>

        <section class="rd-card">
          <h3><span class="step">2</span>Texte</h3>
          <div class="opt-row"><label>Niveau</label>${seg('level', LEVELS.map(l => [l, l]), p.level)}</div>
          <div class="opt-row"><label>Longueur</label>${seg('length', [['court', `Court · ${L.court}`], ['moyen', `Moyen · ${L.moyen}`], ['long', `Long · ${L.long}`]], p.length)}</div>
          <p class="muted small opt-note">Nombre de caractères japonais visé, adapté au niveau.</p>
          <div class="opt-row"><label>Type</label><select class="select grow" data-pref="genre">${Object.entries(GENRES).map(([k, v]) => `<option value="${k}" ${p.genre === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
          <div class="opt-row"><label>Registre</label><select class="select grow" data-pref="register">
              <option value="auto" ${p.register === 'auto' ? 'selected' : ''}>Selon le type</option><option value="poli" ${p.register === 'poli' ? 'selected' : ''}>Poli (です・ます)</option><option value="neutre" ${p.register === 'neutre' ? 'selected' : ''}>Neutre (だ・である)</option></select></div>
          <div class="opt-row"><label>Thème</label><input class="input grow" data-pref="theme" value="${esc(p.theme)}" placeholder="ex. un week-end à Kyoto, le travail, la cuisine… (vide = au choix)"></div>
        </section>

        <section class="rd-card">
          <h3><span class="step">3</span>Nouveaux mots et lecture</h3>
          <div class="choice-cards" data-pref="newWords">
            ${[['aucun', 'Aucun', 'Seulement mes mots et le vocabulaire de base. Idéal pour consolider.'],
               ['quelques', 'Quelques-uns', 'Jusqu\'à 5 mots nouveaux utiles, signalés et expliqués.'],
               ['libre', 'Libre', `Texte naturel de niveau ${p.level} ; les mots les plus utiles sont signalés.`]]
              .map(([v, t, d]) => `<button type="button" data-v="${v}" class="choice ${p.newWords === v ? 'on' : ''}"><b>${t}</b><span>${d}</span></button>`).join('')}
          </div>
          <div class="opt-row"><label>Furigana</label>${seg('furigana', [['aucun', 'Aucun'], ['nouveaux', 'Mots nouveaux'], ['niveau', 'Kanji au-dessus du niveau'], ['tous', 'Tous les kanji']], p.furigana)}</div>
          <p class="muted small">Vos propres mots ne reçoivent jamais de furigana : c'est à vous d'en retrouver la lecture (elle s'affiche en cliquant sur le mot).</p>
        </section>

        <section class="rd-card">
          <h3><span class="step">4</span>Grammaire et questionnaire</h3>
          <div class="opt-row"><label>Grammaire</label><div class="range-wrap"><input type="range" min="0" max="6" value="${p.grammarCount}" data-pref-range="grammarCount"><output>${p.grammarCount}</output></div><span class="muted small">points expliqués</span></div>
          <div class="opt-row"><label>À inclure</label><input class="input grow" data-pref="grammarFocus" value="${esc(p.grammarFocus)}" placeholder="facultatif : ex. 〜ようにする, 〜ばかり, conditionnel en 〜たら" lang="ja"></div>
          <div class="opt-row"><label>Questions</label><div class="range-wrap"><input type="range" min="3" max="10" value="${p.qCount}" data-pref-range="qCount"><output>${p.qCount}</output></div></div>
          <div class="checks">${Object.entries(QTYPES).map(([k, v]) => `<label><input type="checkbox" data-qtype="${k}" ${p.qTypes.includes(k) ? 'checked' : ''}> ${esc(v)} <span class="muted jp">${QTYPE_JP[k]}</span></label>`).join('')}</div>
          <div class="checks"><label><input type="checkbox" data-pref="translation" ${p.translation ? 'checked' : ''}> Préparer une traduction française (masquée par défaut)</label></div>
        </section>

        <div class="rd-generate">
          <div class="model-pick"><label for="rdModel">Modèle</label>
            <select class="select" id="rdModel">${modelOptions(p.model)}</select>
            <span class="muted small" id="rdModelDesc">${esc((MODELS.find(m => m.id === p.model) || MODELS[0]).desc)}</span></div>
          <div class="warn" id="rdError" hidden></div>
          <button class="btn primary big" id="rdGo" ${ks.hasKey ? '' : 'disabled'}>Générer le texte <kbd>Ctrl+Entrée</kbd></button>
        </div>
      </div>

      ${hist.length ? `<section class="rd-history"><h3>Textes précédents</h3><div class="hist-list">
        ${hist.map(r => `<div class="hist-item" data-id="${r.id}">
          <span class="hist-title jp">${esc(stripMarkup(r.content.title))}</span>
          <span class="muted">${esc(r.content.title_fr || '')}</span>
          <span class="hist-meta">Jour ${S.dayNumber(r.day)} · ${r.prefs.level}${r.score != null ? ` · ${r.score}/${r.content.questions.length}` : ''}</span>
          <button class="icon-btn hist-del" title="Supprimer">✕</button></div>`).join('')}</div></section>` : ''}`;

    if (!ks.hasKey) renderKeyBox($('#rdKey'), () => render());
    wireSetup();
    window.App.foldCards(rootEl, '.rd-setup > .rd-card', 'lecture', true);
    if (st.animateNext) { st.animateNext = false; Motion.stagger(rootEl, '.key-card, .rd-card, .rd-generate, .hist-item', { step: 40, max: 20 }); }
  }

  function chipsHtml() {
    if (!st.targets.length) return `<span class="muted small">${S.data.cards.length ? 'Aucun mot sélectionné : le texte utilisera un vocabulaire du niveau.' : 'Votre liste est vide : le texte utilisera un vocabulaire du niveau.'}</span>`;
    return st.targets.map(id => {
      const c = S.get(id); if (!c) return '';
      const cat = S.category(c);
      return `<span class="tchip ${S.isDifficult(c) ? 'hard' : ''}" title="${esc(c.reading)} — ${esc(c.meaning)}"><i class="pill ${cat}"></i><b class="jp">${esc(c.word)}</b><button data-rm="${id}" title="Retirer">✕</button></span>`;
    }).join('');
  }
  function refreshChips() {
    $('#rdChips').innerHTML = chipsHtml();
    $('#rdTargetCount').textContent = `${st.targets.length} mot${st.targets.length > 1 ? 's' : ''}`;
  }

  function wireSetup() {
    const root = rootEl;
    $$('.seg[data-pref]', root).forEach(sg => sg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const k = sg.dataset.pref;
      setPref(k, b.dataset.v);
      if (k === 'targetMode') { st.targets = pickTargets(prefs()); }
      renderSetup();
    }));
    $$('.choice-cards[data-pref]', root).forEach(cc => cc.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      setPref(cc.dataset.pref, b.dataset.v); renderSetup();
    }));
    $$('select[data-pref], input.input[data-pref]', root).forEach(el => el.addEventListener('change', () => setPref(el.dataset.pref, el.value)));
    $$('input[type="checkbox"][data-pref]', root).forEach(el => el.addEventListener('change', () => {
      setPref(el.dataset.pref, el.checked);
      if (el.dataset.pref === 'includeUnseen') { st.targets = pickTargets(prefs()); refreshChips(); }
    }));
    $$('input[data-qtype]', root).forEach(el => el.addEventListener('change', () => {
      const types = $$('input[data-qtype]', root).filter(x => x.checked).map(x => x.dataset.qtype);
      if (!types.length) { el.checked = true; toast('Gardez au moins un type de question'); return; }
      setPref('qTypes', types);
    }));
    $$('input[data-pref-range]', root).forEach(el => {
      el.addEventListener('input', () => { el.nextElementSibling.textContent = el.value; });
      el.addEventListener('change', () => setPref(el.dataset.prefRange, +el.value));
    });
    const count = $('#rdCount');
    count.addEventListener('input', () => { count.nextElementSibling.textContent = count.value; });
    count.addEventListener('change', () => { setPref('targetCount', +count.value); st.targets = pickTargets(prefs()); refreshChips(); });
    $('#rdReshuffle').onclick = () => { st.targets = pickTargets(prefs()); refreshChips(); };
    $('#rdChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      st.targets = st.targets.filter(id => id !== +b.dataset.rm); refreshChips();
    });
    const addW = $('#rdAddWord');
    const tryAdd = () => {
      const v = addW.value.trim(); if (!v) return;
      const c = S.data.cards.find(x => x.word === v) || S.data.cards.find(x => x.reading === v);
      if (!c) { toast('Ce mot n\'est pas dans votre liste'); return; }
      if (!st.targets.includes(c.id)) st.targets.push(c.id);
      addW.value = ''; refreshChips();
    };
    addW.addEventListener('change', tryAdd);
    addW.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(); } });
    $('#rdModel').onchange = async (e) => {
      const before = providerOf(prefs().model);
      setPref('model', e.target.value);
      $('#rdModelDesc').textContent = MODELS.find(m => m.id === e.target.value).desc;
      if (providerOf(e.target.value) !== before) render(); // autre service : afficher sa connexion
    };
    $('#rdGo').onclick = () => { if (st.keyStatus.hasKey) generate(); };
    root.querySelector('.rd-setup').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey && st.keyStatus.hasKey) { e.preventDefault(); generate(); } });
    $$('.hist-item', root).forEach(it => it.addEventListener('click', async (e) => {
      const r = readings().find(x => x.id === +it.dataset.id); if (!r) return;
      if (e.target.closest('.hist-del')) {
        if (await window.App.confirmBox('Supprimer ce texte ?', `« ${stripMarkup(r.content.title)} » sera retiré de l'historique.`, 'Supprimer')) {
          S.data.readings = readings().filter(x => x !== r); S.save();
        }
        renderSetup(); return;
      }
      openReading(r);
    }));
  }

  /* ---------- Chargement ---------- */
  function renderLoading() {
    rootEl.innerHTML = `<div class="rd-loading">
      <div class="brush"><span>読</span></div>
      <h2>${esc(aiName())} rédige votre texte</h2>
      <p id="rdLoadInfo" class="lead">Préparation…</p>
      <p class="muted small">Selon la longueur et le modèle, cela prend de 15 secondes à une minute ou deux.</p>
      <button class="btn" id="rdCancel">Annuler</button></div>`;
    updateLoading();
    $('#rdCancel').onclick = () => { if (st.loading) API.aiCancel(st.loading.id); };
  }

  /* =====================================================================
     Lecteur
     ===================================================================== */
  function openReading(r) {
    st.animateNext = true;
    st.current = r;
    st.prep = prepare(r.content, r.targets);
    st.mode = 'read';
    st.tab = 'questions';
    render();
    const m = $('.main'); if (m) m.scrollTop = 0;
  }

  function renderReader() {
    const r = st.current, c = r.content, prep = st.prep, d = st.display;
    const nNew = (c.new_words || []).length;
    rootEl.innerHTML = `<div class="rd-top">
        <button class="btn ghost" id="rdBack">← Nouveau texte</button>
        <div class="rd-meta">Jour ${S.dayNumber(r.day)} · JLPT ${r.prefs.level} · ${esc(GENRES[r.prefs.genre] || '')} · ${r.targets.length} mot${r.targets.length > 1 ? 's' : ''} ciblé${r.targets.length > 1 ? 's' : ''}</div>
      </div>
      ${(r.missing || []).filter(id => S.get(id)).length ? `<div class="rd-missing">
        <span>⚠ Mots ciblés absents du texte : <b class="jp">${r.missing.map(id => S.get(id)).filter(Boolean).map(c => esc(c.word)).join('、')}</b></span>
        <button class="btn small" id="rdRegen">Régénérer avec les mêmes mots</button></div>` : ''}
      <div class="rd-layout">
        <div class="rd-main">
          <div class="rd-toolbar" id="rdToolbar">
            ${toggle('furi', 'ふりがな', 'Furigana')}
            ${toggle('mine', '', 'Mes mots', 'mine')}
            ${nNew ? toggle('nouv', '', 'Nouveaux mots', 'nouv') : ''}
            ${prep.grammar.length ? toggle('gram', '', 'Grammaire', 'gram') : ''}
            ${(c.translation_fr || []).length ? toggle('trad', '', 'Traduction') : ''}
            <span class="tb-spacer"></span>
            <span class="tb-group"><button class="tb-btn" data-size="-1" title="Réduire le texte">A−</button><button class="tb-btn" data-size="1" title="Agrandir le texte">A+</button></span>
          </div>
          <article class="passage ${d.furi ? '' : 'hide-furi'} ${d.mine ? '' : 'hide-mine'} ${d.nouv ? '' : 'hide-nouv'} ${d.gram ? '' : 'hide-gram'} ${d.trad ? 'show-trad' : ''}" id="rdPassage" style="--rd-size:${d.size}px">
            <h2 class="p-title jp-serif">${esc(stripMarkup(c.title))}</h2>
            ${c.title_fr && /[A-Za-zÀ-ÿ]/.test(c.title_fr) && c.title_fr !== c.title ? `<p class="p-fr p-title-fr">${esc(c.title_fr)}</p>` : ''}
            ${prep.parsed.map((pp, i) => `<p class="p-jp" data-p="${i}">${renderParagraph(pp, i)}</p>${(c.translation_fr || [])[i] ? `<p class="p-fr">${esc(c.translation_fr[i])}</p>` : ''}`).join('')}
          </article>
          <p class="rd-tip muted small">Astuce : cliquez sur un mot souligné pour le détail, ou sélectionnez un passage pour demander une explication.</p>
        </div>
        <aside class="rd-panel">
          <div class="tabs" id="rdTabs">
            ${tab('questions', '問題', 'Questions', prep.questions.length)}
            ${tab('mots', '単語', 'Mots', nNew || '')}
            ${prep.grammar.length ? tab('grammaire', '文法', 'Grammaire', prep.grammar.length) : ''}
            ${tab('ask', '質問', 'Demander', '')}
          </div>
          <div class="tab-body" id="rdTabBody"></div>
        </aside>
      </div>`;
    wireReader();
    renderTab();
    if (st.animateNext) {
      st.animateNext = false;
      Motion.stagger(rootEl, '.rd-missing, .rd-toolbar, .passage, .rd-panel', { step: 70 });
      Motion.stagger(rootEl, '.p-title, .p-jp', { step: 90, delay: 140 });
    }
  }

  function toggle(key, jp, label, swatch) {
    return `<button class="tb-toggle ${st.display[key] ? 'on' : ''}" data-tg="${key}">${swatch ? `<i class="sw sw-${swatch}"></i>` : ''}${jp ? `<span class="jp">${jp}</span>` : esc(label)}</button>`;
  }
  function tab(key, jp, label, n) {
    return `<button class="tab ${st.tab === key ? 'on' : ''}" data-tab="${key}" title="${jp}">${label}${n !== '' && n != null ? ` <em>${n}</em>` : ''}</button>`;
  }

  /** Paragraphe → HTML, découpé aux bornes des points de grammaire et des citations des questions */
  function renderParagraph(pp, pi) {
    const prep = st.prep;
    const gr = prep.grammar.map((g, i) => ({ i, loc: g.loc })).filter(x => x.loc && x.loc.p === pi);
    const cuts = new Set();
    gr.forEach(x => { cuts.add(x.loc.s); cuts.add(x.loc.e); });
    prep.questions.forEach(q => { if (q.loc && q.loc.p === pi) { cuts.add(q.loc.s); cuts.add(q.loc.e); } });
    const gramAt = (s, e) => { const g = gr.find(x => s < x.loc.e && e > x.loc.s); return g ? g.i : -1; };

    let html = '';
    for (const pc of pp.pieces) {
      if (pc.type === 'text') {
        const pts = [pc.s, ...[...cuts].filter(x => x > pc.s && x < pc.e).sort((a, b) => a - b), pc.e];
        for (let k = 0; k < pts.length - 1; k++) {
          const s = pts[k], e = pts[k + 1], t = pc.text.slice(s - pc.s, e - pc.s);
          html += seg(t, s, e, gramAt(s, e));
        }
      } else {
        html += seg(null, pc.s, pc.e, gramAt(pc.s, pc.e), pc);
      }
    }
    return html;

    function seg(text, s, e, g, pc) {
      let inner;
      if (!pc) inner = esc(text);
      else if (pc.type === 'ruby') inner = `<ruby>${esc(pc.text)}<rt>${esc(pc.reading)}</rt></ruby>`;
      else if (pc.type === 'v') inner = `<span class="w w-mine" data-v="${pc.ref}">${esc(pc.text)}</span>`;
      else if (pc.type === 'n') {
        const added = st.current.added.includes(pc.ref);
        inner = `<span class="w w-new ${added ? 'added' : ''}" data-n="${pc.ref}">${pc.reading ? `<ruby>${esc(pc.text)}<rt>${esc(pc.reading)}</rt></ruby>` : esc(pc.text)}</span>`;
      }
      return `<span class="sg${g >= 0 ? ' gp' : ''}" data-s="${s}" data-e="${e}"${g >= 0 ? ` data-g="${g}"` : ''}>${inner}</span>`;
    }
  }

  function wireReader() {
    const root = rootEl;
    $('#rdBack').onclick = () => { st.mode = 'setup'; st.current = null; st.targets = null; st.animateNext = true; render(); };
    const regen = $('#rdRegen');
    if (regen) regen.onclick = () => { st.targets = st.current.targets.filter(id => S.get(id)); st.current = null; generate(); };
    $('#rdToolbar').addEventListener('click', (e) => {
      const tg = e.target.closest('[data-tg]');
      if (tg) {
        const k = tg.dataset.tg; st.display[k] = !st.display[k];
        tg.classList.toggle('on', st.display[k]);
        const cls = { furi: 'hide-furi', mine: 'hide-mine', nouv: 'hide-nouv', gram: 'hide-gram', trad: 'show-trad' }[k];
        $('#rdPassage').classList.toggle(cls, k === 'trad' ? st.display[k] : !st.display[k]);
        return;
      }
      const sz = e.target.closest('[data-size]');
      if (sz) { st.display.size = Math.max(15, Math.min(32, st.display.size + 2 * sz.dataset.size)); $('#rdPassage').style.setProperty('--rd-size', st.display.size + 'px'); }
    });
    $('#rdTabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]'); if (!t) return;
      st.tab = t.dataset.tab;
      $$('#rdTabs .tab').forEach(b => b.classList.toggle('on', b === t));
      renderTab();
    });
    const passage = $('#rdPassage');
    passage.addEventListener('click', (e) => {
      const w = e.target.closest('.w');
      if (w && !(window.getSelection().toString())) {
        if (w.dataset.v) return showWordPopover(w, 'v', +w.dataset.v);
        if (w.dataset.n) return showWordPopover(w, 'n', +w.dataset.n);
      }
      const g = e.target.closest('.gp');
      if (g && !w && st.display.gram && !(window.getSelection().toString())) return showGrammarPopover(g, +g.dataset.g);
    });
    passage.addEventListener('mouseup', () => setTimeout(showSelectionBar, 0));
    root.querySelector('.rd-layout').addEventListener('scroll', closeFloating, { passive: true });
  }

  /* ---------- Onglets ---------- */
  function renderTab() {
    const body = $('#rdTabBody'); if (!body) return;
    Motion.fadeIn(body, 4, 200);
    if (st.tab === 'questions') return renderQuestions(body);
    if (st.tab === 'mots') return renderWords(body);
    if (st.tab === 'grammaire') return renderGrammar(body);
    return renderAsk(body);
  }

  /* Questions — format JLPT */
  function renderQuestions(body) {
    const r = st.current, qs = st.prep.questions;
    if (!qs.length) { body.innerHTML = '<p class="muted pad">Aucune question.</p>'; return; }
    const checked = r.checked;
    body.innerHTML = `${checked ? `<div class="score"><b>${r.score} / ${qs.length}</b><span>${scoreMsg(r.score / qs.length)}</span><button class="btn ghost small" id="qReset">Recommencer</button></div>` : ''}
      ${qs.map((q, i) => {
        const a = r.answers[i];
        return `<div class="q ${checked ? (a === q.answer ? 'right' : 'wrong') : ''}" data-q="${i}">
          <div class="q-head"><span class="q-num">問${i + 1}</span><span class="q-type">${QTYPE_JP[q.type] || ''}</span>
            ${q.question_fr ? `<button class="q-fr-btn" data-fr="${i}" title="Afficher la traduction">FR</button>` : ''}</div>
          <div class="q-text jp">${esc(stripMarkup(q.question_jp))}</div>
          <div class="q-fr" hidden>${esc(q.question_fr || '')}</div>
          <ol class="choices">${q.choices_jp.map((ch, k) => {
            const n = k + 1;
            const cls = [a === n ? 'sel' : '', checked && n === q.answer ? 'ok' : '', checked && a === n && n !== q.answer ? 'ko' : ''].join(' ');
            return `<li><button class="choice-btn ${cls}" data-c="${n}" ${checked ? 'disabled' : ''}><span class="cnum">${n}</span><span class="jp">${esc(stripMarkup(ch))}</span>
              ${q.choices_fr && q.choices_fr[k] ? `<span class="c-fr" hidden>${esc(q.choices_fr[k])}</span>` : ''}</button></li>`;
          }).join('')}</ol>
          ${checked ? `<div class="q-expl"><b>${a === q.answer ? '✓ Bonne réponse.' : a ? `✕ La bonne réponse était la ${q.answer}.` : `Sans réponse : c'était la ${q.answer}.`}</b> ${esc(q.explanation_fr)}
            ${q.loc ? `<button class="link-btn" data-show="${i}">Voir dans le texte</button>` : ''}</div>` : ''}
        </div>`;
      }).join('')}
      ${checked ? '' : `<button class="btn primary wide" id="qCheck">Vérifier mes réponses</button>`}`;

    body.onclick = (e) => {
      const fr = e.target.closest('[data-fr]');
      if (fr) {
        const q = fr.closest('.q'); const on = fr.classList.toggle('on');
        $('.q-fr', q).hidden = !on; $$('.c-fr', q).forEach(x => x.hidden = !on); return;
      }
      const ch = e.target.closest('[data-c]');
      if (ch && !r.checked) {
        const qi = +ch.closest('.q').dataset.q;
        r.answers[qi] = +ch.dataset.c; S.save();
        $$('.choice-btn', ch.closest('.q')).forEach(b => b.classList.toggle('sel', b === ch));
        return;
      }
      const sh = e.target.closest('[data-show]');
      if (sh) return flashRange(st.prep.questions[+sh.dataset.show].loc);
      if (e.target.id === 'qCheck') {
        const missing = qs.length - Object.keys(r.answers).length;
        r.checked = true;
        r.score = qs.filter((q, i) => r.answers[i] === q.answer).length;
        S.save(); renderQuestions(body);
        body.classList.add('just-checked');
        setTimeout(() => body.classList.remove('just-checked'), 1200);
        Motion.countUp(body, '.score b', 600);
        if (missing) toast(`${missing} question${missing > 1 ? 's' : ''} sans réponse`);
        body.scrollTop = 0; return;
      }
      if (e.target.id === 'qReset') { r.checked = false; r.answers = {}; r.score = null; S.save(); renderQuestions(body); }
    };
  }
  function scoreMsg(x) {
    if (x === 1) return 'Parfait ! 満点です';
    if (x >= 0.8) return 'Très bien, よくできました';
    if (x >= 0.5) return 'Pas mal ; relisez les explications';
    return 'Texte exigeant : relisez avec la traduction';
  }

  /* Mots : nouveaux mots + mots ciblés */
  function renderWords(body) {
    const r = st.current, nw = r.content.new_words || [];
    const notAdded = nw.filter(w => !r.added.includes(w.key) && !S.findDuplicate(w.word));
    const targets = r.targets.map(id => S.get(id)).filter(Boolean);
    body.innerHTML = `${nw.length ? `<div class="pane-head"><h4>Nouveaux mots</h4>
        ${notAdded.length > 1 ? `<button class="btn small" id="addAllNew">+ Tout ajouter (${notAdded.length})</button>` : ''}</div>
      <ul class="nw-list">${nw.map(w => {
        const dup = S.findDuplicate(w.word), added = r.added.includes(w.key);
        return `<li class="nw" data-key="${w.key}">
          <div class="nw-main"><span class="nw-word jp-serif">${esc(w.word)}</span><span class="nw-read jp">${esc(w.reading)}</span>${w.jlpt ? `<span class="tag">${esc(w.jlpt)}</span>` : ''}</div>
          <div class="nw-mean">${esc(w.meaning_fr)}${w.pos_fr ? ` <span class="muted">· ${esc(w.pos_fr)}</span>` : ''}</div>
          ${w.example_jp ? `<div class="nw-ex jp">${esc(w.example_jp)}</div>` : ''}
          <div class="nw-actions">${added || dup ? `<span class="added-mark">✓ ${added ? 'Ajouté à votre vocabulaire' : 'Déjà dans votre liste'}</span>`
            : `<button class="btn small primary" data-add="${w.key}">+ Ajouter</button><button class="btn small ghost" data-edit="${w.key}">✎ Modifier puis ajouter</button>`}
            <button class="link-btn" data-find="${w.key}">Voir dans le texte</button></div>
        </li>`;
      }).join('')}</ul>` : `<p class="muted pad">Aucun mot nouveau dans ce texte${r.prefs.newWords === 'aucun' ? ' (option « Aucun »)' : ''}.</p>`}
      ${targets.length ? `<div class="pane-head"><h4>Vos mots ciblés</h4></div><ul class="tw-list">${targets.map(c => {
        const used = st.prep.usedIds.has(c.id);
        return `<li data-id="${c.id}" class="${used ? '' : 'absent'}"><span class="jp-serif tw-word">${esc(c.word)}</span>
          <span class="tw-read jp">${esc(c.reading !== c.word ? c.reading : '')}</span><span class="tw-mean">${esc(c.meaning)}</span>
          <span class="tw-state">${used ? '' : 'absent du texte'}</span></li>`;
      }).join('')}</ul>` : ''}`;

    body.onclick = (e) => {
      const a = e.target.closest('[data-add]'); if (a) return addNewWord(+a.dataset.add, false);
      const ed = e.target.closest('[data-edit]'); if (ed) return addNewWord(+ed.dataset.edit, true);
      const f = e.target.closest('[data-find]'); if (f) return flashWord('n', +f.dataset.find);
      if (e.target.id === 'addAllNew') {
        notAdded.forEach(w => addNewWord(w.key, false, true));
        toast(`${notAdded.length} mots ajoutés à votre vocabulaire`); refreshAfterAdd(); return;
      }
      const li = e.target.closest('.tw-list li'); if (li) flashWord('v', +li.dataset.id);
    };
  }

  function newWordFields(w) {
    const r = st.current;
    return {
      word: w.word, reading: w.reading, meaning: w.meaning_fr,
      examples: w.example_jp ? [{ jp: w.example_jp, fr: w.example_fr || '' }] : [],
      notes: `Rencontré dans la lecture « ${stripMarkup(r.content.title)} » (jour ${S.dayNumber(r.day)}).`,
    };
  }

  function addNewWord(key, edit, silent) {
    const r = st.current, w = (r.content.new_words || []).find(x => x.key === key);
    if (!w) return;
    if (S.findDuplicate(w.word)) { toast('Ce mot est déjà dans votre liste'); return; }
    if (edit) {
      const App = window.App;
      const box = App.openModal(`<h2>Ajouter « ${esc(w.word)} »</h2><div class="form-card" id="nwForm">${App.formHtml(newWordFields(w))}</div>
        <div class="form-actions" style="margin-top:16px"><span class="spacer"></span><button class="btn ghost" id="nwCancel">Annuler</button>
        <button class="btn primary" id="nwSave">Ajouter le mot <kbd>Ctrl+Entrée</kbd></button></div>`);
      const form = $('#nwForm', box); App.wireForm(form);
      const save = () => {
        const f = App.readForm(form);
        if (!f.word.trim()) return;
        S.addCard(f); r.added.push(key); S.save(); App.closeModal();
        toast(`« ${f.word} » ajouté à votre vocabulaire`); refreshAfterAdd();
      };
      $('#nwSave', box).onclick = save; $('#nwCancel', box).onclick = App.closeModal;
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save(); } });
      return;
    }
    S.addCard(newWordFields(w));
    r.added.push(key); S.save();
    if (!silent) { toast(`« ${w.word} » ajouté à votre vocabulaire`); refreshAfterAdd(); }
  }

  function refreshAfterAdd() {
    closeFloating();
    $$('#rdPassage .w-new').forEach(el => { if (st.current.added.includes(+el.dataset.n) && !el.classList.contains('added')) Motion.pop(el); });
    $$('#rdPassage .w-new').forEach(el => el.classList.toggle('added', st.current.added.includes(+el.dataset.n)));
    if (st.tab === 'mots') renderTab();
    window.App.renderChrome();
  }

  /* Grammaire */
  function renderGrammar(body) {
    const gs = st.prep.grammar;
    body.innerHTML = `<ul class="gr-list">${gs.map((g, i) => `<li class="gr" data-i="${i}">
        <button class="gr-head"><span class="gr-pat jp">${esc(g.pattern)}</span>${g.level ? `<span class="tag">${esc(g.level)}</span>` : ''}<span class="gr-mean">${esc(g.meaning_fr)}</span><span class="chev">›</span></button>
        <div class="gr-body" hidden>
          ${g.formation ? `<div class="gr-form"><span class="muted">Formation</span> <span class="jp">${esc(g.formation)}</span></div>` : ''}
          <p>${esc(g.explanation_fr)}</p>
          ${g.quote ? `<div class="gr-quote jp">« ${esc(g.quote)} »</div>` : ''}
          ${(g.examples || []).length ? `<ul class="gr-ex">${g.examples.map(x => `<li><div class="jp">${esc(x.jp)}</div><div class="muted">${esc(x.fr)}</div></li>`).join('')}</ul>` : ''}
          <div class="gr-actions">${g.loc ? `<button class="link-btn" data-show="${i}">Voir dans le texte</button>` : ''}
            <button class="btn small" data-deep="${i}">Approfondir avec ${esc(aiName(st.current.prefs.model))}</button></div>
        </div></li>`).join('')}</ul>`;
    body.onclick = (e) => {
      const h = e.target.closest('.gr-head');
      if (h) { const li = h.closest('.gr'); const b = $('.gr-body', li); b.hidden = !b.hidden; li.classList.toggle('open', !b.hidden); return; }
      const sh = e.target.closest('[data-show]'); if (sh) return flashRange(gs[+sh.dataset.show].loc);
      const dp = e.target.closest('[data-deep]');
      if (dp) { const g = gs[+dp.dataset.deep]; ask(`Approfondis le point de grammaire ${g.pattern} tel qu'il est utilisé dans « ${g.quote} » : nuance exacte, différences avec les formes proches, erreurs fréquentes, et deux exemples de niveau ${st.current.prefs.level}.`); }
    };
  }

  /* Questions libres à l'IA */
  function renderAsk(body) {
    const r = st.current;
    body.innerHTML = `<div class="ask">
      <div class="ask-log" id="askLog">${r.chat.length ? r.chat.map(m => msgHtml(m)).join('') : `<div class="ask-empty">
        <p>Posez une question sur le texte : un mot, une tournure, une nuance, une phrase que vous ne comprenez pas.</p>
        <div class="ask-sugg">${['Explique la structure de la première phrase', 'Quels sont les mots les plus utiles à retenir ici ?', 'Reformule le texte en japonais plus simple']
          .map(s => `<button class="sugg">${esc(s)}</button>`).join('')}</div>
        <p class="muted small">Vous pouvez aussi sélectionner un passage du texte puis choisir « Expliquer ».</p></div>`}</div>
      <div class="ask-input"><textarea class="input" id="askInput" rows="2" placeholder="Votre question sur le texte…"></textarea>
        <button class="btn primary" id="askSend" ${st.askBusy ? 'disabled' : ''}>Envoyer</button></div>
      <div class="ask-foot"><span class="muted small"><kbd>Entrée</kbd> envoyer · <kbd>Maj</kbd>+<kbd>Entrée</kbd> nouvelle ligne</span>
      ${r.chat.length ? '<button class="link-btn clear-chat" id="askClear">Effacer</button>' : ''}</div></div>`;
    const log = $('#askLog'); log.scrollTop = log.scrollHeight;
    const input = $('#askInput');
    const send = () => { const v = input.value.trim(); if (v && !st.askBusy) { input.value = ''; ask(v); } };
    $('#askSend').onclick = send;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    body.onclick = (e) => {
      const s = e.target.closest('.sugg'); if (s) return ask(s.textContent);
      if (e.target.id === 'askClear') { r.chat = []; S.save(); renderAsk(body); }
    };
  }

  function msgHtml(m) {
    return m.role === 'user'
      ? `<div class="msg user">${esc(m.text)}</div>`
      : `<div class="msg bot ${m.error ? 'err' : ''}">${m.error ? esc(m.text) : md(m.text) + (m.cached ? cacheTag() : '')}</div>`;
  }

  /** Mini-markdown : gras, italique, code, listes, sauts de ligne */
  function md(t) {
    const lines = esc(t || '').split('\n');
    let html = '', inList = false;
    for (let line of lines) {
      line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
      const li = line.match(/^\s*(?:[-•]|\d+[.)])\s+(.*)/);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      const h = line.match(/^#{1,4}\s+(.*)/);
      if (h) html += `<p class="md-h">${h[1]}</p>`;
      else if (line.trim()) html += `<p>${line}</p>`;
    }
    if (inList) html += '</ul>';
    return html;
  }

  async function ask(question) {
    if (st.askBusy) return;
    const r = st.current;

    st.tab = 'ask';
    $$('#rdTabs .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === 'ask'));
    const history = r.chat.filter(m => !m.error).slice(-8);
    r.chat.push({ role: 'user', text: question });
    const answer = { role: 'assistant', text: '' };
    r.chat.push(answer);
    st.askBusy = true;
    renderAsk($('#rdTabBody'));
    const log = $('#askLog');
    const bubble = log.lastElementChild;
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

    const c = r.content;
    const passage = c.paragraphs.map(stripMarkup).join('\n');
    const trad = (c.translation_fr || []).join('\n');
    const system = `Tu es un tuteur de japonais bienveillant et précis pour un apprenant francophone de niveau JLPT ${r.prefs.level}.
Réponds en français, de façon concise et structurée (environ 200 mots maximum sauf si on te demande plus).
Quand tu cites du japonais, ajoute la lecture en kana entre parenthèses pour les kanji au-dessus du niveau.
Mise en forme autorisée : paragraphes courts, **gras**, listes avec « - ». Pas de tableaux ni de titres.

Texte étudié — ${stripMarkup(c.title)} :
${passage}
${trad ? `\nTraduction française de référence :\n${trad}` : ''}`;
    const messages = [];
    history.forEach(m => messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
    messages.push({ role: 'user', content: question });

    const id = 'ask-' + Date.now();
    let started = false;
    st.ask = { id, onDelta: (d) => {
      answer.text += d;
      if (!started) { started = true; }
      const b = $('#askLog') && $('#askLog').lastElementChild;
      if (b) { b.innerHTML = md(answer.text); const l = $('#askLog'); l.scrollTop = l.scrollHeight; }
    } };
    // modèle du texte si sa clé est disponible, sinon le modèle par défaut
    let model = r.prefs.model;
    if (!MODELS.some(m => m.id === model) || !(await API.aiKeyStatus(providerOf(model))).hasKey) model = prefs().model;
    const res = await API.aiMessage(id, { provider: providerOf(model), model, maxTokens: providerOf(model) === 'gemini' ? 8192 : 1500, system, messages, cache: true, cacheKey: 'kotoba-lecture-' + r.id });
    st.ask = null; st.askBusy = false;
    if (res.error) { answer.text = res.error; answer.error = true; }
    else if (res.text) { answer.text = res.text; answer.cached = !!res.cached; }
    else if (!answer.text) { answer.text = 'Réponse vide. Réessayez.'; answer.error = true; }
    S.save();
    if (st.tab === 'ask' && $('#rdTabBody')) renderAsk($('#rdTabBody'));
  }

  /* ---------- Popovers ---------- */
  let floating = null;
  function closeFloating() { if (floating) { floating.remove(); floating = null; } }

  function placeFloating(el, anchorRect, above) {
    document.body.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = anchorRect.left + anchorRect.width / 2 - w / 2;
    x = Math.max(12, Math.min(window.innerWidth - w - 12, x));
    let y = above ? anchorRect.top - h - 8 : anchorRect.bottom + 8;
    if (!above && y + h > window.innerHeight - 12) y = anchorRect.top - h - 8;
    if (y < 12) y = anchorRect.bottom + 8;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    floating = el;
  }

  function showWordPopover(anchor, kind, ref) {
    closeFloating();
    const el = document.createElement('div');
    el.className = 'popover';
    if (kind === 'v') {
      const c = S.get(ref); if (!c) return;
      const R = S.retrievabilityNow(c), cat = S.category(c);
      el.innerHTML = `<div class="pop-word jp-serif">${esc(c.word)}</div>
        <div class="pop-read jp">${esc(c.reading)}</div><div class="pop-mean">${esc(c.meaning)}</div>
        <div class="pop-meta"><span class="pill ${cat}">${{ new: 'Nouveau', learning: 'Apprentissage', young: 'Jeune', mastered: 'Maîtrisé' }[cat]}</span>
        ${R != null ? `<span class="muted">rappel ${Math.round(R * 100)} %</span>` : ''}${S.isDifficult(c) ? '<span class="tag hard">difficile</span>' : ''}</div>
        <div class="pop-actions"><button class="btn small" data-open="${c.id}">Ouvrir la carte</button></div>`;
      el.querySelector('[data-open]').onclick = () => { closeFloating(); window.App.openEditor(c.id); };
    } else {
      const w = (st.current.content.new_words || []).find(x => x.key === ref); if (!w) return;
      const dup = S.findDuplicate(w.word), added = st.current.added.includes(ref);
      el.innerHTML = `<div class="pop-badge">Nouveau mot${w.jlpt ? ' · ' + esc(w.jlpt) : ''}</div>
        <div class="pop-word jp-serif">${esc(w.word)}</div><div class="pop-read jp">${esc(w.reading)}</div>
        <div class="pop-mean">${esc(w.meaning_fr)}${w.pos_fr ? ` <span class="muted">· ${esc(w.pos_fr)}</span>` : ''}</div>
        <div class="pop-actions">${added || dup ? `<span class="added-mark">✓ ${added ? 'Ajouté' : 'Déjà dans votre liste'}</span>`
          : `<button class="btn small primary" data-a="add">+ Ajouter à ma liste</button><button class="btn small ghost" data-a="edit" title="Modifier avant d'ajouter">✎</button>`}</div>`;
      const a = el.querySelector('[data-a="add"]'); if (a) a.onclick = () => addNewWord(ref, false);
      const e2 = el.querySelector('[data-a="edit"]'); if (e2) e2.onclick = () => { closeFloating(); addNewWord(ref, true); };
    }
    placeFloating(el, anchor.getBoundingClientRect(), false);
  }

  function showGrammarPopover(anchor, gi) {
    closeFloating();
    const g = st.prep.grammar[gi]; if (!g) return;
    const el = document.createElement('div');
    el.className = 'popover wide';
    el.innerHTML = `<div class="pop-badge gram">Grammaire${g.level ? ' · ' + esc(g.level) : ''}</div>
      <div class="pop-pat jp">${esc(g.pattern)}</div><div class="pop-mean">${esc(g.meaning_fr)}</div>
      <p class="pop-expl">${esc(g.explanation_fr)}</p>
      <div class="pop-actions"><button class="btn small" data-a="more">Voir le détail</button><button class="btn small ghost" data-a="deep">Approfondir avec ${esc(aiName(st.current.prefs.model))}</button></div>`;
    el.querySelector('[data-a="more"]').onclick = () => {
      closeFloating(); st.tab = 'grammaire';
      $$('#rdTabs .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === 'grammaire'));
      renderTab();
      const li = $(`#rdTabBody .gr[data-i="${gi}"]`); if (li) { $('.gr-head', li).click(); li.scrollIntoView({ block: 'nearest' }); }
    };
    el.querySelector('[data-a="deep"]').onclick = () => { closeFloating(); ask(`Approfondis le point de grammaire ${g.pattern} tel qu'il est utilisé dans « ${g.quote} » : nuance exacte, différences avec les formes proches, erreurs fréquentes, et deux exemples de niveau ${st.current.prefs.level}.`); };
    placeFloating(el, anchor.getBoundingClientRect(), false);
  }

  function showSelectionBar() {
    const sel = window.getSelection();
    const text = sel.toString().replace(/\s+/g, '').trim();
    const passage = $('#rdPassage');
    if (!text || text.length < 1 || !passage || !sel.rangeCount || !passage.contains(sel.anchorNode)) return;
    // les furigana sélectionnées sont retirées du texte cité
    const range = sel.getRangeAt(0);
    const frag = range.cloneContents();
    frag.querySelectorAll && frag.querySelectorAll('rt').forEach(n => n.remove());
    const clean = (frag.textContent || text).replace(/\s+/g, '').slice(0, 300);
    if (!clean) return;
    closeFloating();
    const el = document.createElement('div');
    el.className = 'selbar';
    el.innerHTML = `<button data-a="expl">Expliquer</button><button data-a="trad">Traduire mot à mot</button>`;
    el.onmousedown = (e) => e.preventDefault();
    el.querySelector('[data-a="expl"]').onclick = () => { closeFloating(); sel.removeAllRanges(); ask(`Explique ce passage (grammaire, sens, nuances) : « ${clean} »`); };
    el.querySelector('[data-a="trad"]').onclick = () => { closeFloating(); sel.removeAllRanges(); ask(`Traduis puis décompose mot à mot avec la lecture : « ${clean} »`); };
    placeFloating(el, range.getBoundingClientRect(), true);
  }

  document.addEventListener('mousedown', (e) => {
    if (floating && !floating.contains(e.target) && !e.target.closest('.w') && !e.target.closest('.gp')) closeFloating();
  });
  window.addEventListener('resize', closeFloating);
  document.addEventListener('scroll', closeFloating, true);

  /* ---------- Mise en évidence dans le texte ---------- */
  function flashRange(loc) {
    if (!loc) return;
    const p = $(`#rdPassage .p-jp[data-p="${loc.p}"]`); if (!p) return;
    const segs = $$('.sg', p).filter(s => +s.dataset.s >= loc.s && +s.dataset.e <= loc.e);
    flash(segs);
  }
  function flashWord(kind, ref) {
    const segs = $$(kind === 'v' ? `#rdPassage .w-mine[data-v="${ref}"]` : `#rdPassage .w-new[data-n="${ref}"]`);
    if (!segs.length) { toast('Ce mot n\'apparaît pas dans le texte'); return; }
    flash(segs);
  }
  function flash(els) {
    if (!els.length) return;
    els[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    els.forEach(s => { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); });
    setTimeout(() => els.forEach(s => s.classList.remove('flash')), 2600);
  }

  function handleEscape() {
    if (floating) { closeFloating(); return true; }
    return false;
  }

  window.Reading = {
    // outils partagés avec les onglets Écriture et Traduction
    md, wordForms, LEVELS, aiName, stripMarkup, cacheTag, refreshMistralModels,
    currentModel: () => prefs().model,
    setModel: (m) => setPref('model', m),
    _pickTargets: (p) => pickTargets(Object.assign(prefs(), p || {})), _missing: missingTargets, render, renderKeyBox, handleEscape, MODELS, PROVIDERS, providerOf, modelOptions, _parseMarkup: parseMarkup, _buildPrompt: buildPrompt };
})();
