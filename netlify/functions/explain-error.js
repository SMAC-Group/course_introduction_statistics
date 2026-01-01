// Netlify Function to call OpenAI API for explaining student errors
exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { question, selectedAnswer, feedback, correctAnswer } = JSON.parse(event.body);

    const systemPrompt = `Tu es un assistant pédagogique pour un cours d'introduction à la statistique de niveau universitaire de première année.

Ton rôle est d'expliquer aux étudiants pourquoi leur réponse est incorrecte, de manière:
- Claire et accessible (évite le jargon technique inutile)
- Encourageante et bienveillante
- Concise (2-4 phrases maximum)
- En français

Tu peux utiliser des notations mathématiques LaTeX entre \\( et \\) pour les formules.

Ne répète pas simplement le feedback déjà donné - apporte une explication complémentaire qui aide l'étudiant à comprendre le concept sous-jacent.`;

    const userPrompt = `Question posée: ${question}

Réponse choisie par l'étudiant (incorrecte): ${selectedAnswer}

Feedback déjà affiché: ${feedback}

${correctAnswer ? `La bonne réponse était: ${correctAnswer}` : ''}

Explique brièvement pourquoi cette réponse est incorrecte et aide l'étudiant à comprendre le concept.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 300,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Erreur lors de la communication avec l\'API' })
      };
    }

    const data = await response.json();
    const explanation = data.choices[0].message.content;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ explanation })
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Une erreur est survenue' })
    };
  }
};
