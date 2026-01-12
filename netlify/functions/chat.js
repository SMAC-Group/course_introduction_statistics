// Netlify Function - Scaffolded AI Tutor for Statistics Course
// Implements pedagogical scaffolding with modular prompt blocks

// Course content will be loaded dynamically
let coursContent = null;

async function loadCoursContent(baseUrl) {
  if (coursContent) return coursContent;
  try {
    const response = await fetch(`${baseUrl}/content/cours.json`);
    if (response.ok) {
      coursContent = await response.json();
    } else {
      coursContent = {};
    }
  } catch (e) {
    console.error('Failed to load cours.json:', e);
    coursContent = {};
  }
  return coursContent;
}

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 15;
const MAX_MESSAGE_LENGTH = 1000;

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

    // Check for slide/week requests and validate against actual content
    const baseUrl = origin || 'https://intro-statistique.netlify.app';
    const content = await loadCoursContent(baseUrl);

    // Detect week reference in message
    const weekMatch = message.match(/semaine\s*(\d+)/i);
    const slideMatch = message.match(/slide\s*(\d+)/i);

    if (weekMatch || slideMatch) {
      const requestedWeek = weekMatch ? parseInt(weekMatch[1], 10) : null;
      const requestedSlide = slideMatch ? parseInt(slideMatch[1], 10) : null;

      // If a specific week is mentioned, check if it has content
      if (requestedWeek) {
        const weekKey = `semaine_${requestedWeek}`;
        const weekContent = content[weekKey];

        if (!weekContent || !weekContent.contenu || weekContent.contenu.trim() === '') {
          // Find which weeks have content
          const weeksWithContent = Object.entries(content)
            .filter(([key, val]) => val.contenu && val.contenu.trim() !== '')
            .map(([key]) => key.replace('semaine_', ''))
            .join(', ');

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              response: `Le contenu de la semaine ${requestedWeek} n'est pas encore disponible dans la base de données. Pour l'instant, seul le contenu de la semaine ${weeksWithContent || '1'} est disponible. Tu peux me poser des questions sur ce contenu !`
            })
          };
        }

        // Check if requested slide exists in this week's content
        if (requestedSlide) {
          const slideNumbers = weekContent.contenu.match(/### SLIDE (\d+)/g);
          const maxSlide = slideNumbers
            ? Math.max(...slideNumbers.map(s => parseInt(s.match(/\d+/)[0])))
            : 0;

          if (requestedSlide < 1 || requestedSlide > maxSlide) {
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
        // Get max slide from all content
        let maxSlide = 0;
        let availableWeeks = [];

        for (const [key, val] of Object.entries(content)) {
          if (val.contenu && val.contenu.trim() !== '') {
            availableWeeks.push(key.replace('semaine_', ''));
            const slideNumbers = val.contenu.match(/### SLIDE (\d+)/g);
            if (slideNumbers) {
              const weekMax = Math.max(...slideNumbers.map(s => parseInt(s.match(/\d+/)[0])));
              if (weekMax > maxSlide) maxSlide = weekMax;
            }
          }
        }

        if (requestedSlide < 1 || requestedSlide > maxSlide) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              response: `La slide ${requestedSlide} n'existe pas. Le contenu disponible (semaine ${availableWeeks.join(', ')}) contient uniquement les slides 1 à ${maxSlide}. Peux-tu vérifier le numéro de slide ?`
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

    // Load course content if source is specified
    if (source) {
      if (source === 'global') {
        // OPTIMIZED: Only load relevant slide(s) instead of all content

        // Helper function to extract a specific slide from content
        function extractSlide(contenu, slideNum) {
          const regex = new RegExp(`### SLIDE ${slideNum}[^#]*(?=### SLIDE|$)`, 's');
          const match = contenu.match(regex);
          return match ? match[0].trim() : null;
        }

        // Helper function to get list of slide titles for context
        function getSlideIndex(contenu) {
          const matches = contenu.match(/### SLIDE \d+ : [^\n]+/g);
          return matches ? matches.join('\n') : '';
        }

        if (slideMatch) {
          // User asked about a specific slide - only include that slide
          const requestedSlide = parseInt(slideMatch[1], 10);
          let slideContent = null;
          let weekTitle = '';

          for (const [key, cours] of Object.entries(content)) {
            if (cours.contenu && cours.contenu.trim() !== '') {
              const extracted = extractSlide(cours.contenu, requestedSlide);
              if (extracted) {
                slideContent = extracted;
                weekTitle = cours.titre;
                break;
              }
            }
          }

          if (slideContent) {
            systemPrompt += `

## CONTENU DE LA SLIDE ${requestedSlide} (${weekTitle})
${slideContent}

## INSTRUCTIONS IMPORTANTES
- Base ta réponse sur cette slide.
- Mentionne toujours "**Slide ${requestedSlide}**" dans ta réponse pour référence.
- Si la question dépasse le contenu de cette slide mais reste en statistique, indique que "Pour approfondir ce sujet, tu peux consulter les **références complémentaires** (fichier en cours de construction)."
- Si la question est hors-sujet, redirige poliment l'étudiant.`;
          }
        } else {
          // No specific slide requested - provide slide index + context from conversation
          let allSlideIndexes = '';
          let allCourseTitles = [];

          for (const [key, cours] of Object.entries(content)) {
            if (cours.contenu && cours.contenu.trim() !== '') {
              const weekNum = key.replace('semaine_', '');
              allSlideIndexes += `\n### Semaine ${weekNum} - ${cours.titre}\n`;
              allSlideIndexes += getSlideIndex(cours.contenu);
              allCourseTitles.push(cours.titre);
            }
          }

          systemPrompt += `

## COURS DISPONIBLES
${allSlideIndexes}

## INSTRUCTIONS IMPORTANTES

### Quand l'étudiant pose une question sur un CONCEPT du cours:
1. Identifie quelle(s) slide(s) traite(nt) de ce concept
2. Explique le concept de manière pédagogique
3. **TOUJOURS mentionner** la slide de référence, exemple: "Ce concept est abordé dans la **Slide X de la semaine Y**."
4. Suggère à l'étudiant de consulter cette slide pour plus de détails

### Quand la question DÉPASSE le contenu du cours:
Si l'étudiant pose une question qui va au-delà du contenu STAT 101 (régression avancée, machine learning, statistiques bayésiennes, etc.):
1. Explique poliment que cette question dépasse le cadre du cours d'introduction
2. Donne une brève réponse si possible pour satisfaire la curiosité
3. Ajoute: "Pour approfondir ce sujet, tu peux consulter les **références complémentaires** (fichier en cours de construction)."

### Quand la question est HORS-SUJET (pas de la statistique):
Redirige poliment l'étudiant vers le sujet du cours.`;
        }
      } else if (content[source]) {
        const cours = content[source];
        systemPrompt += `

## CONTENU DU COURS (${cours.titre})
Voici le contenu de référence pour cette semaine. Base tes réponses sur ce contenu :

${cours.contenu}

IMPORTANT: Réponds uniquement aux questions en lien avec ce contenu. Si la question est hors-sujet, redirige poliment l'étudiant vers le sujet du cours.`;
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        response: assistantMessage
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
