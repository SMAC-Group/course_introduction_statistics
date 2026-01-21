// Netlify Function - Scaffolded AI Tutor for Statistics Course
// Implements pedagogical scaffolding with modular prompt blocks

// ============================================================================
// OPTIMIZED CONTENT LOADING - Index + Individual Slides
// ============================================================================

// Cache for index and recently accessed slides
let cachedIndex = null;
const slideCache = new Map();
const SLIDE_CACHE_MAX_SIZE = 20;

/**
 * Load the course index (lite version - titles only)
 * ~3,900 tokens instead of ~37,000
 */
async function loadIndex(baseUrl) {
  if (cachedIndex) return cachedIndex;
  try {
    const response = await fetch(`${baseUrl}/content/index-lite.json`);
    if (response.ok) {
      cachedIndex = await response.json();
    } else {
      cachedIndex = { semaines: {} };
    }
  } catch (e) {
    console.error('Failed to load index-lite.json:', e);
    cachedIndex = { semaines: {} };
  }
  return cachedIndex;
}

/**
 * Load a specific slide content
 * ~100-300 tokens per slide
 */
async function loadSlide(baseUrl, semaine, slideNum) {
  const cacheKey = `${semaine}_${slideNum}`;

  if (slideCache.has(cacheKey)) {
    return slideCache.get(cacheKey);
  }

  try {
    const response = await fetch(`${baseUrl}/content/semaine_${semaine}/slide_${slideNum}.json`);
    if (response.ok) {
      const data = await response.json();

      // Manage cache size
      if (slideCache.size >= SLIDE_CACHE_MAX_SIZE) {
        const firstKey = slideCache.keys().next().value;
        slideCache.delete(firstKey);
      }

      slideCache.set(cacheKey, data);
      return data;
    }
  } catch (e) {
    console.error(`Failed to load slide ${slideNum} from semaine ${semaine}:`, e);
  }
  return null;
}

/**
 * Find which week contains a specific slide number
 * Lite index format: week.s = [[n, "title"], ...]
 */
function findSlideWeek(index, slideNum) {
  for (const [weekNum, week] of Object.entries(index.semaines)) {
    const slide = week.s.find(s => s[0] === slideNum);
    if (slide) {
      return { weekNum, weekTitle: week.t, slideNum: slide[0], slideTitle: slide[1] };
    }
  }
  return null;
}

/**
 * Find slides matching keywords from a question
 * Lite index format: week.s = [[n, "title"], ...], week.t = "Week title"
 */
function findRelevantSlides(index, question) {
  const questionLower = question.toLowerCase();
  const questionWords = questionLower.split(/\s+/).filter(w => w.length > 3);
  const matches = [];

  for (const [weekNum, week] of Object.entries(index.semaines)) {
    // Score based on week title
    let weekTitleScore = 0;
    const weekTitleLower = week.t.toLowerCase();
    for (const word of questionWords) {
      if (weekTitleLower.includes(word)) {
        weekTitleScore += 2;
      }
    }

    for (const slide of week.s) {
      const slideNum = slide[0];
      const slideTitle = slide[1];
      const titleLower = slideTitle.toLowerCase();
      let score = weekTitleScore; // Inherit week score

      // Check title words
      for (const word of questionWords) {
        if (titleLower.includes(word)) {
          score += 3;
        }
      }

      // Exact or partial title match
      if (questionLower.includes(titleLower) || titleLower.includes(questionLower)) {
        score += 5;
      }

      if (score > 0) {
        matches.push({
          weekNum,
          weekTitle: week.t,
          slideNum,
          slideTitle,
          score
        });
      }
    }
  }

  // Sort by score and return top matches
  return matches.sort((a, b) => b.score - a.score).slice(0, 3);
}

/**
 * Build slide index string from index data
 * Lite index format: week.s = [[n, "title"], ...], week.t = "Week title"
 */
function buildSlideIndexFromIndex(index) {
  let result = '';
  for (const [weekNum, week] of Object.entries(index.semaines)) {
    result += `\n### Semaine ${weekNum} - ${week.t}\n`;
    for (const slide of week.s) {
      result += `### SLIDE ${slide[0]} : ${slide[1]}\n`;
    }
  }
  return result;
}

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 15;
const MAX_MESSAGE_LENGTH = 1000;

