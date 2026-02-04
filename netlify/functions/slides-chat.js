/**
 * Slides Chat - Serverless Function
 * Separate AI chat for slide explanations (no anti-cheating rules)
 */

// ============================================================================
// RATE LIMITING & QUOTA
// ============================================================================

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 15;
const MAX_MESSAGE_LENGTH = 1000;

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
// SYSTEM PROMPTS
// ============================================================================

const SYSTEM_BASE = `Tu es un assistant pedagogique IA pour un cours d'introduction a la statistique (STAT 101) de niveau universitaire.

TOUTES tes reponses doivent etre en FRANCAIS.

## REGLE FONDAMENTALE
Tu aides les etudiants a comprendre le CONTENU DE LA SLIDE affichee.

### CAS ACCEPTES (tu dois repondre):
- Demandes generales d'explication: "Je ne comprends pas", "Explique-moi", "C'est quoi?", "Je ne capte pas", "Peux-tu m'expliquer ce slide?" → Explique le contenu principal de la slide de facon claire et pedagogique.
- Questions sur un concept, une formule ou un exemple present dans la slide.
- Demandes de clarification ou d'exemples supplementaires sur le contenu de la slide.

### CAS REFUSES (tu dois rediriger):
- Questions sur des sujets completement ABSENTS de la slide (ex: on parle de moyenne et l'etudiant demande la regression) → Reponds: "Ce sujet n'est pas couvert dans cette slide. Pose-moi une question sur le contenu affiche!"
- Questions hors-sujet (pas des statistiques du tout) → Reponds: "Cette question est en dehors du cours STAT 101."

## ROLE PRINCIPAL
Tu aides les etudiants a comprendre le contenu de LA SLIDE ACTUELLE.
Tu expliques les concepts, les formules, et tu donnes des exemples concrets en lien avec cette slide.

## PRIORITES PEDAGOGIQUES
1. Privilegie la COMPREHENSION CONCEPTUELLE, pas juste les formules.
2. Utilise des analogies simples et des exemples du quotidien.
3. Sois encourageant, jamais condescendant.
4. Adapte ton explication au niveau debutant.
5. Si la slide contient une formule, explique chaque terme.

## FORMAT DE REPONSE
- Paragraphes courts et clairs
- Puces si utile pour structurer
- Utilise LaTeX pour les formules: \\( ... \\)
- Prefere les mots aux symboles quand possible
- Longueur: 3-8 phrases generalement`;

// STYLE BLOCKS - Three modes available
const STYLE_CLASSIQUE = `

## STYLE: CLASSIQUE
Ton: clair, calme, structure.
Style: academique mais accessible.
Langage: precis, sans jargon inutile.
Structure: paragraphes courts, listes si utile.
Pas d'emojis.
Pas d'humour.
Priorite: clarte et comprehension.`;

const STYLE_FUN = `

## STYLE: FUN
Ton: amical, enthousiaste, engageant.
Tutoie l'etudiant naturellement.

Utilise occasionnellement des expressions comme:
"Imagine que...", "Plot twist!", "Spoiler alert!"

Tu peux ajouter 1-2 emojis MAXIMUM par message si cela apporte du sens.

Privilegie les analogies du quotidien etudiant:
- partager une pizza entre amis
- likes sur Instagram ou TikTok
- temps passe sur Netflix
- sondages entre potes
- lancers de des dans un jeu de societe

REGLE IMPORTANTE: l'humour ne doit jamais nuire a la clarte.
L'apprentissage doit rester correct, clair et efficace.`;

const STYLE_SCEPTIQUE = `

## STYLE: SCEPTIQUE
Ton: exigeant mais juste.
Style: questionnant, legerement ironique, jamais moqueur.

Comportement pedagogique:
- Questionne les affirmations et les raccourcis.
- Demande des justifications ("Pourquoi?", "Sur quoi te bases-tu?").
- Met en evidence les hypotheses implicites.
- Insiste sur la precision du langage et de l'interpretation.

Contraintes:
- Critique toujours le raisonnement, jamais la personne.
- Pas de sarcasme.
- Pas de jugement sur les capacites de l'etudiant.
- Reste engageant et respectueux.`;

const STYLE_BLOCKS = {
  'classique': STYLE_CLASSIQUE,
  'fun': STYLE_FUN,
  'sceptique': STYLE_SCEPTIQUE
};

// ============================================================================
// PREDEFINED RESPONSES (0 tokens)
// ============================================================================

