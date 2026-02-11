<script>
/* Print Exercises - Links to pre-generated PDF files */
(function() {
  'use strict';

  function getWeekNumber() {
    var match = window.location.pathname.match(/exercices_semaine_(\d+)/);
    return match ? match[1] : null;
  }

  function init() {
    var week = getWeekNumber();
    if (!week) return;
    createDownloadButton(week);
  }

  function createDownloadButton(week) {
    var mainContent = document.querySelector('main.content') || document.querySelector('main') || document.querySelector('#quarto-content');
    if (!mainContent) return;

    var basePath = 'exercises_pdf/exercices_semaine_' + week;

    var bar = document.createElement('div');
    bar.className = 'print-download-bar';
    bar.innerHTML =
      '<div class="print-download-dropdown">' +
        '<button class="print-download-btn" aria-haspopup="true" aria-expanded="false">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">' +
            '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>' +
          '</svg>' +
          'T\u00e9l\u00e9charger les exercices' +
        '</button>' +
        '<div class="print-download-menu" role="menu">' +
          '<a class="print-download-option" href="' + basePath + '_sans_reponses.pdf" target="_blank" role="menuitem">' +
            'Sans r\u00e9ponses' +
          '</a>' +
          '<a class="print-download-option" href="' + basePath + '_avec_reponses.pdf" target="_blank" role="menuitem">' +
            'Avec r\u00e9ponses' +
          '</a>' +
        '</div>' +
      '</div>';

    var insertAfter = mainContent.querySelector('.breadcrumbs') ||
                      mainContent.querySelector('#title-block-header') ||
                      mainContent.querySelector('header');

    if (insertAfter && insertAfter.nextSibling) {
      mainContent.insertBefore(bar, insertAfter.nextSibling);
    } else {
      var firstSection = mainContent.querySelector('section') || mainContent.querySelector('h2');
      if (firstSection) {
        firstSection.parentNode.insertBefore(bar, firstSection);
      } else {
        mainContent.appendChild(bar);
      }
    }

    var btn = bar.querySelector('.print-download-btn');
    var menu = bar.querySelector('.print-download-menu');

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('click', function() {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });

    menu.addEventListener('click', function(e) {
      e.stopPropagation();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }
})();
</script>