// ============================================================================
// OPTIMISATION: Détection précoce et réponses sans appel API
// ============================================================================

/**
 * Réponses pré-définies pour les cas triviaux (0 tokens API)
 */
const PREDEFINED_RESPONSES = {
  // Tests et messages sans contenu
  trivial: [
    { pattern: /^(test|testing|t|tt|ttt|ok|oui|non|yes|no|k|kk|kkk|\.+|\?+|!+)$/i,
      response: "Je suis prêt à t'aider avec tes questions de statistiques ! Pose-moi une question sur le cours STAT 101." },
    { pattern: /^[a-z]{1,3}$/i,
      response: "Message trop court. Pose-moi une question sur les statistiques !" }
  ],
  // Salutations simples
  greetings: [
    { pattern: /^(bonjour|salut|hello|hi|hey|coucou|bonsoir|allô|allo)!*$/i,
      response: "Bonjour ! Je suis l'assistant du cours STAT 101. Comment puis-je t'aider aujourd'hui ? Tu peux me poser des questions sur les probabilités, les statistiques descriptives, les tests d'hypothèse, etc." },
    { pattern: /^(merci|thanks|thx|ty)!*$/i,
      response: "De rien ! N'hésite pas si tu as d'autres questions sur les statistiques." },
    { pattern: /^(bye|au revoir|à\+|a\+|ciao|tchao)!*$/i,
      response: "À bientôt ! Bonne révision !" }
  ],
  // Questions méta sur le bot
  meta: [
    { pattern: /^(qui es[- ]tu|tu es qui|c'est quoi|what are you|who are you)\??$/i,
      response: "Je suis l'assistant IA du cours STAT 101. Mon rôle est de t'aider à comprendre les concepts statistiques, pas de te donner les réponses directement. Pose-moi une question sur le cours !" },
    { pattern: /^(ça va|comment vas[- ]tu|how are you)\??$/i,
      response: "Je suis prêt à t'aider ! Quelle est ta question sur les statistiques ?" }
  ]
};

/**
 * Vérifie si le message correspond à une réponse pré-définie
 * @returns {string|null} La réponse pré-définie ou null si aucune correspondance
 */
function getPredefinedResponse(message) {
  const trimmed = message.trim();

  for (const category of Object.values(PREDEFINED_RESPONSES)) {
    for (const item of category) {
      if (item.pattern.test(trimmed)) {
        return item.response;
      }
    }
  }
  return null;
}

/**
 * Classifie le type de requête pour optimiser le traitement
 * @returns {'trivial'|'greeting'|'course_related'|'exercise'|'general'}
 */
function classifyRequest(message, context) {
  const lower = message.toLowerCase().trim();

  // Si contexte d'exercice présent, c'est lié au cours
  if (context && context.question) {
    return 'exercise';
  }

  // Mots-clés statistiques
  const statsKeywords = [
    'moyenne', 'médiane', 'écart', 'variance', 'probabilité', 'proba',
    'échantillon', 'population', 'hypothèse', 'test', 'intervalle',
    'confiance', 'p-value', 'distribution', 'normale', 'binomiale',
    'corrélation', 'régression', 'statistique', 'stat', 'données',
    'slide', 'semaine', 'cours', 'formule', 'calcul', 'espérance',
    'bernoulli', 'poisson', 'événement', 'indépendant', 'conditionnel'
  ];

  // Vérifier si le message contient des mots-clés du cours
  for (const keyword of statsKeywords) {
    if (lower.includes(keyword)) {
      return 'course_related';
    }
  }

  // Message très court sans contexte = probablement trivial ou salutation
  if (lower.length < 20) {
    return 'general';
  }

  return 'general';
}

// Token quota system - 50,000 tokens per day per IP
const tokenQuotaMap = new Map();
const TOKEN_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_TOKENS_PER_DAY = 50000;

const ALLOWED_ORIGINS = [
  'https://intro-statistique.netlify.app',
  'http://localhost:8888',
  'http://localhost:7307',
  'http://localhost:4321'
];

// ============================================================================
// PROMPT BLOCKS - Modular system for pedagogical modes
// ============================================================================

// PROMPT MINIMAL pour les questions générales/hors-sujet (~200 tokens au lieu de ~1500)
const SYSTEM_MINIMAL = `Tu es l'assistant IA du cours STAT 101 (statistiques universitaires, introduction).

RÈGLES:
- Réponds en FRANÇAIS, de manière concise (2-4 phrases max).
- Si la question concerne les stats → donne une réponse brève et utile.
- Si hors-sujet → redirige poliment vers les statistiques.
- Ne révèle jamais les réponses aux QCM.
- Format: texte simple, LaTeX pour formules: \\( ... \\)`;

// BASE SYSTEM PROMPT (always on)
const SYSTEM_BASE = `Tu es un assistant pédagogique IA pour un cours d'introduction à la statistique (STAT 101) de niveau universitaire.

TOUTES tes réponses doivent être en FRANÇAIS.

## RÔLE PRINCIPAL
Tu es là pour aider les étudiants à raisonner, construire leur intuition et comprendre les concepts statistiques.
Tu n'es PAS là pour donner des réponses directement.

## PRIORITÉS PÉDAGOGIQUES
1. Privilégie la COMPRÉHENSION CONCEPTUELLE, pas les formules.
2. Encourage un raisonnement statistique correct et une bonne interprétation.
3. Aborde explicitement les erreurs de compréhension courantes.
4. Utilise un langage simple adapté aux débutants.
5. Sois encourageant, jamais condescendant.

## CONTENU STAT 101 - LIMITES
L'étudiant connaît uniquement les statistiques d'introduction :
- Statistiques descriptives (moyenne, médiane, variance, écart-type)
- Probabilités de base
- Échantillonnage et populations
- Intervalles de confiance
- Tests d'hypothèses (z-test / t-test)
- p-values (interprétation de base)
- Corrélation vs causalité

N'introduis PAS de sujets avancés sauf demande explicite.

## FORMAT DE RÉPONSE
- Paragraphes courts
- Puces si utile
- Utilise LaTeX pour les formules : \\( ... \\)
- Préfère les mots aux symboles quand possible`;

// ANTI-CHEATING ADD-ON (always on)
const ANTI_CHEATING = `

## RÈGLES ANTI-TRICHE (STRICTES)
- Ne révèle JAMAIS la bonne réponse à une question à choix multiples.
- Ne dis JAMAIS "la bonne réponse est A/B/C" ou similaire.
- Ne confirme JAMAIS si la réponse sélectionnée est correcte ou incorrecte.
- Si l'étudiant demande "Est-ce correct?", guide-le vers la vérification par le raisonnement.
- Si l'étudiant insiste pour avoir la réponse, redirige gentiment vers la compréhension conceptuelle.
- Fournis des indices et explications, mais jamais la solution finale.`;

// STYLE BLOCKS - Three modes available
const STYLE_CLASSIQUE = `

## STYLE: CLASSIQUE 🧭
Ton: clair, calme, structuré.
Style: académique mais accessible.
Langage: précis, sans jargon inutile.
Structure: paragraphes courts, listes si utile.
Pas d'emojis.
Pas d'humour.
Priorité: clarté et compréhension.`;

const STYLE_FUN = `

## STYLE: FUN 🤩
Ton: amical, enthousiaste, engageant.
Tutoie l'étudiant naturellement.

Utilise occasionnellement des expressions comme:
"Imagine que...", "Plot twist!", "Spoiler alert!"

Tu peux ajouter 1-2 emojis MAXIMUM par message si cela apporte du sens (🎲, 📊, 🤔, 💡).

Privilégie les analogies du quotidien étudiant:
- partager une pizza entre amis
- likes sur Instagram ou TikTok
- temps passé sur Netflix
- sondages entre potes
- lancers de dés dans un jeu de société

RÈGLE IMPORTANTE: l'humour ne doit jamais nuire à la clarté.
L'apprentissage doit rester correct, clair et efficace.`;

const STYLE_SCEPTIQUE = `

## STYLE: SCEPTIQUE 🤨
Ton: exigeant mais juste.
Style: questionnant, légèrement ironique, jamais moqueur.

Comportement pédagogique:
- Questionne les affirmations et les raccourcis.
- Demande des justifications ("Pourquoi?", "Sur quoi te bases-tu?").
- Met en évidence les hypothèses implicites.
- Insiste sur la précision du langage et de l'interprétation.

Contraintes:
- Critique toujours le raisonnement, jamais la personne.
- Pas de sarcasme.
- Pas de jugement sur les capacités de l'étudiant.
- Reste engageant et respectueux.`;

// INTENT-SPECIFIC BLOCKS
const INTENT_BLOCKS = {
  HINT: `

## MODE: INDICE (Socratique)
Pose des questions guidantes et donne de petits indices.
- Ne donne PAS d'explication complète.
- Ne révèle PAS la réponse.
- Termine par une question qui guide vers l'étape suivante.
- Format: 2-4 lignes + 1 question de réflexion.`,

  EXPLANATION: `

## MODE: EXPLICATION
Fournis une explication structurée du concept testé par cette question.
- Explique le concept statistique sous-jacent (2-5 points).
- Garde l'explication accessible aux débutants.
- Ne révèle PAS quelle option est correcte.
- Mentionne les erreurs de compréhension courantes si pertinent.
- Format: 5-12 lignes avec puces/étapes.`,

  WHY_WRONG: `

## MODE: APRÈS ERREUR (Détecteur de misconceptions)
L'étudiant a fait une erreur. Identifie la misconception probable.
- Explique pourquoi ce type de réponse est tentant mais incorrect.
- Décris l'erreur de raisonnement courante (ex: confusion avec/sans remplacement, indépendance, règle du complément).
- Donne un chemin correctif sous forme d'indice.
- Ne révèle PAS la bonne option.
- Format: 4-8 lignes.`,

  CHECK_REASONING: `

## MODE: VÉRIFIE MON RAISONNEMENT (Métacognition)
L'étudiant pense avoir trouvé la bonne réponse et veut vérifier son raisonnement.
- Évalue la structure du raisonnement (hypothèses, indépendance, interprétation).
- Ne confirme PAS si la réponse est correcte.
- Identifie un point fort et un point à améliorer.
- Propose une question d'auto-vérification.
- Format: "**Point fort:** ... / **À améliorer:** ... / **Question de vérification:** ..."`,

  SIMILAR_QUESTION: `

## MODE: QUESTION SIMILAIRE
Crée UNE question similaire de niveau STAT 101 pour que l'étudiant s'entraîne.
- Même concept, mais nombres/contexte différents.
- Propose 4 options de réponse.
- Ne donne PAS la réponse correcte.
- Demande à l'étudiant de répondre avec son choix et une phrase de justification.
- Format: "**Question:** [énoncé]" + 4 options + "Réponds avec ton choix et une phrase de justification."`,

  OPEN_CHAT: `

## MODE: AIDE IA (Adaptatif)
Réponds à la question de l'étudiant de manière adaptée.
- Si demande d'aide conceptuelle → explication normale.
- Si demande "est-ce correct?" → ne confirme pas, guide vers la vérification.
- Si l'étudiant semble bloqué → passe en mode Socratique avec des questions.
- Garde la réponse focalisée et concise.`
};

// ============================================================================
// HANDLER
// ============================================================================

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Rate limiting
  const clientIP = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  const now = Date.now();
  const clientData = rateLimitMap.get(clientIP) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

  if (now > clientData.resetTime) {
    clientData.count = 0;
    clientData.resetTime = now + RATE_LIMIT_WINDOW_MS;
  }

  clientData.count++;
  rateLimitMap.set(clientIP, clientData);

  if (clientData.count > MAX_REQUESTS_PER_WINDOW) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Trop de requêtes. Veuillez attendre une minute.' })
    };
  }

  // Token quota check
  const tokenData = tokenQuotaMap.get(clientIP) || { used: 0, resetTime: now + TOKEN_QUOTA_WINDOW_MS };

  if (now > tokenData.resetTime) {
    tokenData.used = 0;
    tokenData.resetTime = now + TOKEN_QUOTA_WINDOW_MS;
  }

  const tokensRemaining = MAX_TOKENS_PER_DAY - tokenData.used;

  if (tokensRemaining <= 0) {
    const resetInHours = Math.ceil((tokenData.resetTime - now) / (60 * 60 * 1000));
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error: `Quota de tokens épuisé. Réinitialisation dans ${resetInHours}h.`,
        tokensUsed: tokenData.used,
        tokensRemaining: 0,
        tokensMax: MAX_TOKENS_PER_DAY
      })
    };
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Configuration manquante. Contactez l\'administrateur.' })
    };
  }

  try {
    const { message, conversationHistory, context } = JSON.parse(event.body);

    if (!message || typeof message !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message invalide.' })
      };
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Message trop long (max ${MAX_MESSAGE_LENGTH} caractères).` })
      };
    }

    // =========================================================================
    // OPTIMISATION 1: Réponses pré-définies (0 tokens API)
    // =========================================================================
    // Si pas de contexte d'exercice, vérifier si c'est un message trivial
    if (!context || !context.question) {
      const predefinedResponse = getPredefinedResponse(message);
      if (predefinedResponse) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            response: predefinedResponse,
            tokens: {
              prompt: 0,
              completion: 0,
              total: 0,
              used: tokenQuotaMap.get(clientIP)?.used || 0,
              remaining: MAX_TOKENS_PER_DAY - (tokenQuotaMap.get(clientIP)?.used || 0),
              max: MAX_TOKENS_PER_DAY,
              optimized: true // Indicateur d'optimisation
            }
          })
        };
      }
    }

    // =========================================================================
    // OPTIMISATION 2: Classification de la requête
    // =========================================================================
    const requestType = classifyRequest(message, context);

    // Build modular system prompt
    const styleMode = context && context.styleMode ? context.styleMode : 'classique';
    const intent = context && context.intent ? context.intent : 'OPEN_CHAT';
    const source = context && context.source ? context.source : null;

    // OPTIMIZED: Load only index instead of full content (~800 tokens vs ~30,000)
    const baseUrl = origin || 'https://intro-statistique.netlify.app';
    const index = await loadIndex(baseUrl);

    // Detect week reference in message
    const weekMatch = message.match(/semaine\s*(\d+)/i);
    const slideMatch = message.match(/slide\s*(\d+)/i);

    if (weekMatch || slideMatch) {
      const requestedWeek = weekMatch ? parseInt(weekMatch[1], 10) : null;
      const requestedSlide = slideMatch ? parseInt(slideMatch[1], 10) : null;

      // If a specific week is mentioned, check if it exists in index
      if (requestedWeek) {
        const weekData = index.semaines[requestedWeek];

        if (!weekData || !weekData.s || weekData.s.length === 0) {
          // Find which weeks have content
          const weeksWithContent = Object.keys(index.semaines).join(', ');

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              response: `Le contenu de la semaine ${requestedWeek} n'est pas encore disponible dans la base de données. Pour l'instant, seul le contenu des semaines ${weeksWithContent || '1'} est disponible. Tu peux me poser des questions sur ce contenu !`
            })
          };
        }

        // Check if requested slide exists in this week
        if (requestedSlide) {
          const slideExists = weekData.s.some(s => s[0] === requestedSlide);
          const maxSlide = Math.max(...weekData.s.map(s => s[0]));

          if (!slideExists) {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                response: `La slide ${requestedSlide} n'existe pas dans la semaine ${requestedWeek}. Cette semaine contient uniquement les slides 1 à ${maxSlide}. Peux-tu vérifier le numéro de slide ?`
              })
            };
          }
        }
      }
      // If only slide is mentioned (no week), check against all available content
      else if (requestedSlide) {
        const slideInfo = findSlideWeek(index, requestedSlide);
        const availableWeeks = Object.keys(index.semaines);

        if (!slideInfo) {
          // Get max slide across all weeks
          let maxSlide = 0;
          for (const week of Object.values(index.semaines)) {
            const weekMax = Math.max(...week.s.map(s => s[0]));
            if (weekMax > maxSlide) maxSlide = weekMax;
          }

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              response: `La slide ${requestedSlide} n'existe pas. Le contenu disponible (semaines ${availableWeeks.join(', ')}) contient uniquement les slides 1 à ${maxSlide}. Peux-tu vérifier le numéro de slide ?`
            })
          };
        }
      }
    }

    // =========================================================================
    // OPTIMISATION 3: Choix du prompt selon le type de requête
    // =========================================================================
    let systemPrompt;
    let useMinimalPrompt = false;

    // Utiliser le prompt minimal pour les questions générales sans contexte de cours
    if (requestType === 'general' && !source) {
      systemPrompt = SYSTEM_MINIMAL;
      useMinimalPrompt = true;
    } else {
      // Select style based on mode
      let styleBlock = STYLE_CLASSIQUE;
      if (styleMode === 'fun') {
        styleBlock = STYLE_FUN;
      } else if (styleMode === 'sceptique') {
        styleBlock = STYLE_SCEPTIQUE;
      }

      // Assemble system prompt: BASE + ANTI_CHEATING + STYLE + INTENT
      systemPrompt = SYSTEM_BASE + ANTI_CHEATING;
      systemPrompt += styleBlock;
      systemPrompt += INTENT_BLOCKS[intent] || INTENT_BLOCKS['OPEN_CHAT'];
    }

    // OPTIMIZED: Load only necessary content based on request
    if (source) {
      if (source === 'global') {
        if (slideMatch) {
          // User asked about a specific slide - load only that slide (~200 tokens)
          const requestedSlide = parseInt(slideMatch[1], 10);

          // If week is also specified, use it directly (slide numbers are local per week)
          // Otherwise, search globally with findSlideWeek
          let targetWeekNum, targetWeekTitle, targetSlideTitle;

          if (weekMatch) {
            // User specified both slide and week - use directly
            targetWeekNum = weekMatch[1];
            const weekData = index.semaines[targetWeekNum];
            if (weekData) {
              targetWeekTitle = weekData.t;
              const slide = weekData.s.find(s => s[0] === requestedSlide);
              targetSlideTitle = slide ? slide[1] : `Slide ${requestedSlide}`;
            }
          } else {
            // Only slide specified - search globally
            const slideInfo = findSlideWeek(index, requestedSlide);
            if (slideInfo) {
              targetWeekNum = slideInfo.weekNum;
              targetWeekTitle = slideInfo.weekTitle;
              targetSlideTitle = slideInfo.slideTitle;
            }
          }

          if (targetWeekNum) {
            const slideData = await loadSlide(baseUrl, targetWeekNum, requestedSlide);

            if (slideData && slideData.c) {
              systemPrompt += `

## CONTENU DE LA SLIDE ${requestedSlide} - ${targetSlideTitle} (Semaine ${targetWeekNum}: ${targetWeekTitle})
${slideData.c}

## INSTRUCTIONS IMPORTANTES
- Base ta réponse sur cette slide.
- Mentionne toujours "**Slide ${requestedSlide}, Semaine ${targetWeekNum}**" dans ta réponse pour référence.
- Si la question dépasse le contenu de cette slide mais reste en statistique, indique que "Pour approfondir ce sujet, tu peux consulter les **références complémentaires** (fichier en cours de construction)."
- Si la question est hors-sujet, redirige poliment l'étudiant.`;
            }
          }
        } else {
          // OPTIMIZED: Find relevant slides and load only their content (~500-1000 tokens total)
          const relevantSlides = findRelevantSlides(index, message);

          // Load content of top 2 most relevant slides
          let slidesContent = '';
          const slidesToLoad = relevantSlides.slice(0, 2);

          for (const match of slidesToLoad) {
            const slideData = await loadSlide(baseUrl, match.weekNum, match.slideNum);
            if (slideData && slideData.c) {
              slidesContent += `\n### SLIDE ${match.slideNum} - ${match.slideTitle} (Semaine ${match.weekNum})\n${slideData.c}\n`;
            }
          }

          // Build compact course summary (just week titles, no slide list)
          const weeksList = Object.entries(index.semaines)
            .map(([num, w]) => `Semaine ${num}: ${w.t}`)
            .join('\n');

          systemPrompt += `

## COURS DISPONIBLES
${weeksList}
${slidesContent ? `\n## CONTENU PERTINENT\n${slidesContent}` : ''}

## INSTRUCTIONS
- Réponds en te basant sur le contenu ci-dessus si disponible.
- Mentionne la slide de référence: "Voir **Slide X de la semaine Y**."
- Si la question dépasse le cours STAT 101, indique-le poliment.
- Si hors-sujet, redirige vers le cours.`;
        }
      } else if (source.startsWith('semaine_')) {
        // Specific week requested - load only relevant slides
        const weekNum = source.replace('semaine_', '');
        const weekData = index.semaines[weekNum];

        if (weekData) {
          // Find relevant slides from this week
          const relevantSlides = findRelevantSlides(index, message)
            .filter(s => s.weekNum === weekNum);

          let weekContent = `## SEMAINE ${weekNum}: ${weekData.t}\n\n`;

          // Load content of top 2 relevant slides only
          // Default to first slide if no relevant matches
          const slidesToLoad = relevantSlides.length > 0
            ? relevantSlides.slice(0, 2)
            : [{ slideNum: weekData.s[0][0], slideTitle: weekData.s[0][1], weekNum }];

          for (const match of slidesToLoad) {
            const slideData = await loadSlide(baseUrl, weekNum, match.slideNum);
            if (slideData && slideData.c) {
              weekContent += `### SLIDE ${match.slideNum}: ${match.slideTitle}\n${slideData.c}\n\n`;
            }
          }

          systemPrompt += `

## CONTENU DU COURS
${weekContent}
Réponds aux questions sur ce contenu. Si hors-sujet, redirige poliment.`;
        }
      }
    }

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history
    if (conversationHistory && Array.isArray(conversationHistory)) {
      messages.push(...conversationHistory.slice(-10));
    }

    // Build context-aware user message (WITHOUT the correct answer for anti-cheating)
    let userMessage = message;
    if (context && context.question) {
      // Determine if student answered and if correct (but don't reveal answer to model)
      const hasAnswer = context.studentAnswer && context.studentAnswer !== 'Aucune réponse sélectionnée';

      const contextInfo = `
[CONTEXTE DE L'EXERCICE]
Question: ${context.question}
Indice disponible: ${context.hint || 'Non disponible'}
Réponse de l'étudiant: ${context.studentAnswer || 'Aucune réponse sélectionnée'}
Statut: ${hasAnswer ? (context.isCorrect ? 'Réponse correcte' : 'Réponse incorrecte') : 'Pas encore répondu'}
Nombre d'interactions IA: ${context.aiTurnCount || 1}
Action demandée: ${intent}

[MESSAGE DE L'ÉTUDIANT]
${message}`;
      userMessage = contextInfo;
    }

    messages.push({ role: 'user', content: userMessage });

    // =========================================================================
    // OPTIMISATION 4: Paramètres API adaptés au type de requête
    // =========================================================================
    // Pour les requêtes générales: réponse courte (200 tokens max)
    // Pour les requêtes cours/exercice: réponse complète (800 tokens max)
    const maxResponseTokens = useMinimalPrompt ? 200 : 800;

    // Call OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        max_tokens: maxResponseTokens,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Erreur du service IA. Réessayez.' })
      };
    }

    const data = await response.json();
    const assistantMessage = data.choices[0].message.content;

    // Extract token usage from OpenAI response
    const usage = data.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || 0;

    // Update token quota
    tokenData.used += totalTokens;
    tokenQuotaMap.set(clientIP, tokenData);

    const newTokensRemaining = MAX_TOKENS_PER_DAY - tokenData.used;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        response: assistantMessage,
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens,
          used: tokenData.used,
          remaining: Math.max(0, newTokensRemaining),
          max: MAX_TOKENS_PER_DAY,
          optimized: useMinimalPrompt, // true si prompt minimal utilisé
          requestType: requestType // 'general', 'course_related', 'exercise'
        }
      })
    };

  } catch (error) {
    console.error('Chat function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Une erreur est survenue. Réessayez.' })
    };
  }
};