const PREDEFINED_RESPONSES = {
  trivial: [
    { pattern: /^(test|ok|oui|non|k|\.+|\?+|!+)$/i,
      response: "Je suis pret a t'aider! Pose-moi une question sur le contenu de la slide affichee." },
    { pattern: /^[a-z]{1,3}$/i,
      response: "Message trop court. Quelle est ta question sur le contenu de cette slide?" }
  ],
  greetings: [
    { pattern: /^(bonjour|salut|hello|hi|hey|coucou)!*$/i,
      response: "Bonjour! Je peux t'expliquer le contenu de cette slide. Que voudrais-tu comprendre? (Je ne reponds qu'aux questions sur la slide affichee)" },
    { pattern: /^(merci|thanks|thx)!*$/i,
      response: "De rien! N'hesite pas si tu as d'autres questions sur le contenu de cette slide." }
  ]
};

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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getClientIP(event) {
  return event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         event.headers['client-ip'] ||
         'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const requests = rateLimitMap.get(ip).filter(time => time > windowStart);
  rateLimitMap.set(ip, requests);

  if (requests.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  requests.push(now);
  return true;
}

function checkTokenQuota(ip) {
  const now = Date.now();

  if (!tokenQuotaMap.has(ip)) {
    tokenQuotaMap.set(ip, { used: 0, resetTime: now + TOKEN_QUOTA_WINDOW_MS });
  }

  const quota = tokenQuotaMap.get(ip);

  if (now > quota.resetTime) {
    quota.used = 0;
    quota.resetTime = now + TOKEN_QUOTA_WINDOW_MS;
  }

  return {
    allowed: quota.used < MAX_TOKENS_PER_DAY,
    used: quota.used,
    remaining: Math.max(0, MAX_TOKENS_PER_DAY - quota.used),
    max: MAX_TOKENS_PER_DAY
  };
}

function updateTokenQuota(ip, tokensUsed) {
  if (tokenQuotaMap.has(ip)) {
    tokenQuotaMap.get(ip).used += tokensUsed;
  }
}

// ============================================================================
// BUILD SYSTEM PROMPT WITH SLIDE CONTEXT
// ============================================================================

function buildSystemPrompt(slideContext, styleMode) {
  let prompt = SYSTEM_BASE;

  // Add style block
  const styleBlock = STYLE_BLOCKS[styleMode] || STYLE_BLOCKS['classique'];
  prompt += styleBlock;

  if (slideContext && slideContext.content) {
    prompt += `

## CONTEXTE ACTUEL - SLIDE AFFICHEE
L'etudiant regarde la slide suivante:

### SLIDE ${slideContext.page}: ${slideContext.slideTitle || 'Sans titre'}
Semaine ${slideContext.week}: ${slideContext.weekTitle || ''}

---
${slideContext.content}
---

## INSTRUCTIONS
- Si l'etudiant demande une explication generale ("je ne comprends pas", "explique-moi ce slide", etc.), donne un resume clair et pedagogique du contenu principal de la slide.
- Reference la slide naturellement: "Sur cette slide...", "La formule presentee ici...", etc.
- Si la question porte sur un sujet completement ABSENT de cette slide (autre concept statistique), reponds: "Ce sujet n'est pas couvert dans cette slide. Pose-moi une question sur le contenu affiche!"
- Si la question est hors-sujet (pas des statistiques), reponds: "Cette question est en dehors du cours STAT 101."`;
  } else {
    prompt += `

## CONTEXTE
L'etudiant consulte les slides du cours mais le contenu specifique n'est pas disponible.
Reponds: "Je n'ai pas acces au contenu de cette slide. Assure-toi que la slide est bien chargee et repose ta question."`;
  }

  return prompt;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

exports.handler = async function(event, context) {
  // CORS headers
  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const clientIP = getClientIP(event);

  // Rate limiting
  if (!checkRateLimit(clientIP)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error: 'Trop de requetes. Attends une minute avant de reessayer.',
        retryAfter: 60
      })
    };
  }

  // Token quota check
  const quotaStatus = checkTokenQuota(clientIP);
  if (!quotaStatus.allowed) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error: 'Quota de tokens epuise pour aujourd\'hui. Reviens demain!',
        tokensUsed: quotaStatus.used,
        tokensRemaining: 0,
        tokensMax: quotaStatus.max
      })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { message, conversationHistory, slideContext, styleMode } = body;

    // Validate message
    if (!message || typeof message !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message requis' })
      };
    }

    const trimmedMessage = message.trim().slice(0, MAX_MESSAGE_LENGTH);

    // Check for predefined response (0 tokens)
    const predefinedResponse = getPredefinedResponse(trimmedMessage);
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
            used: quotaStatus.used,
            remaining: quotaStatus.remaining,
            max: quotaStatus.max,
            optimized: true
          }
        })
      };
    }

    // Check OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Configuration API manquante' })
      };
    }

    // Build messages for OpenAI
    const systemPrompt = buildSystemPrompt(slideContext, styleMode || 'classique');

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history (last 10 messages)
    if (Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content.slice(0, 500)
          });
        }
      }
    }

    // Add current message
    messages.push({ role: 'user', content: trimmedMessage });

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        max_tokens: 600,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('OpenAI API error:', errorData);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Erreur du service IA' })
      };
    }

    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message?.content || 'Desole, je n\'ai pas pu generer de reponse.';
    const usage = data.usage || {};

    // Update token quota
    const totalTokens = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
    updateTokenQuota(clientIP, totalTokens);

    const newQuotaStatus = checkTokenQuota(clientIP);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        response: assistantMessage,
        tokens: {
          prompt: usage.prompt_tokens || 0,
          completion: usage.completion_tokens || 0,
          total: totalTokens,
          used: newQuotaStatus.used,
          remaining: newQuotaStatus.remaining,
          max: newQuotaStatus.max
        }
      })
    };

  } catch (error) {
    console.error('Slides chat error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur interne du serveur' })
    };
  }
};
