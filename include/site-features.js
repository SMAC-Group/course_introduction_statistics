<script>
/* Site Features: Dark Mode, Progress Tracking, Question Badges, Breadcrumbs */
(function() {
  'use strict';

  // =============================================
  // DARK MODE
  // =============================================
  function initDarkMode() {
    // Check for saved preference only - default to light mode
    const savedTheme = localStorage.getItem('theme');

    // Only use dark mode if explicitly saved by user
    if (savedTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }

    // Add toggle button to navbar
    const navbar = document.querySelector('.navbar-nav');
    if (navbar) {
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'theme-toggle';
      toggleBtn.setAttribute('aria-label', 'Changer le thème');
      toggleBtn.innerHTML = `
        <svg class="moon-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
        <svg class="sun-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2"/>
          <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2"/>
          <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2"/>
          <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2"/>
        </svg>
      `;

      toggleBtn.addEventListener('click', toggleTheme);

      // Insert at the end of navbar
      const navbarContainer = document.querySelector('.navbar-collapse') || navbar.parentElement;
      if (navbarContainer) {
        navbarContainer.appendChild(toggleBtn);
      }
    }
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  }

  // =============================================
  // PROGRESS TRACKING
  // =============================================
  function initProgressTracking() {
    // Only run on exercise pages
    const radioGroups = document.querySelectorAll('.webex-radiogroup');
    if (radioGroups.length === 0) return;

    const pageId = window.location.pathname;
    const totalQuestions = radioGroups.length;

    // Get saved progress
    let progress = JSON.parse(localStorage.getItem('exerciseProgress') || '{}');
    if (!progress[pageId]) {
      progress[pageId] = {};
    }

    // Create progress bar
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    progressContainer.innerHTML = `
      <div class="progress-inner">
        <div class="progress-header">
          <span class="progress-title">Progression</span>
          <span class="progress-count"><span id="progress-done">0</span> / ${totalQuestions} questions</span>
        </div>
        <div class="progress-bar-wrapper">
          <div class="progress-bar-fill" id="progress-fill" style="width: 0%"></div>
        </div>
      </div>
    `;

    // Insert into body (fixed positioning)
    document.body.appendChild(progressContainer);
    document.body.classList.add('has-progress-bar');

    // Track each question
    radioGroups.forEach((group, index) => {
      const questionId = `q${index + 1}`;

      // Check if already answered
      if (progress[pageId][questionId]) {
        updateQuestionBadge(index, true);
      }

      // Listen for changes - only mark complete on CORRECT answer
      group.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', () => {
          // Check if this is the correct answer (value="answer")
          if (radio.value === 'answer') {
            progress[pageId][questionId] = true;
            localStorage.setItem('exerciseProgress', JSON.stringify(progress));
            updateProgressBar(pageId, totalQuestions);
            updateQuestionBadge(index, true);
          }
        });
      });
    });

    // Initial progress update
    updateProgressBar(pageId, totalQuestions);
  }

  function updateProgressBar(pageId, total) {
    const progress = JSON.parse(localStorage.getItem('exerciseProgress') || '{}');
    const pageProgress = progress[pageId] || {};
    const done = Object.keys(pageProgress).length;
    const percentage = total > 0 ? (done / total) * 100 : 0;

    const fillEl = document.getElementById('progress-fill');
    const countEl = document.getElementById('progress-done');

    if (fillEl) fillEl.style.width = percentage + '%';
    if (countEl) countEl.textContent = done;
  }

  function updateQuestionBadge(index, completed) {
    const badge = document.querySelector(`[data-question-index="${index}"] .question-badge`);
    if (badge && completed) {
      badge.classList.add('completed');
      // Add checkmark if not already present
      if (!badge.querySelector('.badge-check')) {
        const check = document.createElement('span');
        check.className = 'badge-check';
        check.textContent = ' ✓';
        badge.appendChild(check);
      }
    }
  }

  // =============================================
  // QUESTION BADGES
  // =============================================
  function initQuestionBadges() {
    // Find all h2 elements that contain "Question" or are in exercise sections
    const mainContent = document.querySelector('main.content') || document.querySelector('main');
    if (!mainContent) return;

    const h2Elements = mainContent.querySelectorAll('h2');
    let questionNumber = 0;

    h2Elements.forEach((h2, index) => {
      // Check if this h2 is followed by a radio group (indicating it's a question)
      let nextElement = h2.nextElementSibling;
      let hasRadioGroup = false;

      // Look ahead up to 5 elements for a radio group
      for (let i = 0; i < 5 && nextElement; i++) {
        if (nextElement.classList && nextElement.classList.contains('webex-radiogroup')) {
          hasRadioGroup = true;
          break;
        }
        if (nextElement.querySelector && nextElement.querySelector('.webex-radiogroup')) {
          hasRadioGroup = true;
          break;
        }
        nextElement = nextElement.nextElementSibling;
      }

      if (hasRadioGroup) {
        questionNumber++;

        // Check if h2 already contains "Question X" text
        const h2Text = h2.textContent.trim();
        const questionMatch = h2Text.match(/^Question\s+(\d+)/i);

        // Create badge
        const badge = document.createElement('span');
        badge.className = 'question-badge';
        badge.textContent = `Q${questionNumber}`;

        // Add data attribute for progress tracking
        h2.setAttribute('data-question-index', questionNumber - 1);

        // Check if already completed
        const pageId = window.location.pathname;
        const progress = JSON.parse(localStorage.getItem('exerciseProgress') || '{}');
        if (progress[pageId] && progress[pageId][`q${questionNumber}`]) {
          badge.classList.add('completed');
        }

        // If h2 already says "Question X", just add the badge (which shows Q1, Q2, etc.)
        // The badge serves as a visual indicator without duplicating text
        h2.insertBefore(badge, h2.firstChild);
      }
    });
  }

  // =============================================
  // BREADCRUMBS
  // =============================================
  function initBreadcrumbs() {
    // Only add breadcrumbs on exercise pages
    const isExercisePage = window.location.pathname.includes('exercices_semaine');
    if (!isExercisePage) return;

    const mainContent = document.querySelector('main.content') || document.querySelector('main');
    if (!mainContent) return;

    // Extract week number from URL
    const weekMatch = window.location.pathname.match(/exercices_semaine_(\d+)/);
    const weekNumber = weekMatch ? weekMatch[1] : '';

    const breadcrumbs = document.createElement('nav');
    breadcrumbs.className = 'breadcrumbs';
    breadcrumbs.setAttribute('aria-label', 'Fil d\'Ariane');
    breadcrumbs.innerHTML = `
      <a href="index.html">Accueil</a>
      <span class="separator">›</span>
      <span class="current">Exercices Semaine ${weekNumber}</span>
    `;

    // Insert at the beginning of main content
    mainContent.insertBefore(breadcrumbs, mainContent.firstChild);
  }

  // =============================================
  // INITIALIZE ALL FEATURES
  // =============================================
  function init() {
    initDarkMode();
    initBreadcrumbs();
    initQuestionBadges();
    initProgressTracking();
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
