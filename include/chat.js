<script>
/* AI Help Chat - Scaffolded Tutor Side Panel */
(function() {
  let conversationHistory = [];
  let currentContext = null;
  let chatPanel = null;
  let aiTurnCount = 0;
  let styleMode = 'classique'; // 'classique', 'fun', or 'sceptique'
  let currentQuestionId = null; // Track which question the assistant is scoped to
  // Token quota tracking - load from localStorage if available
  const TOKEN_STORAGE_KEY = 'aiChatTokenInfo';
  const TOKEN_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

  function loadTokenInfo() {
    try {
      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        // Check if quota should be reset (24h passed)
        if (data.resetTime && Date.now() > data.resetTime) {
          // Quota expired, reset to full
          return { used: 0, remaining: 50000, max: 50000, resetTime: Date.now() + TOKEN_QUOTA_WINDOW_MS };
        }
        return data;
      }
    } catch (e) {
      console.warn('Failed to load token info from localStorage:', e);
    }
    return { used: 0, remaining: 50000, max: 50000, resetTime: Date.now() + TOKEN_QUOTA_WINDOW_MS };
  }

  function saveTokenInfo() {
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenInfo));
    } catch (e) {
      console.warn('Failed to save token info to localStorage:', e);
    }
  }

  let tokenInfo = loadTokenInfo();

  // Detect current page source (semaine) from URL
  function detectSource() {
    const path = window.location.pathname;
    const match = path.match(/semaine[_-]?(\d+)/i);
    if (match) {
      return 'semaine_' + match[1];
    }
    return null;
  }

  // Panel width settings
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 800;
  const DEFAULT_WIDTH = 500;
  let panelWidth = parseInt(localStorage.getItem('aiChatPanelWidth')) || DEFAULT_WIDTH;

  // Generate a unique ID for a question based on its text
  function generateQuestionId(questionText) {
    // Simple hash based on question text
    let hash = 0;
    for (let i = 0; i < questionText.length; i++) {
      const char = questionText.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'q_' + Math.abs(hash);
  }

  // Get current selected answer from the radio group near the button
  function getCurrentStudentAnswer() {
    if (!currentContext || !currentContext.buttonElement) return null;

    const questionButtons = currentContext.buttonElement.closest('.question-buttons');
    if (!questionButtons) return null;

    let sibling = questionButtons.previousElementSibling;
    while (sibling) {
      if (sibling.classList && sibling.classList.contains('webex-radiogroup')) {
        const selectedRadio = sibling.querySelector('input[type="radio"]:checked');
        if (selectedRadio) {
          const label = selectedRadio.closest('label');
          if (label) {
            const span = label.querySelector('span');
            if (span) {
              // Try to get original LaTeX from MathJax annotation
              const annotation = span.querySelector('annotation[encoding="application/x-tex"]');
              if (annotation) {
                return annotation.textContent;
              }
              // Fallback: try to get from mjx-assistive-mml
              const assistive = span.querySelector('mjx-assistive-mml math');
              if (assistive) {
                // Extract fraction if present
                const mfrac = assistive.querySelector('mfrac');
                if (mfrac) {
                  const nums = mfrac.querySelectorAll('mn');
                  if (nums.length === 2) {
                    return nums[0].textContent + '/' + nums[1].textContent;
                  }
                }
                return assistive.textContent;
              }
              // Last fallback: innerHTML cleaned up
              let text = span.innerHTML;
              // Remove MathJax containers and get plain text
              text = text.replace(/<mjx-container[^>]*>.*?<\/mjx-container>/gs, '');
              text = text.replace(/<[^>]+>/g, '').trim();
              if (text) return text;
              // Very last fallback
              return span.textContent;
            }
          }
        }
        break;
      }
      sibling = sibling.previousElementSibling;
    }
    return null;
  }

  // Markdown parser for AI responses
  function parseMarkdown(text) {
    // Bold: **text** -> <strong>text</strong>
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic: *text* -> <em>text</em> (but not inside URLs or already processed)
    text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // Process line by line for better list and paragraph handling
    const lines = text.split('\n');
    let result = [];
    let inList = false;
    let listType = null;
    let paragraphLines = [];

    function flushParagraph() {
      if (paragraphLines.length > 0) {
        result.push('<p>' + paragraphLines.join(' ') + '</p>');
        paragraphLines = [];
      }
    }

    for (let line of lines) {
      const trimmedLine = line.trim();

      // Check for headers (####, ###, ##)
      const h4Match = trimmedLine.match(/^####\s+(.+)$/);
      const h3Match = trimmedLine.match(/^###\s+(.+)$/);
      const h2Match = trimmedLine.match(/^##\s+(.+)$/);
      // Check for bullet points (- or •)
      const bulletMatch = trimmedLine.match(/^[\-•]\s+(.+)$/);
      // Check for numbered lists (1. 2. etc)
      const numberedMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);

      if (h4Match) {
        flushParagraph();
        if (inList) {
          result.push(listType === 'ol' ? '</ol>' : '</ul>');
          inList = false;
          listType = null;
        }
        result.push(`<h5>${h4Match[1]}</h5>`);
      } else if (h3Match) {
        flushParagraph();
        if (inList) {
          result.push(listType === 'ol' ? '</ol>' : '</ul>');
          inList = false;
          listType = null;
        }
        result.push(`<h4>${h3Match[1]}</h4>`);
      } else if (h2Match) {
        flushParagraph();
        if (inList) {
          result.push(listType === 'ol' ? '</ol>' : '</ul>');
          inList = false;
          listType = null;
        }
        result.push(`<h4>${h2Match[1]}</h4>`);
      } else if (bulletMatch) {
        flushParagraph();
        if (listType !== 'ul') {
          if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>');
          result.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        result.push(`<li>${bulletMatch[1]}</li>`);
      } else if (numberedMatch) {
        flushParagraph();
        if (listType !== 'ol') {
          if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
          result.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        result.push(`<li>${numberedMatch[1]}</li>`);
      } else {
        if (inList) {
          result.push(listType === 'ol' ? '</ol>' : '</ul>');
          inList = false;
          listType = null;
        }
        if (trimmedLine) {
          paragraphLines.push(trimmedLine);
        } else {
          flushParagraph();
        }
      }
    }

    // Close any open list
    if (inList) {
      result.push(listType === 'ol' ? '</ol>' : '</ul>');
    }
    flushParagraph();

    return result.join('');
  }

  // Create side panel HTML - chips at TOP
  function createChatPanel() {
    const panel = document.createElement('div');
    panel.id = 'ai-chat-panel';
    panel.className = 'ai-chat-panel';
    panel.style.width = panelWidth + 'px';
    panel.style.right = '-' + (panelWidth + 20) + 'px';
    panel.innerHTML = `
      <div class="ai-chat-resize-handle" id="ai-chat-resize-handle" title="Glisser pour redimensionner"></div>
      <div class="ai-chat-header">
        <h3>Aide IA</h3>
        <div class="style-selector" title="Choisis le style d'aide">
          <button class="style-btn active" data-style="classique" onclick="window.AIChat.setStyle('classique')">
            <span class="style-emoji">🧭</span>
            <span class="style-label">Classique</span>
          </button>
          <button class="style-btn" data-style="fun" onclick="window.AIChat.setStyle('fun')">
            <span class="style-emoji">🤩</span>
            <span class="style-label">Fun</span>
          </button>
          <button class="style-btn" data-style="sceptique" onclick="window.AIChat.setStyle('sceptique')">
            <span class="style-emoji">🤨</span>
            <span class="style-label">Sceptique</span>
          </button>
        </div>
        <div class="header-spacer"></div>
        <button class="ai-chat-close" onclick="window.AIChat.close()" title="Fermer">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="ai-chat-context" id="ai-chat-context"></div>
      <div class="ai-chat-chips" id="ai-chat-chips">
        <button class="ai-chip" data-intent="HINT" onclick="window.AIChat.sendIntent('HINT')">
          ❓ Indice
        </button>
        <button class="ai-chip" data-intent="EXPLANATION" onclick="window.AIChat.sendIntent('EXPLANATION')">
          💡 Explication
        </button>
        <button class="ai-chip" data-intent="WHY_WRONG" onclick="window.AIChat.sendIntent('WHY_WRONG')">
          ❌ Pourquoi c'est faux?
        </button>
        <button class="ai-chip" data-intent="CHECK_REASONING" onclick="window.AIChat.sendIntent('CHECK_REASONING')">
          ✅ Vérifie mon raisonnement
        </button>
        <button class="ai-chip" data-intent="SIMILAR_QUESTION" onclick="window.AIChat.sendIntent('SIMILAR_QUESTION')">
          🎯 Question similaire
        </button>
      </div>
      <div class="ai-chat-messages" id="ai-chat-messages">
        <div class="ai-chat-welcome">
          <p>Je suis ton assistant pour cet exercice.<br>Utilise les boutons ci-dessus pour obtenir des pistes, puis pose ta question ci-dessous pour approfondir ou clarifier un point.</p>
        </div>
      </div>
      <div class="ai-chat-input-area">
        <input type="text" id="ai-chat-input" placeholder="Pose ta question..." autocomplete="off">
        <button class="ai-chat-send" id="ai-chat-send" title="Envoyer">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
      <div class="ai-chat-token-info" id="ai-chat-token-info">
        <div class="token-bar-container">
          <div class="token-bar" id="token-bar"></div>
        </div>
        <span class="token-text" id="token-text">Tokens: -- / --</span>
      </div>
    `;
    document.body.appendChild(panel);
    chatPanel = panel;

    document.getElementById('ai-chat-send').addEventListener('click', () => sendMessage('FREE_TEXT'));
    document.getElementById('ai-chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage('FREE_TEXT');
    });

    // Setup resize functionality
    setupResizeHandle();

    // Initialize token display
    updateTokenDisplay();
  }

  // Resize handle functionality
  function setupResizeHandle() {
    const handle = document.getElementById('ai-chat-resize-handle');
    if (!handle) return;

    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = chatPanel.offsetWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      // Calculate new width (dragging left = increase width, right = decrease)
      const diff = startX - e.clientX;
      let newWidth = startWidth + diff;

      // Clamp to min/max
      newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));

      // Apply width
      chatPanel.style.width = newWidth + 'px';
      panelWidth = newWidth;

      // Update body margin if panel is open
      if (chatPanel.classList.contains('open')) {
        document.body.style.marginRight = (newWidth + 10) + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Save width preference
        localStorage.setItem('aiChatPanelWidth', panelWidth);
      }
    });

    // Touch support for mobile
    handle.addEventListener('touchstart', (e) => {
      isResizing = true;
      startX = e.touches[0].clientX;
      startWidth = chatPanel.offsetWidth;
      e.preventDefault();
    });

    document.addEventListener('touchmove', (e) => {
      if (!isResizing) return;
      const diff = startX - e.touches[0].clientX;
      let newWidth = startWidth + diff;
      newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
      chatPanel.style.width = newWidth + 'px';
      panelWidth = newWidth;
      if (chatPanel.classList.contains('open')) {
        document.body.style.marginRight = (newWidth + 10) + 'px';
      }
    });

    document.addEventListener('touchend', () => {
      if (isResizing) {
        isResizing = false;
        localStorage.setItem('aiChatPanelWidth', panelWidth);
      }
    });
  }

  // Check if the student's answer is correct
  function isAnswerCorrect(studentAnswer) {
    if (!studentAnswer || !currentContext || !currentContext.correctAnswer) return null;

    // Normalize both answers for comparison (remove spaces, lowercase)
    const normalize = (s) => s.replace(/\s+/g, '').toLowerCase();
    return normalize(studentAnswer) === normalize(currentContext.correctAnswer);
  }

  // Short congratulatory messages
  const shortCongrats = [
    'Bravo 😊',
    'Bravo 🎉',
    'Bravo 👏',
    'Super 🌟',
    'Parfait ✨',
    'Excellent 💪'
  ];

  function getRandomCongrats() {
    return shortCongrats[Math.floor(Math.random() * shortCongrats.length)];
  }

  // Update the context display with current student answer
  function updateContextDisplay() {
    const contextDiv = document.getElementById('ai-chat-context');
    if (!contextDiv || !currentContext) return;

    const studentAnswer = getCurrentStudentAnswer();
    const correct = isAnswerCorrect(studentAnswer);

    let contextHtml = `<strong>Question:</strong> ${currentContext.question}`;
    if (studentAnswer) {
      let statusBadge = '';
      if (correct === true) {
        statusBadge = ' <span style="color: #28a745; font-weight: bold;">(correct)</span> — ' + getRandomCongrats();
      } else if (correct === false) {
        statusBadge = ' <span style="color: #dc3545; font-weight: bold;">(incorrect)</span>';
      }
      contextHtml += `<br><strong>Votre réponse:</strong> ${studentAnswer}${statusBadge}`;
    } else {
      contextHtml += `<br><strong>Votre réponse:</strong> <em style="color: #888;">Pas sélectionnée</em>`;
    }
    contextDiv.innerHTML = contextHtml;

    // Update chips visibility based on answer state
    updateChipsVisibility(correct);

    if (window.MathJax) {
      MathJax.typesetPromise([contextDiv]);
    }
  }

  // Show/hide chips based on whether answer is correct
  function updateChipsVisibility(correct) {
    const hintChip = document.querySelector('.ai-chip[data-intent="HINT"]');
    const explanationChip = document.querySelector('.ai-chip[data-intent="EXPLANATION"]');
    const whyWrongChip = document.querySelector('.ai-chip[data-intent="WHY_WRONG"]');
    const checkReasoningChip = document.querySelector('.ai-chip[data-intent="CHECK_REASONING"]');
    const similarQuestionChip = document.querySelector('.ai-chip[data-intent="SIMILAR_QUESTION"]');

    if (correct === true) {
      // Correct answer: show "Vérifie mon raisonnement" and "Question similaire"
      if (hintChip) hintChip.style.display = 'none';
      if (explanationChip) explanationChip.style.display = 'none';
      if (whyWrongChip) whyWrongChip.style.display = 'none';
      if (checkReasoningChip) checkReasoningChip.style.display = 'inline-block';
      if (similarQuestionChip) similarQuestionChip.style.display = 'inline-block';
    } else if (correct === false) {
      // Wrong answer: show hint, explanation, and why wrong
      if (hintChip) hintChip.style.display = 'inline-block';
      if (explanationChip) explanationChip.style.display = 'inline-block';
      if (whyWrongChip) whyWrongChip.style.display = 'inline-block';
      if (checkReasoningChip) checkReasoningChip.style.display = 'none';
      if (similarQuestionChip) similarQuestionChip.style.display = 'none';
    } else {
      // No answer selected: show hint and explanation
      if (hintChip) hintChip.style.display = 'inline-block';
      if (explanationChip) explanationChip.style.display = 'inline-block';
      if (whyWrongChip) whyWrongChip.style.display = 'none';
      if (checkReasoningChip) checkReasoningChip.style.display = 'none';
      if (similarQuestionChip) similarQuestionChip.style.display = 'none';
    }
  }

  // Open panel with question context
  function openChat(question, hint, explanation, correctAnswer, buttonElement) {
    if (!chatPanel) createChatPanel();

    const newQuestionId = generateQuestionId(question);
    const isQuestionChange = currentQuestionId !== null && currentQuestionId !== newQuestionId;
    const wasPanelOpen = chatPanel && chatPanel.classList.contains('open');

    // Check if we're switching to a different question
    if (isQuestionChange || currentQuestionId === null) {
      // RESET for new question (per specification)
      conversationHistory = [];
      aiTurnCount = 0;

      // Reset style mode to 'classique' on question change
      styleMode = 'classique';
      document.querySelectorAll('.style-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === 'classique');
      });
    }

    currentQuestionId = newQuestionId;

    // Store context with button reference for dynamic answer lookup
    currentContext = {
      question,
      hint,
      explanation,
      correctAnswer,
      buttonElement,
      attemptCount: 0
    };

    // Update context display
    updateContextDisplay();

    // Add listeners to radio buttons to update context when answer changes
    if (buttonElement) {
      const questionButtons = buttonElement.closest('.question-buttons');
      if (questionButtons) {
        let sibling = questionButtons.previousElementSibling;
        while (sibling) {
          if (sibling.classList && sibling.classList.contains('webex-radiogroup')) {
            const radios = sibling.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
              // Remove old listener to avoid duplicates, then add new one
              radio.removeEventListener('change', updateContextDisplay);
              radio.addEventListener('change', updateContextDisplay);
            });
            break;
          }
          sibling = sibling.previousElementSibling;
        }
      }
    }

    const messagesDiv = document.getElementById('ai-chat-messages');

    // Show welcome message (fresh for new question)
    messagesDiv.innerHTML = `
      <div class="ai-chat-welcome">
        <p>Je suis ton assistant pour cette question.<br>Utilise les boutons ci-dessus pour obtenir des pistes, puis pose ta question ci-dessous pour approfondir ou clarifier un point.</p>
      </div>
    `;

    // If panel was already open and we switched questions, show a subtle notification
    if (wasPanelOpen && isQuestionChange) {
      showContextSwitchNotification();
    }

    chatPanel.classList.add('open');
    chatPanel.style.right = '0';
    document.body.style.marginRight = (panelWidth + 10) + 'px';

    const contextDiv = document.getElementById('ai-chat-context');
    if (window.MathJax && contextDiv) {
      MathJax.typesetPromise([contextDiv]);
    }
  }

  // Show a subtle notification when context switches
  function showContextSwitchNotification() {
    const messagesDiv = document.getElementById('ai-chat-messages');
    const notification = document.createElement('div');
    notification.className = 'ai-context-switch-notice';
    notification.innerHTML = '🔄 Assistant mis à jour pour la nouvelle question';
    messagesDiv.insertBefore(notification, messagesDiv.firstChild);

    // Fade out after 3 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 500);
    }, 3000);
  }

  // Close panel
  function closeChat() {
    if (chatPanel) {
      chatPanel.classList.remove('open');
      chatPanel.style.right = '-' + (panelWidth + 20) + 'px';
      document.body.style.marginRight = '';
    }
  }

  // Send message with intent
  async function sendIntent(intent) {
    const intentMessages = {
      'HINT': 'Peux-tu me donner un indice?',
      'EXPLANATION': 'Peux-tu m\'expliquer ce problème et le concept testé?',
      'WHY_WRONG': 'Pourquoi ma réponse est-elle fausse?',
      'CHECK_REASONING': 'Peux-tu vérifier mon raisonnement?',
      'SIMILAR_QUESTION': 'Peux-tu me proposer une question similaire pour m\'entraîner?'
    };

    const message = intentMessages[intent] || '';
    await sendMessage(intent, message);
  }

  // Send message
  async function sendMessage(intent, presetMessage = null) {
    const input = document.getElementById('ai-chat-input');
    const message = presetMessage || input.value.trim();

    if (!message && intent === 'FREE_TEXT') return;

    input.value = '';

    const welcome = document.querySelector('.ai-chat-welcome');
    if (welcome) welcome.remove();

    // Show user message
    if (message) {
      addMessage(message, 'user');
    }

    const typing = addTypingIndicator();
    aiTurnCount++;

    // Get current student answer dynamically (in case they changed it)
    const studentAnswer = getCurrentStudentAnswer();
    updateContextDisplay();

    // Determine if answer is correct (for context flag, but don't send the actual answer)
    const answerCorrect = isAnswerCorrect(studentAnswer);

    try {
      const response = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          conversationHistory: conversationHistory,
          context: {
            question: currentContext.question,
            hint: currentContext.hint,
            studentAnswer: studentAnswer,
            isCorrect: answerCorrect,
            attemptCount: studentAnswer ? 1 : 0,
            aiTurnCount: aiTurnCount,
            intent: intent,
            styleMode: styleMode,
            source: detectSource()
          }
        })
      });

      const data = await response.json();
      typing.remove();

      // Update token display
      if (data.tokens) {
        updateTokenDisplay(data.tokens);
      }

      if (data.error) {
        addMessage(data.error, 'error');
        // Also update token display from error response (quota exceeded)
        if (data.tokensUsed !== undefined) {
          updateTokenDisplay({
            used: data.tokensUsed,
            remaining: data.tokensRemaining,
            max: data.tokensMax
          });
        }
      } else {
        conversationHistory.push({ role: 'user', content: message });
        conversationHistory.push({ role: 'assistant', content: data.response });

        if (conversationHistory.length > 20) {
          conversationHistory = conversationHistory.slice(-20);
        }

        // Parse markdown before displaying
        const formattedResponse = parseMarkdown(data.response);
        addMessage(formattedResponse, 'assistant');
      }
    } catch (error) {
      typing.remove();
      addMessage('Erreur de connexion. Veuillez réessayer.', 'error');
    }
  }

  function addMessage(content, type) {
    const messages = document.getElementById('ai-chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `ai-chat-message ${type}`;
    msgDiv.innerHTML = content;
    messages.appendChild(msgDiv);
    messages.scrollTop = messages.scrollHeight;

    if (window.MathJax && type === 'assistant') {
      MathJax.typesetPromise([msgDiv]);
    }

    return msgDiv;
  }

  function addTypingIndicator() {
    const messages = document.getElementById('ai-chat-messages');
    const typing = document.createElement('div');
    typing.className = 'ai-typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
    return typing;
  }

  function setStyleMode(mode) {
    styleMode = mode;
    // Update button states
    document.querySelectorAll('.style-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.style === mode);
    });
  }

  // Update token display
  function updateTokenDisplay(tokens) {
    if (tokens) {
      // Update tokenInfo with server data (server is source of truth)
      tokenInfo = {
        used: tokens.used !== undefined ? tokens.used : tokenInfo.used,
        remaining: tokens.remaining !== undefined ? tokens.remaining : tokenInfo.remaining,
        max: tokens.max || tokenInfo.max,
        lastRequest: tokens.total || 0,
        resetTime: tokenInfo.resetTime || (Date.now() + TOKEN_QUOTA_WINDOW_MS)
      };
      // Save to localStorage for persistence across page loads
      saveTokenInfo();
    }

    const tokenBar = document.getElementById('token-bar');
    const tokenText = document.getElementById('token-text');

    if (tokenBar && tokenText) {
      const percentage = Math.max(0, Math.min(100, (tokenInfo.remaining / tokenInfo.max) * 100));
      tokenBar.style.width = percentage + '%';

      // Color based on remaining tokens
      if (percentage > 50) {
        tokenBar.style.backgroundColor = '#28a745'; // Green
      } else if (percentage > 20) {
        tokenBar.style.backgroundColor = '#ffc107'; // Yellow
      } else {
        tokenBar.style.backgroundColor = '#dc3545'; // Red
      }

      // Format numbers with thousands separator
      const formatNum = (n) => n.toLocaleString('fr-FR');
      tokenText.textContent = `Tokens: ${formatNum(tokenInfo.remaining)} / ${formatNum(tokenInfo.max)}`;

      if (tokenInfo.lastRequest > 0) {
        tokenText.title = `Dernière requête: ${tokenInfo.lastRequest} tokens`;
      }
    }
  }

  window.openAIHelp = function(question, hint, explanation, correctAnswer, buttonElement) {
    openChat(question, hint, explanation, correctAnswer, buttonElement);
  };

  window.AIChat = {
    open: openChat,
    close: closeChat,
    sendIntent: sendIntent,
    setStyle: setStyleMode
  };
})();
</script>
