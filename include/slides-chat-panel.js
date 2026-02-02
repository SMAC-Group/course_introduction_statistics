/**
 * Slides Chat Panel - Contextual AI Chat for Slide Viewer
 * Separate from the exercise chat system
 */

(function() {
  'use strict';

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  const CHAT_API_ENDPOINT = '/.netlify/functions/slides-chat';
  const CONTENT_BASE_PATH = '/content';
  const TOKEN_STORAGE_KEY = 'aiChatTokenInfo';
  const TOKEN_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
  const MAX_HISTORY_LENGTH = 20;

  // ============================================================================
  // STATE
  // ============================================================================

  let conversationHistory = [];
  let currentSlideContext = {
    week: null,
    page: null,
    weekTitle: '',
    slideTitle: '',
    slideContent: ''
  };
  let tokenInfo = null;
  let styleMode = 'classique'; // 'classique', 'fun', or 'sceptique'

  // ============================================================================
  // DOM ELEMENTS
  // ============================================================================

  let messagesContainer, chatInput, sendButton;
  let contextWeekEl, contextSlideEl;
  let tokenBar, tokenText;

  function initElements() {
    messagesContainer = document.getElementById('chat-messages');
    chatInput = document.getElementById('chat-input');
    sendButton = document.getElementById('chat-send');
    contextWeekEl = document.getElementById('context-week');
    contextSlideEl = document.getElementById('context-slide');
    tokenBar = document.getElementById('token-bar');
    tokenText = document.getElementById('token-text');
  }

  // ============================================================================
  // TOKEN QUOTA MANAGEMENT (Shared with exercise chat via localStorage)
  // ============================================================================

  function loadTokenInfo() {
    try {
      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        // Check if quota should be reset (24h passed)
        if (data.resetTime && Date.now() > data.resetTime) {
          return { used: 0, remaining: 50000, max: 50000, resetTime: Date.now() + TOKEN_QUOTA_WINDOW_MS };
        }
        return data;
      }
    } catch (e) {
      console.warn('Failed to load token info:', e);
    }
    return { used: 0, remaining: 50000, max: 50000, resetTime: Date.now() + TOKEN_QUOTA_WINDOW_MS };
  }

  function saveTokenInfo() {
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenInfo));
    } catch (e) {
      console.warn('Failed to save token info:', e);
    }
  }

  function updateTokenDisplay(tokens) {
    if (tokens && tokens.total > 0) {
      const tokensUsedThisRequest = tokens.total || 0;
      const newUsed = tokenInfo.used + tokensUsedThisRequest;
      const newRemaining = Math.max(0, tokenInfo.max - newUsed);

      tokenInfo = {
        used: newUsed,
        remaining: newRemaining,
        max: tokens.max || tokenInfo.max,
        lastRequest: tokensUsedThisRequest,
        resetTime: tokenInfo.resetTime || (Date.now() + TOKEN_QUOTA_WINDOW_MS)
      };
      saveTokenInfo();
    }

    if (tokenBar && tokenText) {
      const percentage = Math.max(0, Math.min(100, (tokenInfo.remaining / tokenInfo.max) * 100));
      tokenBar.style.width = percentage + '%';

      if (percentage > 50) {
        tokenBar.style.backgroundColor = '#28a745';
      } else if (percentage > 20) {
        tokenBar.style.backgroundColor = '#ffc107';
      } else {
        tokenBar.style.backgroundColor = '#dc3545';
      }

      const formatNum = (n) => n.toLocaleString('fr-FR');
      tokenText.textContent = 'Tokens: ' + formatNum(tokenInfo.remaining) + ' / ' + formatNum(tokenInfo.max);

      if (tokenInfo.lastRequest > 0) {
        tokenText.title = 'Derniere requete: ' + tokenInfo.lastRequest + ' tokens';
      }
    }
  }

  // ============================================================================
  // SLIDE CONTEXT LOADING
  // ============================================================================

  async function loadSlideContent(week, page) {
    try {
      const response = await fetch(`${CONTENT_BASE_PATH}/semaine_${week}/slide_${page}.json`);
      if (response.ok) {
        const data = await response.json();
        currentSlideContext.slideContent = data.c || '';
      } else {
        currentSlideContext.slideContent = '';
      }
    } catch (e) {
      console.warn('Could not load slide content:', e);
      currentSlideContext.slideContent = '';
    }
  }

  function updateContextBanner() {
    if (contextWeekEl) {
      contextWeekEl.textContent = `Semaine ${currentSlideContext.week} - ${currentSlideContext.weekTitle}`;
    }
    if (contextSlideEl) {
      contextSlideEl.textContent = `Slide ${currentSlideContext.page}: ${currentSlideContext.slideTitle}`;
    }
  }

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  function parseMarkdown(text) {
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Headers
    text = text.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    // Bullet lists
    text = text.replace(/^- (.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // Numbered lists
    text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // Paragraphs
    text = text.replace(/\n\n/g, '</p><p>');
    return '<p>' + text + '</p>';
  }

  function addMessage(content, role, isError = false) {
    // Remove welcome message if present
    const welcome = messagesContainer.querySelector('.slides-chat-welcome');
    if (welcome) welcome.remove();

    const msgEl = document.createElement('div');
    msgEl.className = 'slides-chat-message ' + (isError ? 'error' : role);

    if (role === 'assistant') {
      msgEl.innerHTML = parseMarkdown(content);
    } else {
      msgEl.textContent = content;
    }

    messagesContainer.appendChild(msgEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Render MathJax for assistant messages
    if (role === 'assistant' && window.MathJax && window.MathJax.typesetPromise) {
      MathJax.typesetPromise([msgEl]).catch((err) => {
        console.log('MathJax error:', err);
      });
    }

    return msgEl;
  }

  function showTypingIndicator() {
    const typing = document.createElement('div');
    typing.className = 'slides-typing-indicator';
    typing.id = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(typing);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return typing;
  }

  function removeTypingIndicator() {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
  }

  // ============================================================================
  // SEND MESSAGE
  // ============================================================================

  async function sendMessage(message) {
    if (!message || !message.trim()) return;

    // Add user message
    addMessage(message, 'user');
    chatInput.value = '';

    // Show typing indicator
    showTypingIndicator();

    try {
      const response = await fetch(CHAT_API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          conversationHistory: conversationHistory.slice(-10), // Last 10 messages
          slideContext: {
            week: currentSlideContext.week,
            page: currentSlideContext.page,
            weekTitle: currentSlideContext.weekTitle,
            slideTitle: currentSlideContext.slideTitle,
            content: currentSlideContext.slideContent
          },
          styleMode: styleMode
        })
      });

      const data = await response.json();

      removeTypingIndicator();

      // Update token display
      if (data.tokens) {
        updateTokenDisplay(data.tokens);
      }

      if (data.error) {
        addMessage(data.error, 'assistant', true);
        if (data.tokensUsed !== undefined) {
          updateTokenDisplay({
            used: data.tokensUsed,
            remaining: data.tokensRemaining,
            max: data.tokensMax
          });
        }
      } else {
        // Update conversation history
        conversationHistory.push({ role: 'user', content: message });
        conversationHistory.push({ role: 'assistant', content: data.response });

        // Trim history
        if (conversationHistory.length > MAX_HISTORY_LENGTH) {
          conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
        }

        addMessage(data.response, 'assistant');
      }
    } catch (error) {
      removeTypingIndicator();
      addMessage('Erreur de connexion. Reessayez.', 'assistant', true);
      console.error('Chat error:', error);
    }
  }

  // ============================================================================
  // SLIDE CHANGE HANDLER
  // ============================================================================

  async function onSlideChanged(event) {
    const { week, page, weekTitle, slideTitle } = event.detail;

    // Check if slide actually changed
    const slideChanged = (week !== currentSlideContext.week || page !== currentSlideContext.page);

    if (slideChanged) {
      // Update context
      currentSlideContext.week = week;
      currentSlideContext.page = page;
      currentSlideContext.weekTitle = weekTitle;
      currentSlideContext.slideTitle = slideTitle;

      // Load slide content
      await loadSlideContent(week, page);

      // Update banner
      updateContextBanner();

      // Reset conversation for new slide
      conversationHistory = [];

      // Clear messages and show welcome
      if (messagesContainer) {
        messagesContainer.innerHTML = `
          <div class="slides-chat-welcome">
            Pose tes questions sur la slide affichee.<br>
            Je peux t'expliquer les concepts, les formules, ou te donner des exemples.
          </div>
        `;
      }
    }
  }

  // ============================================================================
  // STYLE MODE
  // ============================================================================

  function setStyleMode(mode) {
    styleMode = mode;
    // Update button states
    document.querySelectorAll('.slides-style-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.style === mode);
    });
  }

  // ============================================================================
  // EVENT BINDINGS
  // ============================================================================

  function bindEvents() {
    // Send button
    if (sendButton) {
      sendButton.addEventListener('click', () => {
        sendMessage(chatInput.value);
      });
    }

    // Enter key
    if (chatInput) {
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(chatInput.value);
        }
      });
    }

    // Listen for slide changes
    window.addEventListener('slideChanged', onSlideChanged);

    // Style selector buttons
    document.querySelectorAll('.slides-style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setStyleMode(btn.dataset.style);
      });
    });
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  function init() {
    initElements();
    tokenInfo = loadTokenInfo();
    bindEvents();
    updateTokenDisplay();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
