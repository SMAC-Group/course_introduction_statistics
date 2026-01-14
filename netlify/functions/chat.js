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
 * Load the course index (metadata, summaries, keywords)
 * ~800 tokens instead of ~30,000
 */
async function loadIndex(baseUrl) {
  if (cachedIndex) return cachedIndex;
  try {
    const response = await fetch(`${baseUrl}/content/index.json`);
    if (response.ok) {
      cachedIndex = await response.json();
    } else {
      cachedIndex = { semaines: {} };
    }
  } catch (e) {
    console.error('Failed to load index.json:', e);
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
 */
function findSlideWeek(index, slideNum) {
  for (const [weekNum, week] of Object.entries(index.semaines)) {
    const slide = week.slides.find(s => s.n === slideNum);
    if (slide) {
      return { weekNum, weekTitle: week.titre, slide };
    }
  }
  return null;
}

/**
 * Find slides matching keywords from a question
 */
function findRelevantSlides(index, question) {
  const questionLower = question.toLowerCase();
  const matches = [];

  for (const [weekNum, week] of Object.entries(index.semaines)) {
    for (const slide of week.slides) {
      let score = 0;

      // Check keywords
      for (const keyword of slide.k) {
        if (questionLower.includes(keyword.toLowerCase())) {
          score += 2;
        }
      }

      // Check title
      if (questionLower.includes(slide.t.toLowerCase())) {
        score += 3;
      }

      // Check summary
      const summaryWords = slide.r.toLowerCase().split(/\s+/);
      const questionWords = questionLower.split(/\s+/);
      for (const qWord of questionWords) {
        if (qWord.length > 3 && summaryWords.some(w => w.includes(qWord))) {
          score += 1;
        }
      }

      if (score > 0) {
        matches.push({ weekNum, weekTitle: week.titre, slide, score });
      }
    }
  }

  // Sort by score and return top matches
  return matches.sort((a, b) => b.score - a.score).slice(0, 3);
}

/**
 * Build slide index string from index data
 */
function buildSlideIndexFromIndex(index) {
  let result = '';
  for (const [weekNum, week] of Object.entries(index.semaines)) {
    result += `\n### Semaine ${weekNum} - ${week.titre}\n`;
    for (const slide of week.slides) {
      result += `### SLIDE ${slide.n} : ${slide.t}\n`;
    }
  }
  return result;
}

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 15;
const MAX_MESSAGE_LENGTH = 1000;

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

        if (!weekData || !weekData.slides || weekData.slides.length === 0) {
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
          const slideExists = weekData.slides.some(s => s.n === requestedSlide);
          const maxSlide = Math.max(...weekData.slides.map(s => s.n));

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
            const weekMax = Math.max(...week.slides.map(s => s.n));
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

    // Select style based on mode
    let styleBlock = STYLE_CLASSIQUE;
    if (styleMode === 'fun') {
      styleBlock = STYLE_FUN;
    } else if (styleMode === 'sceptique') {
      styleBlock = STYLE_SCEPTIQUE;
    }

    // Assemble system prompt: BASE + ANTI_CHEATING + STYLE + INTENT
    let systemPrompt = SYSTEM_BASE + ANTI_CHEATING;
    systemPrompt += styleBlock;
    systemPrompt += INTENT_BLOCKS[intent] || INTENT_BLOCKS['OPEN_CHAT'];

    // OPTIMIZED: Load only necessary content based on request
    if (source) {
      if (source === 'global') {
        if (slideMatch) {
          // User asked about a specific slide - load only that slide (~200 tokens)
          const requestedSlide = parseInt(slideMatch[1], 10);
          const slideInfo = findSlideWeek(index, requestedSlide);

          if (slideInfo) {
            const slideData = await loadSlide(baseUrl, slideInfo.weekNum, requestedSlide);

            if (slideData && slideData.c) {
              systemPrompt += `

## CONTENU DE LA SLIDE ${requestedSlide} - ${slideInfo.slide.t} (Semaine ${slideInfo.weekNum}: ${slideInfo.weekTitle})
${slideData.c}

## INSTRUCTIONS IMPORTANTES
- Base ta réponse sur cette slide.
- Mentionne toujours "**Slide ${requestedSlide}**" dans ta réponse pour référence.
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
            const slideData = await loadSlide(baseUrl, match.weekNum, match.slide.n);
            if (slideData && slideData.c) {
              slidesContent += `\n### SLIDE ${match.slide.n} - ${match.slide.t} (Semaine ${match.weekNum})\n${slideData.c}\n`;
            }
          }

          // Build compact course summary (just week titles, no slide list)
          const weeksList = Object.entries(index.semaines)
            .map(([num, w]) => `Semaine ${num}: ${w.titre}`)
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

          let weekContent = `## SEMAINE ${weekNum}: ${weekData.titre}\n\n`;

          // Load content of top 2 relevant slides only
          const slidesToLoad = relevantSlides.length > 0
            ? relevantSlides.slice(0, 2)
            : [{ slide: weekData.slides[0], weekNum }]; // Default to first slide

          for (const match of slidesToLoad) {
            const slideData = await loadSlide(baseUrl, weekNum, match.slide.n);
            if (slideData && slideData.c) {
              weekContent += `### SLIDE ${match.slide.n}: ${match.slide.t}\n${slideData.c}\n\n`;
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
        max_tokens: 800,
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
          max: MAX_TOKENS_PER_DAY
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
