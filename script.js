/* ===================================================================
   IUS CANONICUM — Interactive Logic
   JSON data loading, real-time search, accordion, canon detail viewer,
   sidebar navigation, responsive menu
   =================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  // --- State ---
  let dbData = null; // Loaded JSON data

  // --- DOM References ---
  const sidebar       = document.getElementById('sidebar');
  const overlay        = document.getElementById('sidebarOverlay');
  const hamburgerBtn   = document.getElementById('hamburgerBtn');
  const navLinks       = document.querySelectorAll('.nav-link');
  const sections       = document.querySelectorAll('.content-section');
  const searchInput    = document.getElementById('searchInput');
  const searchBtn      = document.getElementById('searchBtn');
  const searchResults  = document.getElementById('searchResults');
  const accordionContainer = document.getElementById('accordionContainer');
  const accordionSection   = document.getElementById('accordionSection');
  const canonDetail    = document.getElementById('canonDetail');
  const canonDetailBack = document.getElementById('canonDetailBack');
  const contactForm    = document.getElementById('contactForm');

  // =====================================================================
  // DATA LOADING
  // =====================================================================

  /**
   * Load data from the global DB_DATA constant (declared in data.js).
   * This avoids fetch/CORS issues when opening via file:// protocol.
   */
  function normalizeEstructura(db) {
    if (!db || !db.estructura || !db.canones) return;
    const canonMap = new Map();
    db.canones.forEach(c => canonMap.set(c.numero, c));

    db.estructura.forEach(libro => {
      const hasEmptyTitle = (libro.titulos || []).some(t => !t.nombre || t.nombre.trim() === '');
      if (hasEmptyTitle) {
        const newTitulos = [];
        const seenTitles = new Map();

        (libro.titulos || []).forEach(t => {
          if (!t.nombre || t.nombre.trim() === '') {
            (t.canones || []).forEach(num => {
              const c = canonMap.get(num);
              if (!c) return;
              const titName = (c.titulo || c.capitulo || 'Cánones Generales').trim();
              const key = titName.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
              if (!seenTitles.has(key)) {
                const groupObj = { nombre: titName, canones: [] };
                seenTitles.set(key, groupObj);
                newTitulos.push(groupObj);
              }
              seenTitles.get(key).canones.push(num);
            });
          } else {
            const titName = t.nombre.trim();
            const key = titName.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
            if (!seenTitles.has(key)) {
              const groupObj = { nombre: titName, canones: [] };
              seenTitles.set(key, groupObj);
              newTitulos.push(groupObj);
            }
            (t.canones || []).forEach(num => {
              if (!seenTitles.get(key).canones.includes(num)) {
                seenTitles.get(key).canones.push(num);
              }
            });
          }
        });

        libro.titulos = newTitulos;
      }
    });
  }

  function loadData() {
    if (typeof DB_DATA !== 'undefined') {
      dbData = DB_DATA;
      normalizeEstructura(dbData);
    } else {
      console.error('DB_DATA not found. Make sure data.js is loaded before script.js.');
      return;
    }
    renderAccordion();
  }

  // =====================================================================
  // ACCORDION RENDERING
  // =====================================================================

  function renderAccordion() {
    if (!dbData || !accordionContainer) return;

    const html = dbData.estructura.map((libro, i) => {
      const hasTitulos = libro.titulos && libro.titulos.length > 0;
      const totalCanones = hasTitulos
        ? libro.titulos.reduce((sum, t) => sum + (t.canones ? t.canones.length : 0), 0)
        : 0;

      let innerHtml = '';

      if (hasTitulos) {
        innerHtml = libro.titulos.map(titulo => {
          const canonItems = (titulo.canones || []).map(num => {
            const canon = findCanon(num);
            if (!canon) return '';
            return `
              <div class="accordion-canon-item" data-canon="${canon.numero}" role="button" tabindex="0" aria-label="Ver Canon ${canon.numero}">
                <div class="canon-num-badge">${canon.numero}</div>
                <div class="canon-preview">
                  <div class="canon-preview-title">Canon ${canon.numero}</div>
                  <div class="canon-preview-text">${escapeHtml(canon.texto)}</div>
                </div>
                <svg class="canon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </div>
            `;
          }).join('');

          return `
            <div class="accordion-titulo">
              <button class="accordion-titulo-btn" aria-expanded="false">
                <svg class="titulo-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span>${escapeHtml(titulo.nombre)}</span>
              </button>
              <div class="accordion-titulo-content">
                ${canonItems}
              </div>
            </div>
          `;
        }).join('');
      } else {
        innerHtml = `<div class="accordion-empty">Contenido aún no disponible para este libro.</div>`;
      }

      const badgeText = totalCanones > 0 ? `${totalCanones} cánon${totalCanones > 1 ? 'es' : ''}` : 'Vacío';

      return `
        <div class="accordion-libro" data-libro-index="${i}">
          <button class="accordion-libro-btn" aria-expanded="false">
            <span class="libro-label">${escapeHtml(libro.libro)}</span>
            <span class="libro-badge">${badgeText}</span>
            <svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="accordion-libro-content">
            ${innerHtml}
          </div>
        </div>
      `;
    }).join('');

    accordionContainer.innerHTML = html;
    bindAccordionEvents();
  }

  function bindAccordionEvents() {
    // Libro toggles
    accordionContainer.querySelectorAll('.accordion-libro-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const libro = btn.closest('.accordion-libro');
        const isOpen = libro.classList.contains('open');

        // Close all other libros
        accordionContainer.querySelectorAll('.accordion-libro.open').forEach(el => {
          if (el !== libro) {
            el.classList.remove('open');
            el.querySelector('.accordion-libro-btn').setAttribute('aria-expanded', 'false');
          }
        });

        libro.classList.toggle('open', !isOpen);
        btn.setAttribute('aria-expanded', String(!isOpen));
      });
    });

    // Título toggles
    accordionContainer.querySelectorAll('.accordion-titulo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const titulo = btn.closest('.accordion-titulo');
        const isOpen = titulo.classList.contains('open');
        titulo.classList.toggle('open', !isOpen);
        btn.setAttribute('aria-expanded', String(!isOpen));
      });
    });

    // Canon item clicks
    accordionContainer.querySelectorAll('.accordion-canon-item').forEach(item => {
      item.addEventListener('click', () => {
        const num = parseInt(item.dataset.canon, 10);
        showCanonDetail(num);
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const num = parseInt(item.dataset.canon, 10);
          showCanonDetail(num);
        }
      });
    });
  }

  // =====================================================================
  // CANON DETAIL VIEWER
  // =====================================================================

  function showCanonDetail(numero) {
    const canon = findCanon(numero);
    if (!canon) return;

    // Populate detail panel
    document.getElementById('canonDetailBadge').textContent = canon.capitulo || canon.titulo;
    document.getElementById('canonDetailTitle').textContent = `Canon ${canon.numero}`;

    // Meta chips: libro, capítulo, temas
    const metaHtml = [
      metaChip('book', canon.libro),
      ...canon.temas.map(t => metaChip('tag', t))
    ].join('');
    document.getElementById('canonDetailMeta').innerHTML = metaHtml;

    // Body text
    document.getElementById('canonDetailBody').textContent = canon.texto;

    // Show detail, hide accordion
    canonDetail.style.display = 'block';
    canonDetail.style.animation = 'none';
    canonDetail.offsetHeight; // reflow
    canonDetail.style.animation = '';
    accordionSection.style.display = 'none';

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function hideCanonDetail() {
    canonDetail.style.display = 'none';
    accordionSection.style.display = '';
  }

  canonDetailBack.addEventListener('click', hideCanonDetail);

  function metaChip(type, text) {
    const icons = {
      book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
      tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`
    };
    return `<span class="meta-chip">${icons[type] || ''}${escapeHtml(text)}</span>`;
  }

  // =====================================================================
  // REAL-TIME SEARCH
  // =====================================================================

  let searchDebounce = null;

  function performSearch() {
    const query = searchInput.value.trim();

    if (!query) {
      clearSearchResults();
      return;
    }

    if (!dbData) return;

    const results = searchCanones(query);
    renderSearchResults(results, query);
  }

  function searchCanones(query) {
    const q = normalizeStr(query);

    return dbData.canones.filter(canon => {
      // Match against canon number
      if (String(canon.numero) === q || `canon ${canon.numero}` === q || `canon${canon.numero}` === q) {
        return true;
      }

      // Match against text
      if (normalizeStr(canon.texto).includes(q)) return true;

      // Match against temas
      if (canon.temas.some(t => normalizeStr(t).includes(q))) return true;

      // Match against libro / capítulo / título
      if (normalizeStr(canon.libro).includes(q)) return true;
      if (normalizeStr(canon.capitulo).includes(q)) return true;
      if (normalizeStr(canon.titulo).includes(q)) return true;

      return false;
    });
  }

  function renderSearchResults(results, query) {
    if (results.length === 0) {
      searchResults.innerHTML = `
        <div class="search-results-inner">
          <div class="search-no-results">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="8" y1="8" x2="14" y2="14"/>
              <line x1="14" y1="8" x2="8" y2="14"/>
            </svg>
            No se encontraron resultados para «<strong>${escapeHtml(query)}</strong>»
          </div>
        </div>
      `;
      searchResults.classList.add('has-results');
      return;
    }

    const itemsHtml = results.map(canon => {
      const highlightedText = highlightMatch(canon.texto, query);
      const tagsHtml = canon.temas.map(t =>
        `<span class="search-result-tag">${highlightMatch(t, query)}</span>`
      ).join('');

      return `
        <div class="search-result-item" data-canon="${canon.numero}" role="button" tabindex="0">
          <div class="search-result-number">${canon.numero}</div>
          <div class="search-result-content">
            <div class="search-result-title">Canon ${canon.numero}</div>
            <div class="search-result-excerpt">${highlightedText}</div>
            <div class="search-result-tags">${tagsHtml}</div>
          </div>
        </div>
      `;
    }).join('');

    searchResults.innerHTML = `<div class="search-results-inner">${itemsHtml}</div>`;
    searchResults.classList.add('has-results');

    // Bind click handlers
    searchResults.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const num = parseInt(item.dataset.canon, 10);
        showCanonDetail(num);
        clearSearchResults();
        searchInput.value = '';
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const num = parseInt(item.dataset.canon, 10);
          showCanonDetail(num);
          clearSearchResults();
          searchInput.value = '';
        }
      });
    });
  }

  function clearSearchResults() {
    searchResults.innerHTML = '';
    searchResults.classList.remove('has-results');
  }

  // Real-time input listener (debounced)
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(performSearch, 150);
  });

  // Button click also triggers search
  searchBtn.addEventListener('click', () => {
    performSearch();
  });

  // Enter key triggers search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch();
    }
    if (e.key === 'Escape') {
      clearSearchResults();
      searchInput.value = '';
      searchInput.blur();
    }
  });

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      clearSearchResults();
    }
  });

  // =====================================================================
  // SUGGESTION TAGS
  // =====================================================================

  document.querySelectorAll('.suggestion-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      searchInput.value = tag.dataset.query;
      searchInput.focus();
      performSearch();

      // Visual feedback
      document.querySelectorAll('.suggestion-tag').forEach(t => {
        t.style.background = '';
        t.style.borderColor = '';
        t.style.color = '';
      });
      tag.style.background = 'var(--color-accent-soft)';
      tag.style.borderColor = 'var(--color-accent-border)';
      tag.style.color = 'var(--color-navy)';
    });
  });

  // =====================================================================
  // SIDEBAR NAVIGATION
  // =====================================================================

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    hamburgerBtn.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    hamburgerBtn.classList.remove('active');
    document.body.style.overflow = '';
  }

  hamburgerBtn.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });

  overlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      closeSidebar();
    }
  });

  function switchSection(sectionId) {
    navLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.section === sectionId);
    });

    sections.forEach(section => {
      const isTarget = section.id === `section-${sectionId}`;
      if (isTarget && !section.classList.contains('active')) {
        section.classList.add('active');
        section.style.animation = 'none';
        section.offsetHeight;
        section.style.animation = '';
      } else if (!isTarget) {
        section.classList.remove('active');
      }
    });

    // When switching to inicio, reset canon detail view
    if (sectionId === 'inicio') {
      hideCanonDetail();
      clearSearchResults();
      searchInput.value = '';
    }

    if (window.innerWidth <= 768) closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchSection(link.dataset.section);
    });
  });

  // =====================================================================
  // CONTACT FORM (Simulated)
  // =====================================================================

  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('contactSubmitBtn');
      submitBtn.textContent = 'Enviando…';
      submitBtn.disabled = true;

      setTimeout(() => {
        submitBtn.textContent = '✓ Mensaje enviado';
        submitBtn.style.background = '#2d6a4f';
        setTimeout(() => {
          submitBtn.textContent = 'Enviar mensaje';
          submitBtn.style.background = '';
          submitBtn.disabled = false;
          contactForm.reset();
        }, 2500);
      }, 1000);
    });
  }

  // =====================================================================
  // UTILITY FUNCTIONS
  // =====================================================================

  function findCanon(numero) {
    return dbData ? dbData.canones.find(c => c.numero === numero) : null;
  }

  function normalizeStr(str) {
    if (!str) return '';
    return String(str).toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${q})`, 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }

  // =====================================================================
  // WINDOW RESIZE
  // =====================================================================

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth > 768) closeSidebar();
    }, 100);
  });

  // =====================================================================
  // DYNAMIC KEYFRAMES
  // =====================================================================

  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-6px); }
      40%, 80% { transform: translateX(6px); }
    }
  `;
  document.head.appendChild(style);

  // =====================================================================
  // PRAEDICATE EVANGELIUM — SEARCH MODULE (rewritten)
  // =====================================================================

  // Single in-memory cache — loaded synchronously from pe_data.js global
  var peData = null;

  function loadPeDataFromGlobal() {
    if (peData !== null) return; // already loaded
    if (typeof PE_DATA !== 'undefined' && Array.isArray(PE_DATA)) {
      peData = PE_DATA;
      console.log('[PE Search] PE_DATA cargado correctamente. Entradas:', peData.length);
    } else {
      peData = [];
      console.error('[PE Search] PE_DATA no encontrado. Verifica que pe_data.js está cargado antes de script.js en index.html.');
    }
  }

  // Wrap matched text in a <mark> for visual highlighting
  function peHighlight(text, query) {
    if (!query || typeof text !== 'string') return text;
    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp('(' + escaped + ')', 'gi'),
      '<mark class="pe-highlight">$1</mark>');
  }

  // Hide normal resource list and render search result cards
  function renderPeResults(entries, query) {
    var container = document.getElementById('peSearchResults');
    var resourcesList = document.getElementById('resourcesList');
    if (!container) return;

    // Always hide the static list when a query is active
    if (resourcesList) resourcesList.style.display = 'none';

    if (!Array.isArray(entries) || entries.length === 0) {
      container.innerHTML =
        '<div class="pe-no-results">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">' +
            '<circle cx="11" cy="11" r="8"/>' +
            '<line x1="21" y1="21" x2="16.65" y2="16.65"/>' +
          '</svg>' +
          '<p>No se encontraron resultados para <strong>\u201c' + query + '\u201d</strong></p>' +
        '</div>';
      return;
    }

    var header =
      '<div class="pe-results-header">' +
        '<span class="pe-results-count">' +
          entries.length + ' resultado' + (entries.length !== 1 ? 's' : '') +
          ' para <em>\u201c' + query + '\u201d</em>' +
        '</span>' +
      '</div>';

    var cards = entries.map(function(entry) {
      var q = query.toLowerCase();

      // Filter matching norms (array of strings)
      var matchedNorms = Array.isArray(entry.normas_y_competencias)
        ? entry.normas_y_competencias.filter(function(n) {
            return typeof n === 'string' && n.toLowerCase().includes(q);
          })
        : [];

      // Filter matching topics (array of strings)
      var matchedTopics = Array.isArray(entry.temas_clave)
        ? entry.temas_clave.filter(function(t) {
            return typeof t === 'string' && t.toLowerCase().includes(q);
          })
        : [];

      var normsHtml = matchedNorms.length > 0
        ? '<ul class="pe-result-norms">' +
            matchedNorms.map(function(n) {
              return '<li>' + peHighlight(n, query) + '</li>';
            }).join('') +
          '</ul>'
        : '';

      var topicsHtml = matchedTopics.length > 0
        ? '<div class="pe-result-topics">' +
            matchedTopics.map(function(t) {
              return '<span class="pe-result-tag">' + peHighlight(t, query) + '</span>';
            }).join('') +
          '</div>'
        : '';

      return (
        '<div class="pe-result-card">' +
          '<div class="pe-result-card__cat">' + (entry.categoria_jerarquica || '') + '</div>' +
          '<h4 class="pe-result-card__title">' + peHighlight(entry.entidad_o_seccion || '', query) + '</h4>' +
          '<div class="pe-result-card__arts">' + (entry.articulos || '') + '</div>' +
          '<p class="pe-result-card__synthesis">' + (entry.sintesis_naturaleza || '') + '</p>' +
          normsHtml +
          topicsHtml +
        '</div>'
      );
    }).join('');

    container.innerHTML = header + cards;
  }

  // Clear results and restore the static resource list
  function clearPeResults() {
    var container = document.getElementById('peSearchResults');
    var resourcesList = document.getElementById('resourcesList');
    if (container) container.innerHTML = '';
    if (resourcesList) resourcesList.style.display = '';
  }

  // Run the actual filter against the in-memory cache
  function runPeFilter(query) {
    var q = query.toLowerCase();

    // Ensure data is loaded (synchronous — always available from pe_data.js)
    loadPeDataFromGlobal();

    var results = peData.filter(function(entry) {
      // 1. Match in entity/section name
      if (typeof entry.entidad_o_seccion === 'string' &&
          entry.entidad_o_seccion.toLowerCase().includes(q)) return true;

      // 2. Match in any norm string (array)
      if (Array.isArray(entry.normas_y_competencias) &&
          entry.normas_y_competencias.some(function(n) {
            return typeof n === 'string' && n.toLowerCase().includes(q);
          })) return true;

      // 3. Match in any topic string (array)
      if (Array.isArray(entry.temas_clave) &&
          entry.temas_clave.some(function(t) {
            return typeof t === 'string' && t.toLowerCase().includes(q);
          })) return true;

      return false;
    });

    renderPeResults(results, query);
  }

  function initPeSearch() {
    var input = document.getElementById('peSearchInput');
    if (!input) return;

    var debounceTimer;

    input.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        var query = input.value.trim();

        if (!query) {
          clearPeResults();
          return;
        }

        runPeFilter(query);
      }, 220);
    });

    // Load PE data eagerly once (synchronous, from pe_data.js global)
    loadPeDataFromGlobal();

    // Clear search state when switching sections
    document.querySelectorAll('.nav-link').forEach(function(link) {
      link.addEventListener('click', function() {
        input.value = '';
        clearPeResults();
      });
    });
  }

  // =====================================================================
  // COLECCIÓN TEMÁTICA — MODULE
  // =====================================================================

  // Data comes from temas_data.js (const TEMAS_DATA — same file:// safe pattern as PE_DATA)
  var CT_DATA = null;

  function loadCtData() {
    if (CT_DATA !== null) return;
    if (typeof TEMAS_DATA !== 'undefined' && Array.isArray(TEMAS_DATA)) {
      CT_DATA = TEMAS_DATA;
      console.log('[CT] TEMAS_DATA cargado. Entradas:', CT_DATA.length);
    } else {
      CT_DATA = [];
      console.error('[CT] TEMAS_DATA no encontrado. Verifica que temas_data.js está cargado antes de script.js.');
    }
  }

  // Extract numeric badge "01" from id string "tema_01"
  function ctBadge(id) {
    var match = id.match(/(\d+)$/);
    return match ? match[1].padStart(2, '0') : id;
  }

  // Convert any YouTube URL format to a clean embed URL.
  // Handles: youtu.be/ID · youtube.com/watch?v=ID · youtube.com/embed/ID
  // Returns '' if the URL is empty or the video ID cannot be extracted.
  function toYouTubeEmbed(url) {
    if (!url || typeof url !== 'string' || url.trim() === '') return '';

    // Already an embed URL — just normalise and return
    var embedMatch = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);
    if (embedMatch) return 'https://www.youtube.com/embed/' + embedMatch[1] + '?rel=0';

    // Short link: https://youtu.be/VIDEO_ID
    var shortMatch = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
    if (shortMatch) return 'https://www.youtube.com/embed/' + shortMatch[1] + '?rel=0';

    // Standard watch URL: youtube.com/watch?v=VIDEO_ID
    var watchMatch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
    if (watchMatch) return 'https://www.youtube.com/embed/' + watchMatch[1] + '?rel=0';

    console.warn('[CT] No se pudo extraer el ID del video de:', url);
    return '';
  }

  // ─── Render grid ──────────────────────────────────────────────────────
  function renderCtGrid() {
    loadCtData();
    var grid = document.getElementById('ctGrid');
    if (!grid) return;

    grid.innerHTML = CT_DATA.map(function(tema) {
      var num = ctBadge(tema.id);
      var isAnexo = tema.titulo.toLowerCase().startsWith('anexo');
      return (
        '<div class="ct-card' + (isAnexo ? ' ct-card--anexo' : '') + '" ' +
            'data-id="' + tema.id + '" role="button" tabindex="0">' +
          '<span class="ct-card__num">' + (isAnexo ? 'A' + num.replace(/^0+/, '') : num) + '</span>' +
          '<span class="ct-card__title">' + tema.titulo + '</span>' +
          '<svg class="ct-card__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
               'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">' +
            '<line x1="5" y1="12" x2="19" y2="12"/>' +
            '<polyline points="12 5 19 12 12 19"/>' +
          '</svg>' +
        '</div>'
      );
    }).join('');

    grid.querySelectorAll('.ct-card').forEach(function(card) {
      function activate() { showCtDetail(card.dataset.id); }
      card.addEventListener('click', activate);
      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    });
  }

  // ─── Show detail view ─────────────────────────────────────────────────
  function showCtDetail(id) {
    loadCtData();
    var tema = CT_DATA.find(function(t) { return t.id === id; });
    if (!tema) return;

    var num   = ctBadge(tema.id);
    var label = tema.titulo.toLowerCase().startsWith('anexo')
      ? 'Anexo ' + num.replace(/^0+/, '')
      : 'Tema ' + num;

    document.getElementById('ctDetailNum').textContent   = label;
    document.getElementById('ctDetailTitle').textContent = tema.titulo;

    // Video — normalise any YouTube URL format to embed before injecting
    var videoFrame = document.getElementById('ctVideoFrame');
    videoFrame.src = toYouTubeEmbed(tema.youtube_url);

    // Audio — reload with new source
    var audioEl  = document.getElementById('ctAudio');
    var audioSrc = document.getElementById('ctAudioSrc');
    audioEl.pause();
    audioSrc.src = tema.audio_url || '';
    audioEl.load();

    // PDF buttons
    var btnRead     = document.getElementById('ctBtnRead');
    var btnDownload = document.getElementById('ctBtnDownload');
    var pdfHref     = tema.pdf_url || '#';
    btnRead.href     = pdfHref;
    btnDownload.href = pdfHref;
    btnDownload.setAttribute('download', tema.id + '.pdf');

    // Switch views
    document.getElementById('ct-grid-view').style.display   = 'none';
    document.getElementById('ct-detail-view').style.display = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── Back to grid ─────────────────────────────────────────────────────
  function showCtGrid() {
    var videoFrame = document.getElementById('ctVideoFrame');
    if (videoFrame) videoFrame.src = '';
    var audioEl = document.getElementById('ctAudio');
    if (audioEl) audioEl.pause();
    document.getElementById('ct-detail-view').style.display = 'none';
    document.getElementById('ct-grid-view').style.display   = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function initColeccionTematica() {
    renderCtGrid();
    var backBtn = document.getElementById('ctBackBtn');
    if (backBtn) backBtn.addEventListener('click', showCtGrid);
  }

  // =====================================================================
  // INIT
  // =====================================================================

  loadData();
  initPeSearch();
  initColeccionTematica();

});
