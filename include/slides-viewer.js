/**
 * Slides Viewer - PDF.js Integration
 * Handles PDF loading, rendering, and navigation
 */

(function() {
  'use strict';

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  const PDF_BASE_PATH = '/slides/';
  const CONTENT_INDEX_PATH = '/content/index-lite.json';
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 4.0;
  const SCALE_STEP = 0.25;
  const DEFAULT_SCALE = 1.8;

  // Week to PDF file mapping (can be string or array for multi-part PDFs)
  const WEEK_TO_PDF = {
    1: 'cours_1.pdf',
    2: 'cours_2.pdf',
    3: 'cours_3.pdf',
    4: 'cours_4.pdf',
    5: 'cours_5.pdf',
    6: 'cours_6.pdf',
    9: 'cours_9.pdf',
    10: ['cours_10_part1.pdf', 'cours_10_part2.pdf'],
    11: 'cours_11.pdf',
    12: 'cours_12.pdf'
  };

  // ============================================================================
  // STATE
  // ============================================================================

  const ViewerState = {
    currentWeek: null,
    currentPage: 1,        // Global page number (1-indexed)
    totalPages: 0,         // Total across all PDF parts
    pdfDocs: [],           // Array of loaded PDF documents
    pdfPageOffsets: [],    // Page offset for each PDF part (e.g., [0, 23] means part1 starts at page 1, part2 at page 24)
    scale: DEFAULT_SCALE,
    pageRendering: false,
    pageNumPending: null,
    courseIndex: null
  };

  // ============================================================================
  // DOM ELEMENTS
  // ============================================================================

  let canvas, ctx, pdfContainer, loadingEl;
  let weekSelect, pageInfo, zoomLevel;
  let prevBtn, nextBtn, zoomInBtn, zoomOutBtn, downloadBtn;
  let resizeHandle, pdfPanel, chatPanel;

  function initElements() {
    canvas = document.getElementById('pdf-canvas');
    ctx = canvas ? canvas.getContext('2d') : null;
    pdfContainer = document.getElementById('pdf-container');
    loadingEl = document.getElementById('pdf-loading');

    weekSelect = document.getElementById('week-select');
    pageInfo = document.getElementById('page-info');
    zoomLevel = document.getElementById('zoom-level');

    prevBtn = document.getElementById('prev-page');
    nextBtn = document.getElementById('next-page');
    zoomInBtn = document.getElementById('zoom-in');
    zoomOutBtn = document.getElementById('zoom-out');
    downloadBtn = document.getElementById('download-pdf');

    resizeHandle = document.getElementById('resize-handle');
    pdfPanel = document.querySelector('.slides-pdf-panel');
    chatPanel = document.getElementById('chat-panel');
  }

  // ============================================================================
  // PDF.JS SETUP
  // ============================================================================

  function setupPdfJs() {
    if (typeof pdfjsLib === 'undefined') {
      console.error('PDF.js library not loaded');
      return false;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    return true;
  }

  // ============================================================================
  // INDEX LOADING
  // ============================================================================

  async function loadCourseIndex() {
    try {
      const response = await fetch(CONTENT_INDEX_PATH);
      if (!response.ok) throw new Error('Failed to load index');

      ViewerState.courseIndex = await response.json();
      populateWeekSelector();
      return true;
    } catch (e) {
      console.error('Error loading course index:', e);
      return false;
    }
  }

  function populateWeekSelector() {
    if (!weekSelect || !ViewerState.courseIndex) return;

    weekSelect.innerHTML = '';

    const weeks = Object.entries(ViewerState.courseIndex.semaines)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    for (const [weekNum, weekData] of weeks) {
      // Only add weeks that have a PDF
      if (WEEK_TO_PDF[weekNum]) {
        const option = document.createElement('option');
        option.value = weekNum;
        option.textContent = `Semaine ${weekNum} - ${weekData.t}`;
        weekSelect.appendChild(option);
      }
    }
  }

  // ============================================================================
  // PDF LOADING
  // ============================================================================

  async function loadPdf(weekNum) {
    const pdfConfig = WEEK_TO_PDF[weekNum];
    if (!pdfConfig) {
      console.error('No PDF for week', weekNum);
      return false;
    }

    // Normalize to array
    const pdfFiles = Array.isArray(pdfConfig) ? pdfConfig : [pdfConfig];

    showLoading(true);

    try {
      // Load all PDF parts
      ViewerState.pdfDocs = [];
      ViewerState.pdfPageOffsets = [];
      let totalPages = 0;

      for (const pdfFile of pdfFiles) {
        const pdfPath = PDF_BASE_PATH + pdfFile;
        const loadingTask = pdfjsLib.getDocument(pdfPath);
        const pdfDoc = await loadingTask.promise;

        ViewerState.pdfPageOffsets.push(totalPages);
        ViewerState.pdfDocs.push(pdfDoc);
        totalPages += pdfDoc.numPages;
      }

      ViewerState.totalPages = totalPages;
      ViewerState.currentWeek = parseInt(weekNum);
      ViewerState.currentPage = 1;

      updatePageInfo();
      await renderPage(1);

      showLoading(false);
      return true;
    } catch (e) {
      console.error('Error loading PDF:', e);
      showLoading(false);
      showError('Erreur lors du chargement du PDF');
      return false;
    }
  }

  // Helper: Get which PDF part and local page number for a global page
  function getPdfPartAndLocalPage(globalPage) {
    for (let i = ViewerState.pdfDocs.length - 1; i >= 0; i--) {
      if (globalPage > ViewerState.pdfPageOffsets[i]) {
        return {
          pdfIndex: i,
          pdfDoc: ViewerState.pdfDocs[i],
          localPage: globalPage - ViewerState.pdfPageOffsets[i]
        };
      }
    }
    return { pdfIndex: 0, pdfDoc: ViewerState.pdfDocs[0], localPage: globalPage };
  }

  function showLoading(show) {
    if (loadingEl) {
      loadingEl.classList.toggle('hidden', !show);
    }
    if (canvas) {
      canvas.style.display = show ? 'none' : 'block';
    }
  }

  function showError(message) {
    if (loadingEl) {
      loadingEl.innerHTML = `<span style="color: #f87171;">${message}</span>`;
      loadingEl.classList.remove('hidden');
    }
  }

  // ============================================================================
  // PAGE RENDERING
  // ============================================================================

  async function renderPage(pageNum) {
    if (ViewerState.pdfDocs.length === 0 || !canvas || !ctx) return;

    if (ViewerState.pageRendering) {
      ViewerState.pageNumPending = pageNum;
      return;
    }

    ViewerState.pageRendering = true;

    try {
      // Get the correct PDF part and local page number
      const { pdfDoc, localPage } = getPdfPartAndLocalPage(pageNum);
      const page = await pdfDoc.getPage(localPage);
      const viewport = page.getViewport({ scale: ViewerState.scale });

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport
      };

      await page.render(renderContext).promise;

      ViewerState.pageRendering = false;
      ViewerState.currentPage = pageNum;

      updatePageInfo();
      emitSlideChanged();

      // Check if there's a pending page
      if (ViewerState.pageNumPending !== null) {
        const pending = ViewerState.pageNumPending;
        ViewerState.pageNumPending = null;
        renderPage(pending);
      }
    } catch (e) {
      console.error('Error rendering page:', e);
      ViewerState.pageRendering = false;
    }
  }

  // ============================================================================
  // NAVIGATION
  // ============================================================================

  function goToPage(pageNum) {
    if (pageNum < 1) pageNum = 1;
    if (pageNum > ViewerState.totalPages) pageNum = ViewerState.totalPages;

    if (pageNum !== ViewerState.currentPage) {
      renderPage(pageNum);
    }
  }

  function prevPage() {
    goToPage(ViewerState.currentPage - 1);
  }

  function nextPage() {
    goToPage(ViewerState.currentPage + 1);
  }

  function updatePageInfo() {
    if (pageInfo) {
      pageInfo.textContent = `Page ${ViewerState.currentPage} / ${ViewerState.totalPages}`;
    }

    if (prevBtn) {
      prevBtn.disabled = ViewerState.currentPage <= 1;
    }
    if (nextBtn) {
      nextBtn.disabled = ViewerState.currentPage >= ViewerState.totalPages;
    }
  }

  // ============================================================================
  // ZOOM
  // ============================================================================

  function setZoom(newScale) {
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

    if (newScale !== ViewerState.scale) {
      ViewerState.scale = newScale;
      updateZoomDisplay();
      renderPage(ViewerState.currentPage);
    }
  }

  function zoomIn() {
    setZoom(ViewerState.scale + SCALE_STEP);
  }

  function zoomOut() {
    setZoom(ViewerState.scale - SCALE_STEP);
  }

  function updateZoomDisplay() {
    if (zoomLevel) {
      zoomLevel.textContent = Math.round(ViewerState.scale * 100) + '%';
    }

    if (zoomOutBtn) {
      zoomOutBtn.disabled = ViewerState.scale <= MIN_SCALE;
    }
    if (zoomInBtn) {
      zoomInBtn.disabled = ViewerState.scale >= MAX_SCALE;
    }
  }

  // ============================================================================
  // SLIDE CHANGE EVENT
  // ============================================================================

  function emitSlideChanged() {
    const slideInfo = getSlideInfo(ViewerState.currentWeek, ViewerState.currentPage);

    window.dispatchEvent(new CustomEvent('slideChanged', {
      detail: {
        week: ViewerState.currentWeek,
        page: ViewerState.currentPage,
        totalPages: ViewerState.totalPages,
        weekTitle: slideInfo.weekTitle,
        slideTitle: slideInfo.slideTitle
      }
    }));

    // Update URL hash for bookmarking
    const hash = `semaine=${ViewerState.currentWeek}&page=${ViewerState.currentPage}`;
    history.replaceState(null, '', '#' + hash);
  }

  function getSlideInfo(weekNum, pageNum) {
    let weekTitle = `Semaine ${weekNum}`;
    let slideTitle = `Slide ${pageNum}`;

    if (ViewerState.courseIndex && ViewerState.courseIndex.semaines[weekNum]) {
      const weekData = ViewerState.courseIndex.semaines[weekNum];
      weekTitle = weekData.t;

      const slide = weekData.s.find(s => s[0] === pageNum);
      if (slide) {
        slideTitle = slide[1];
      }
    }

    return { weekTitle, slideTitle };
  }

  // ============================================================================
  // RESIZE HANDLE
  // ============================================================================

  function setupResizeHandle() {
    if (!resizeHandle || !pdfPanel || !chatPanel) return;

    let isResizing = false;
    let startX, startWidth;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = pdfPanel.offsetWidth;

      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const diff = e.clientX - startX;
      const newWidth = startWidth + diff;
      const containerWidth = pdfPanel.parentElement.offsetWidth;

      // Constrain between 30% and 80%
      const minWidth = containerWidth * 0.3;
      const maxWidth = containerWidth * 0.8;

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        pdfPanel.style.flex = `0 0 ${newWidth}px`;
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // ============================================================================
  // KEYBOARD NAVIGATION
  // ============================================================================

  function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      // Don't handle if user is typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          prevPage();
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          nextPage();
          break;
        case 'Home':
          e.preventDefault();
          goToPage(1);
          break;
        case 'End':
          e.preventDefault();
          goToPage(ViewerState.totalPages);
          break;
        case '+':
        case '=':
          e.preventDefault();
          zoomIn();
          break;
        case '-':
          e.preventDefault();
          zoomOut();
          break;
      }
    });
  }

  // ============================================================================
  // URL HASH HANDLING
  // ============================================================================

  function parseUrlHash() {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);

    return {
      week: parseInt(params.get('semaine')) || null,
      page: parseInt(params.get('page')) || 1
    };
  }

  async function loadFromHash() {
    const { week, page } = parseUrlHash();

    if (week && WEEK_TO_PDF[week]) {
      weekSelect.value = week;
      await loadPdf(week);
      if (page > 1 && page <= ViewerState.totalPages) {
        goToPage(page);
      }
    } else {
      // Load first available week
      const firstWeek = Object.keys(WEEK_TO_PDF)[0];
      if (firstWeek) {
        weekSelect.value = firstWeek;
        await loadPdf(firstWeek);
      }
    }
  }

  // ============================================================================
  // DOWNLOAD
  // ============================================================================

  function downloadPdf() {
    const weekNum = ViewerState.currentWeek;
    if (!weekNum) return;

    const pdfConfig = WEEK_TO_PDF[weekNum];
    if (!pdfConfig) return;

    const pdfFiles = Array.isArray(pdfConfig) ? pdfConfig : [pdfConfig];

    for (const pdfFile of pdfFiles) {
      const link = document.createElement('a');
      link.href = PDF_BASE_PATH + pdfFile;
      link.download = pdfFile;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  // ============================================================================
  // EVENT BINDINGS
  // ============================================================================

  function bindEvents() {
    // Navigation buttons
    if (prevBtn) prevBtn.addEventListener('click', prevPage);
    if (nextBtn) nextBtn.addEventListener('click', nextPage);

    // Zoom buttons
    if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);

    // Download button
    if (downloadBtn) downloadBtn.addEventListener('click', downloadPdf);

    // Week selector
    if (weekSelect) {
      weekSelect.addEventListener('change', (e) => {
        loadPdf(e.target.value);
      });
    }

    // Handle hash changes
    window.addEventListener('hashchange', loadFromHash);
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async function init() {
    initElements();

    if (!setupPdfJs()) {
      showError('PDF.js non disponible');
      return;
    }

    await loadCourseIndex();

    bindEvents();
    setupResizeHandle();
    setupKeyboardNavigation();
    updateZoomDisplay();

    await loadFromHash();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.SlidesViewer = {
    getState: () => ViewerState,
    goToPage,
    setZoom
  };

})();
