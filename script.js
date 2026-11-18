/* ===================================================================
   IUS CANONICUM — Interactive Logic
   JSON data loading, real-time search, accordion, canon detail viewer,
   sidebar navigation, responsive menu
   =================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  // --- State ---
  let dbData = null; // Loaded multilingual JSON data
  const canonMap = new Map(); // Fast O(1) lookup by canon number

  // Strict language tab order & JSON property mapping (state is local per canon card)
  const LANG_TABS = [
    { label: 'ES',  prop: 'texto' },
    { label: 'LAT', prop: 'texto_latin' },
    { label: 'EN',  prop: 'texto_ingles' },
    { label: 'IT',  prop: 'texto_italiano' },
    { label: 'FR',  prop: 'texto_frances' }
  ];

  // --- DOM References ---
  const mainContent    = document.getElementById('mainContent') || document.querySelector('.main-content');
  const sidebar        = document.getElementById('sidebar');
  const sidebarBrandBtn = document.getElementById('sidebarBrandBtn');
  const mobileBrandBtn  = document.getElementById('mobileBrandBtn');
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
  const CHILD_LEVEL_KEYS = ['partes', 'secciones', 'titulos', 'capitulos', 'articulos'];

  function getNodeLabel(node) {
    return String(
      node.nombre || node.libro || node.parte || node.seccion ||
      node.titulo || node.capitulo || node.articulo || 'Sin título'
    ).trim();
  }

  function normalizeTreeNode(node, pathPrefix, index) {
    if (!node || typeof node !== 'object') return null;

    const nodeId = `${pathPrefix}-${index}`;
    const directCanones = Array.isArray(node.canones) ? node.canones : [];
    const children = [];

    CHILD_LEVEL_KEYS.forEach((key) => {
      if (Array.isArray(node[key]) && node[key].length > 0) {
        node[key].forEach((child, childIdx) => {
          const normalizedChild = normalizeTreeNode(child, `${nodeId}-${key}`, childIdx);
          if (normalizedChild) {
            normalizedChild._levelType = key;
            children.push(normalizedChild);
          }
        });
      }
    });

    const childrenCanonCount = children.reduce((sum, ch) => sum + ch._totalCanones, 0);

    return {
      ...node,
      _id: nodeId,
      _label: getNodeLabel(node),
      _children: children,
      canones: directCanones,
      _totalCanones: directCanones.length + childrenCanonCount
    };
  }

  function normalizeEstructura(db) {
    if (!db || !Array.isArray(db.estructura)) return [];
    return db.estructura
      .map((libro, i) => normalizeTreeNode(libro, 'libro', i))
      .filter(Boolean);
  }


  function loadScriptFallback(src) {
    return new Promise((resolve) => {
      if (window.DB_JERARQUICA_DATA) {
        resolve(window.DB_JERARQUICA_DATA);
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve(window.DB_JERARQUICA_DATA || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  function finishDataInit(loaded, alreadyNormalized = false) {
    dbData = Array.isArray(loaded) ? { estructura: [], canones: loaded } : loaded;
    if (!dbData || !Array.isArray(dbData.canones)) {
      console.error('Formato inválido en data_jerarquica_final.json: falta el array canones.');
      return;
    }

    if (!alreadyNormalized && Array.isArray(dbData.estructura)) {
      dbData.estructura = normalizeEstructura(dbData);
    }

    canonMap.clear();
    dbData.canones.forEach(c => {
      if (c && c.numero !== undefined) {
        canonMap.set(Number(c.numero), c);
      }
    });

    renderCodexSplitView();

    if (searchInput && searchInput.value.trim()) {
      performSearch();
    }
  }

  async function loadDataFallback() {
    let loaded = null;

    if (window.location.protocol !== 'file:') {
      try {
        const res = await fetch('./data_jerarquica_final.json');
        if (res.ok) {
          loaded = await res.json();
        }
      } catch (err) {
        // Fallback below if fetch is blocked or unavailable
      }
    }

    if (!loaded) {
      loaded = await loadScriptFallback('./data_jerarquica_final.js');
    }

    if (!loaded) {
      console.error('No se pudo cargar data_jerarquica_final.json.');
      if (accordionContainer) {
        accordionContainer.innerHTML = '<div class="accordion-empty">Error al cargar la base de datos de cánones.</div>';
      }
      return;
    }

    finishDataInit(loaded, false);
  }

  async function loadData() {
    if (accordionContainer) {
      accordionContainer.innerHTML = '<div class="accordion-empty">Cargando base de datos de cánones…</div>';
    }

    // Offload fetch, JSON.parse, recursive tree normalization & search indexing to a Web Worker
    if (window.location.protocol !== 'file:' && typeof Worker !== 'undefined') {
      try {
        const worker = new Worker('./data.worker.js');
        worker.onmessage = (e) => {
          worker.terminate();
          if (e.data && e.data.ok && e.data.db) {
            finishDataInit(e.data.db, true);
          } else {
            loadDataFallback();
          }
        };
        worker.onerror = () => {
          worker.terminate();
          loadDataFallback();
        };
        worker.postMessage({ jsonUrl: './data_jerarquica_final.json' });
        return;
      } catch (err) {
        // Fall through to synchronous/main-thread fallback
      }
    }

    await loadDataFallback();
  }

  // =====================================================================
  // MULTILINGUAL TABS RENDERING & INDEPENDENT CARD LISTENERS
  // =====================================================================

  function hasValidLangText(canon, prop) {
    return Boolean(canon && typeof canon[prop] === 'string' && canon[prop].trim() !== '');
  }

  function buildLangTabsButtonsHtml(canon) {
    if (!canon) return '';
    return LANG_TABS.map(lang => {
      if (!hasValidLangText(canon, lang.prop)) return '';
      const isSpanishDefault = lang.prop === 'texto';
      return `<button type="button" class="lang-tab${isSpanishDefault ? ' active' : ''}" data-prop="${lang.prop}" data-canon="${canon.numero}" aria-selected="${isSpanishDefault}">${lang.label}</button>`;
    }).join('');
  }

  function buildLangTabsContainerHtml(canon) {
    const buttonsHtml = buildLangTabsButtonsHtml(canon);
    if (!buttonsHtml) return '';
    return `<div class="lang-tabs-container">${buttonsHtml}</div>`;
  }

  function bindLangTabs(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('.lang-tab').forEach(tab => {
      if (tab.dataset.bound === '1') return;
      tab.dataset.bound = '1';

      tab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const prop = tab.dataset.prop;
        const canonNum = parseInt(tab.dataset.canon, 10);
        if (!prop || Number.isNaN(canonNum)) return;

        const canon = findCanon(canonNum);
        if (!hasValidLangText(canon, prop)) return;

        const newText = canon[prop];
        const tabsContainer = tab.closest('.lang-tabs-container');
        if (!tabsContainer) return;

        // Toggle .active exclusively among tabs inside this canon card
        tabsContainer.querySelectorAll('.lang-tab').forEach(sibling => {
          const isCurrent = sibling === tab;
          sibling.classList.toggle('active', isCurrent);
          sibling.setAttribute('aria-selected', String(isCurrent));
        });

        // Update only the text container belonging to this specific canon card
        const card = tab.closest('#canonDetail, .search-result-item, .accordion-canon-item, .canon-card');
        const textEl = card ? card.querySelector('.canon-detail-body, .search-result-excerpt, .canon-preview-text, .canon-texto') : null;
        if (!textEl) return;

        if (textEl.classList.contains('search-result-excerpt') && textEl.dataset.query) {
          textEl.innerHTML = highlightMatch(newText, textEl.dataset.query);
        } else {
          textEl.textContent = newText;
        }
      });
    });
  }

  // =====================================================================
  // SPLIT VIEW: BARRA LATERAL JERÁRQUICA + PANEL CENTRAL DE CÁNONES
  // =====================================================================

  const treeNodeMap = new Map();
  const canonToNodeMap = new Map();
  let activeTreeNode = null;
  let activeReadingCanonNum = null;

  /**
   * Reutiliza exactamente el diseño de tarjeta de búsqueda estabilizado
   * tanto para la lectura por árbol como para los resultados de búsqueda.
   */
  function buildCanonCardHtml(canon, query = '') {
    if (!canon) return '';
    const defaultText = canon.texto || '';
    const bodyHtml = query ? highlightMatch(defaultText, query) : escapeHtml(defaultText);
    const queryAttr = query ? ` data-query="${escapeHtml(query)}"` : '';

    const temasList = Array.isArray(canon.temas) ? canon.temas : [];
    const tagsHtml = temasList.map(t =>
      `<span class="search-result-tag">${query ? highlightMatch(t, query) : escapeHtml(t)}</span>`
    ).join('');

    const interpLinkHtml = canon.tiene_interpretacion
      ? `<a href="interpretaciones.html?canon=${canon.numero}" class="enlace-interpretacion" onclick="event.stopPropagation();" style="display: inline-block; margin-top: 8px; padding: 4px 8px; background-color: #f1f5f9; color: #1e293b; border-radius: 5px; font-size: 0.82em; text-decoration: none; border: 1px solid #cbd5e1;">◂ Ver Interpretación Auténtica</a>`
      : '';

    return `
      <div class="search-result-item canon-card" data-canon="${canon.numero}" role="button" tabindex="0">
        <div class="search-result-number canon-numero">${canon.numero}</div>
        <div class="search-result-content">
          <div class="canon-title-row">
            <h3 class="search-result-title">Canon ${canon.numero}</h3>
            ${buildLangTabsContainerHtml(canon)}
          </div>
          <div class="search-result-excerpt canon-texto"${queryAttr}>${bodyHtml}</div>
          <button type="button" class="btn-copiar-cita" onclick="copiarCitaCanon(this)" style="display: inline-block; margin-top: 10px; padding: 5px 10px; background-color: #f1f5f9; color: #1e293b; border-radius: 5px; font-size: 0.85em; border: 1px solid #cbd5e1; cursor: pointer;">📋 Copiar Cita</button>
          ${interpLinkHtml}
          ${tagsHtml ? `<div class="search-result-tags">${tagsHtml}</div>` : ''}
        </div>
      </div>
    `;
  }

  function bindCanonCardEvents(containerEl, onBeforeOpenDetail = null) {
    if (!containerEl) return;
    bindLangTabs(containerEl);

    containerEl.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.lang-tabs-container') || e.target.closest('.btn-copiar-cita') || e.target.closest('.enlace-interpretacion')) return;
        const num = parseInt(item.dataset.canon, 10);
        if (typeof onBeforeOpenDetail === 'function') onBeforeOpenDetail();
        showCanonDetail(num);
      });
      item.addEventListener('keydown', (e) => {
        if (e.target.closest('.lang-tabs-container')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const num = parseInt(item.dataset.canon, 10);
          if (typeof onBeforeOpenDetail === 'function') onBeforeOpenDetail();
          showCanonDetail(num);
        }
      });
    });
  }

  function enterReadingView() {
    if (mainContent) {
      mainContent.classList.add('view-reading');
    }
  }

  function exitReadingView() {
    if (mainContent) {
      mainContent.classList.remove('view-reading');
    }
    activeTreeNode = null;
    activeReadingCanonNum = null;
    if (searchInput) searchInput.value = '';
    if (searchResults) {
      searchResults.innerHTML = '';
      searchResults.classList.remove('has-results');
    }
    const sidebarTree = document.getElementById('codexTreeSidebar');
    if (sidebarTree) {
      sidebarTree.querySelectorAll('.tree-select-btn.active').forEach(el => el.classList.remove('active'));
      sidebarTree.classList.remove('is-mobile-open');
    }
    const mobileToggle = document.getElementById('mobileTreeToggle');
    if (mobileToggle) {
      mobileToggle.setAttribute('aria-expanded', 'false');
    }
    hideCanonDetail();
    renderCentralCanons(null);
  }

  function highlightCanonInTreeAndPanel(canonNum) {
    const n = Number(canonNum);
    activeReadingCanonNum = n;

    // 1. Resaltar tarjeta del canon activo en el panel derecho (si está visible ahí)
    const mainPanel = document.getElementById('codexMainPanel');
    if (mainPanel) {
      mainPanel.querySelectorAll('.search-result-item.is-reading-canon').forEach(el => {
        el.classList.remove('is-reading-canon');
      });
      const activeCard = mainPanel.querySelector(`.search-result-item[data-canon="${n}"]`);
      if (activeCard) {
        activeCard.classList.add('is-reading-canon');
      }
    }

    // 2. Conservar ramas abiertas y desplegar/resaltar la ruta del canon en el árbol lateral
    const sidebarTree = document.getElementById('codexTreeSidebar');
    const nodeId = canonToNodeMap.get(n);
    if (!sidebarTree || !nodeId) return;

    const targetBtn = sidebarTree.querySelector(`.tree-select-btn[data-node-id="${nodeId}"]`);
    if (!targetBtn) return;

    // Desplegar únicamente los ancestros necesarios sin cerrar otras ramas ya abiertas
    let parentLi = targetBtn.closest('.tree-node');
    while (parentLi) {
      const childrenBox = parentLi.querySelector(':scope > .tree-children');
      const toggleBtn = parentLi.querySelector(':scope > .tree-node-row > .tree-toggle-btn');
      if (childrenBox && childrenBox.hidden) {
        childrenBox.hidden = false;
        if (toggleBtn) {
          toggleBtn.setAttribute('aria-expanded', 'true');
          toggleBtn.textContent = '▾';
        }
      }
      parentLi = parentLi.parentElement ? parentLi.parentElement.closest('.tree-node') : null;
    }

    sidebarTree.querySelectorAll('.tree-select-btn.active').forEach(el => el.classList.remove('active'));
    targetBtn.classList.add('active');
    const targetNode = treeNodeMap.get(nodeId);
    if (targetNode) {
      activeTreeNode = targetNode;
    }
  }

  function buildHomeBooksHtml(libros) {
    if (!Array.isArray(libros) || libros.length === 0) return '';
    return libros.map((libro) => {
      const total = libro._totalCanones || 0;
      const badgeText = total > 0 ? `${total} cánon${total > 1 ? 'es' : ''}` : 'Vacío';
      return `
        <div class="accordion-libro home-book-item">
          <button type="button" class="accordion-libro-btn home-book-btn" data-node-id="${escapeHtml(libro._id)}">
            <span class="libro-label">${escapeHtml(libro._label)}</span>
            <span class="libro-badge">${badgeText}</span>
            <svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      `;
    }).join('');
  }

  function renderCodexSplitView() {
    if (!dbData || !accordionContainer) return;
    treeNodeMap.clear();
    canonToNodeMap.clear();
    activeTreeNode = null;

    accordionContainer.innerHTML = `
      <div class="home-books-accordion" id="homeBooksAccordion">
        ${buildHomeBooksHtml(dbData.estructura)}
      </div>
      <div class="codex-split-layout">
        <div class="codex-sidebar-wrapper">
          <button type="button" class="codex-mobile-tree-toggle" id="mobileTreeToggle" aria-expanded="false" aria-controls="codexTreeSidebar">
            <span>Índice del Código (Libros y Títulos)</span>
            <span class="mobile-tree-chevron" aria-hidden="true">▾</span>
          </button>
          <aside class="codex-tree-sidebar" id="codexTreeSidebar" aria-label="Índice jerárquico del Código">
            ${buildTreeLevelHtml(dbData.estructura, 0)}
          </aside>
        </div>
        <section class="codex-main-panel" id="codexMainPanel" aria-live="polite">
          <div class="codex-panel-placeholder">
            Selecciona un Libro, Título, Capítulo o Artículo en el índice lateral para leer sus cánones.
          </div>
        </section>
      </div>
    `;

    // Estado 1 -> Estado 2 al pulsar uno de los 7 Libros en Inicio
    accordionContainer.querySelectorAll('.home-book-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.nodeId;
        enterReadingView();
        const treeBtn = document.querySelector(`#codexTreeSidebar .tree-select-btn[data-node-id="${targetId}"]`);
        if (treeBtn) {
          treeBtn.click();
          treeBtn.scrollIntoView({ block: 'nearest' });
        }
        if (accordionSection) {
          accordionSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    bindTreeSidebarEvents();
  }

  function buildTreeLevelHtml(nodes, depth) {
    if (!Array.isArray(nodes) || nodes.length === 0) return '';

    const itemsHtml = nodes.map((node) => {
      treeNodeMap.set(node._id, node);
      if (Array.isArray(node.canones)) {
        node.canones.forEach(num => canonToNodeMap.set(Number(num), node._id));
      }

      const hasChildren = Array.isArray(node._children) && node._children.length > 0;
      const hasDirectCanones = Array.isArray(node.canones) && node.canones.length > 0;
      const badge = node._totalCanones > 0 ? `<span class="tree-node-badge">${node._totalCanones}</span>` : '';

      return `
        <li class="tree-node" data-node-id="${escapeHtml(node._id)}" data-depth="${depth}">
          <div class="tree-node-row">
            ${hasChildren
              ? `<button type="button" class="tree-toggle-btn" aria-expanded="false" aria-label="Desplegar ${escapeHtml(node._label)}">▸</button>`
              : `<span class="tree-leaf-dot" aria-hidden="true">•</span>`
            }
            <button type="button"
                    class="tree-select-btn${hasDirectCanones ? ' has-canons' : ''}"
                    data-node-id="${escapeHtml(node._id)}">
              <span class="tree-node-label">${escapeHtml(node._label)}</span>
              ${badge}
            </button>
          </div>
          ${hasChildren ? `<div class="tree-children" hidden>${buildTreeLevelHtml(node._children, depth + 1)}</div>` : ''}
        </li>
      `;
    }).join('');

    return `<ul class="tree-list tree-list--depth-${depth}">${itemsHtml}</ul>`;
  }

  function bindTreeSidebarEvents() {
    const sidebarTree = document.getElementById('codexTreeSidebar');
    const mobileToggle = document.getElementById('mobileTreeToggle');
    if (!sidebarTree) return;

    if (mobileToggle) {
      mobileToggle.addEventListener('click', () => {
        const isOpen = sidebarTree.classList.toggle('is-mobile-open');
        mobileToggle.setAttribute('aria-expanded', String(isOpen));
      });
    }

    sidebarTree.querySelectorAll('.tree-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const li = btn.closest('.tree-node');
        const childrenBox = li && li.querySelector(':scope > .tree-children');
        if (!childrenBox) return;

        const isExpanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!isExpanded));
        btn.textContent = isExpanded ? '▸' : '▾';
        childrenBox.hidden = isExpanded;
      });
    });

    sidebarTree.querySelectorAll('.tree-select-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const node = treeNodeMap.get(btn.dataset.nodeId);
        if (!node) return;

        const li = btn.closest('.tree-node');
        const toggleBtn = li && li.querySelector(':scope > .tree-node-row > .tree-toggle-btn');
        const childrenBox = li && li.querySelector(':scope > .tree-children');
        if (toggleBtn && childrenBox && childrenBox.hidden) {
          toggleBtn.setAttribute('aria-expanded', 'true');
          toggleBtn.textContent = '▾';
          childrenBox.hidden = false;
        }

        sidebarTree.querySelectorAll('.tree-select-btn.active').forEach((el) => el.classList.remove('active'));
        btn.classList.add('active');
        activeTreeNode = node;

        // If user had an active search, clear input & exit search mode to show the selected tree node
        if (searchInput && searchInput.value.trim()) {
          searchInput.value = '';
        }
        if (searchResults) {
          searchResults.innerHTML = '';
          searchResults.classList.remove('has-results');
        }

        // On mobile, collapse tree menu when selecting a node with direct canons so reading uses 100% width
        if (window.innerWidth <= 768 && Array.isArray(node.canones) && node.canones.length > 0 && mobileToggle) {
          sidebarTree.classList.remove('is-mobile-open');
          mobileToggle.setAttribute('aria-expanded', 'false');
        }

        renderCentralCanons(node);
      });
    });
  }

  function renderCentralCanons(node) {
    const mainPanel = document.getElementById('codexMainPanel');
    if (!mainPanel) return;

    if (!node) {
      mainPanel.innerHTML = `
        <div class="codex-panel-placeholder">
          Selecciona un Libro, Título, Capítulo o Artículo en el índice lateral para leer sus cánones.
        </div>
      `;
      return;
    }

    const canonesNums = Array.isArray(node.canones) ? node.canones : [];
    const hasChildren = Array.isArray(node._children) && node._children.length > 0;

    if (canonesNums.length === 0) {
      const subLinksHtml = hasChildren
        ? `<div class="central-subnodes">${node._children.map(ch => `
            <button type="button" class="central-subnode-btn" data-target-node="${escapeHtml(ch._id)}">
              <span>${escapeHtml(ch._label)}</span>
              ${ch._totalCanones > 0 ? `<span class="libro-badge">${ch._totalCanones}</span>` : ''}
            </button>
          `).join('')}</div>`
        : `<div class="codex-panel-placeholder">No hay cánones directos en esta sección.</div>`;

      mainPanel.innerHTML = `
        <div class="central-node-header">
          <h3 class="central-node-title">${escapeHtml(node._label)}</h3>
          ${node._totalCanones > 0 ? `<span class="libro-badge">${node._totalCanones} cánon${node._totalCanones > 1 ? 'es' : ''}</span>` : ''}
        </div>
        ${subLinksHtml}
      `;

      mainPanel.querySelectorAll('.central-subnode-btn').forEach((subBtn) => {
        subBtn.addEventListener('click', () => {
          const targetBtn = document.querySelector(`#codexTreeSidebar .tree-select-btn[data-node-id="${subBtn.dataset.targetNode}"]`);
          if (targetBtn) targetBtn.click();
        });
      });
      return;
    }

    const cardsHtml = canonesNums.map((num) => {
      const canon = findCanon(num);
      return buildCanonCardHtml(canon, '');
    }).join('');

    mainPanel.innerHTML = `
      <div class="central-node-header">
        <h3 class="central-node-title">${escapeHtml(node._label)}</h3>
        <span class="libro-badge">${canonesNums.length} cánon${canonesNums.length > 1 ? 'es' : ''}</span>
      </div>
      <div class="central-canons-list">${cardsHtml}</div>
    `;

    bindCanonCardEvents(mainPanel);

    if (activeReadingCanonNum !== null) {
      const activeCard = mainPanel.querySelector(`.search-result-item[data-canon="${activeReadingCanonNum}"]`);
      if (activeCard) activeCard.classList.add('is-reading-canon');
    }
  }

  // =====================================================================
  // CANON DETAIL VIEWER & SEQUENTIAL NAVIGATION
  // =====================================================================

  function updateCanonNav(currentNumero) {
    const prevBtn = document.getElementById('canonNavPrev');
    const nextBtn = document.getElementById('canonNavNext');
    const prevText = document.getElementById('canonNavPrevText');
    const nextText = document.getElementById('canonNavNextText');

    if (!prevBtn || !nextBtn) return;

    const n = Number(currentNumero);
    const prevNum = n - 1;
    const nextNum = n + 1;

    // Boundary check against actual canons in database
    const prevCanon = prevNum >= 1 ? findCanon(prevNum) : null;
    const nextCanon = findCanon(nextNum);

    if (prevCanon) {
      prevBtn.disabled = false;
      prevBtn.classList.remove('is-disabled');
      prevBtn.dataset.targetCanon = String(prevCanon.numero);
      if (prevText) prevText.textContent = `Canon ${prevCanon.numero}`;
    } else {
      prevBtn.disabled = true;
      prevBtn.classList.add('is-disabled');
      delete prevBtn.dataset.targetCanon;
      if (prevText) prevText.textContent = '';
    }

    if (nextCanon) {
      nextBtn.disabled = false;
      nextBtn.classList.remove('is-disabled');
      nextBtn.dataset.targetCanon = String(nextCanon.numero);
      if (nextText) nextText.textContent = `Canon ${nextCanon.numero}`;
    } else {
      nextBtn.disabled = true;
      nextBtn.classList.add('is-disabled');
      delete nextBtn.dataset.targetCanon;
      if (nextText) nextText.textContent = '';
    }
  }

  function showCanonDetail(numero) {
    const canon = findCanon(numero);
    if (!canon) return;

    if (canonDetail) {
      canonDetail.dataset.canon = String(canon.numero);
    }

    // Populate detail panel safely
    const badgeEl = document.getElementById('canonDetailBadge');
    if (badgeEl) badgeEl.textContent = canon.capitulo || canon.titulo || '';

    const titleEl = document.getElementById('canonDetailTitle');
    if (titleEl) titleEl.textContent = `Canon ${canon.numero}`;

    // Meta chips: libro, capítulo, temas
    const metaContainer = document.getElementById('canonDetailMeta');
    if (metaContainer) {
      let metaHtml = '';
      if (canon.libro) metaHtml += metaChip('book', canon.libro);
      if (canon.capitulo && canon.capitulo !== canon.titulo) metaHtml += metaChip('tag', canon.capitulo);
      if (Array.isArray(canon.temas) && canon.temas.length > 0) {
        canon.temas.forEach(t => {
          metaHtml += metaChip('tag', t);
        });
      }
      metaContainer.innerHTML = metaHtml;
    }

    // Multilingual tabs directly above the canon body text (Español active by default)
    const detailLangTabs = document.getElementById('canonDetailLangTabs');
    if (detailLangTabs) {
      detailLangTabs.innerHTML = buildLangTabsButtonsHtml(canon);
      bindLangTabs(detailLangTabs);
    }

    // Initial body text always in Spanish (canon.texto)
    const bodyEl = document.getElementById('canonDetailBody');
    if (bodyEl) {
      bodyEl.textContent = canon.texto || '';
    }

    // Interpretación Auténtica y Copiar Cita
    const interpContainer = document.getElementById('canonDetailInterp');
    if (interpContainer) {
      const copyBtnHtml = `<button type="button" class="btn-copiar-cita" onclick="copiarCitaCanon(this)" style="display: inline-block; margin-top: 10px; padding: 5px 10px; background-color: #f1f5f9; color: #1e293b; border-radius: 5px; font-size: 0.85em; border: 1px solid #cbd5e1; cursor: pointer;">📋 Copiar Cita</button>`;
      const interpBtnHtml = canon.tiene_interpretacion
        ? ` <a href="interpretaciones.html?canon=${canon.numero}" class="enlace-interpretacion" style="display: inline-block; margin-top: 10px; padding: 5px 10px; background-color: #f1f5f9; color: #1e293b; border-radius: 5px; font-size: 0.85em; text-decoration: none; border: 1px solid #cbd5e1;">◂ Ver Interpretación Auténtica</a>`
        : '';
      interpContainer.innerHTML = copyBtnHtml + interpBtnHtml;
    }

    // Update navigation controls (Previous / Next)
    updateCanonNav(canon.numero);

    // Ensure reading workspace & hierarchical tree stay visible right below the canon detail viewer
    enterReadingView();
    if (accordionSection) {
      accordionSection.style.display = '';
    }

    if (canonDetail) {
      canonDetail.style.display = 'block';
      canonDetail.style.animation = 'none';
      canonDetail.offsetHeight; // reflow
      canonDetail.style.animation = '';
    }

    highlightCanonInTreeAndPanel(canon.numero);

    // Smooth scroll to the newly opened canon reader at the top (keeping tree accessible below)
    if (canonDetail) {
      canonDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function hideCanonDetail() {
    if (canonDetail) canonDetail.style.display = 'none';
    if (accordionSection) accordionSection.style.display = '';
    activeReadingCanonNum = null;
    const mainPanel = document.getElementById('codexMainPanel');
    if (mainPanel) {
      mainPanel.querySelectorAll('.search-result-item.is-reading-canon').forEach(el => {
        el.classList.remove('is-reading-canon');
      });
    }
  }

  if (canonDetailBack) {
    canonDetailBack.addEventListener('click', hideCanonDetail);
  }

  const canonNavPrev = document.getElementById('canonNavPrev');
  const canonNavNext = document.getElementById('canonNavNext');

  if (canonNavPrev) {
    canonNavPrev.addEventListener('click', () => {
      const target = canonNavPrev.dataset.targetCanon;
      if (target) {
        showCanonDetail(parseInt(target, 10));
      }
    });
  }

  if (canonNavNext) {
    canonNavNext.addEventListener('click', () => {
      const target = canonNavNext.dataset.targetCanon;
      if (target) {
        showCanonDetail(parseInt(target, 10));
      }
    });
  }

  // Keyboard navigation for canon detail (Left / Right arrows)
  document.addEventListener('keydown', (e) => {
    if (!canonDetail || canonDetail.style.display === 'none') return;
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;

    if (e.key === 'ArrowLeft') {
      const prevTarget = canonNavPrev && canonNavPrev.dataset.targetCanon;
      if (prevTarget) {
        e.preventDefault();
        showCanonDetail(parseInt(prevTarget, 10));
      }
    } else if (e.key === 'ArrowRight') {
      const nextTarget = canonNavNext && canonNavNext.dataset.targetCanon;
      if (nextTarget) {
        e.preventDefault();
        showCanonDetail(parseInt(nextTarget, 10));
      }
    }
  });

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
    if (!searchInput || !searchResults) return;
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
    if (!dbData || !Array.isArray(dbData.canones)) return [];
    const rawTrimmed = String(query || '').trim();
    if (!rawTrimmed) return [];

    const q = normalizeStr(rawTrimmed);
    const numMatch = q.match(/^(?:canon\s+|can\.?\s*|c\.?\s*)?(\d+)$/);
    const exactNum = numMatch ? Number(numMatch[1]) : null;

    const filtered = dbData.canones.filter(canon => {
      if (!canon) return false;

      // 1. Exact match on canon.numero
      if (exactNum !== null && Number(canon.numero) === exactNum) {
        return true;
      }

      // If the user explicitly typed "canon 1331" / "can. 1331", only match exact canon.numero
      if (exactNum !== null && !/^\d+$/.test(rawTrimmed)) {
        return false;
      }

      // If the user typed a pure canon number (e.g. "1331"), avoid matching "§ 1" noise in text
      if (exactNum !== null && canonMap.has(exactNum)) {
        return false;
      }

      // 2. Match against canon.texto (use pre-normalized index from Worker when available)
      const qTexto = canon._qTexto !== undefined
        ? canon._qTexto
        : (typeof canon.texto === 'string' ? normalizeStr(canon.texto) : '');
      if (qTexto && qTexto.includes(q)) {
        return true;
      }

      // 3. Match against canon.temas array
      const qTemas = Array.isArray(canon._qTemas)
        ? canon._qTemas
        : (Array.isArray(canon.temas) ? canon.temas.map(normalizeStr) : []);
      if (qTemas.some(t => t.includes(q))) {
        return true;
      }

      return false;
    });

    return filtered;
  }

  function renderSearchResults(results, query) {
    enterReadingView();

    const mainPanel = document.getElementById('codexMainPanel');
    const targetEl = mainPanel || searchResults;
    if (!targetEl) return;

    // Ensure canon detail is hidden so search results in the right panel are visible
    if (canonDetail && canonDetail.style.display !== 'none') {
      hideCanonDetail();
    }

    // Keep dropdown empty when displaying results in the main right-hand panel
    if (mainPanel && searchResults) {
      searchResults.innerHTML = '';
      searchResults.classList.remove('has-results');
    }

    if (results.length === 0) {
      const emptyHtml = `
        <div class="central-node-header">
          <h3 class="central-node-title">Resultados para «${escapeHtml(query)}»</h3>
          <button type="button" class="btn-clear-search" id="btnClearPanelSearch">✕ Limpiar búsqueda</button>
        </div>
        <div class="search-no-results">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="8" y1="8" x2="14" y2="14"/>
            <line x1="14" y1="8" x2="8" y2="14"/>
          </svg>
          No se encontraron resultados para «<strong>${escapeHtml(query)}</strong>»
        </div>
      `;
      if (mainPanel) {
        mainPanel.innerHTML = emptyHtml;
        const clearBtn = document.getElementById('btnClearPanelSearch');
        if (clearBtn) {
          clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            clearSearchResults();
          });
        }
      } else {
        searchResults.innerHTML = `<div class="search-results-inner">${emptyHtml}</div>`;
        searchResults.classList.add('has-results');
      }
      return;
    }

    const itemsHtml = results.map(canon => buildCanonCardHtml(canon, query)).join('');

    if (mainPanel) {
      mainPanel.innerHTML = `
        <div class="central-node-header">
          <h3 class="central-node-title">Resultados para «${escapeHtml(query)}»</h3>
          <div class="central-header-actions">
            <span class="libro-badge">${results.length} cánon${results.length > 1 ? 'es' : ''}</span>
            <button type="button" class="btn-clear-search" id="btnClearPanelSearch">✕ Limpiar</button>
          </div>
        </div>
        <div class="central-canons-list">${itemsHtml}</div>
      `;

      const clearBtn = document.getElementById('btnClearPanelSearch');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          if (searchInput) searchInput.value = '';
          clearSearchResults();
        });
      }

      bindCanonCardEvents(mainPanel);
    } else {
      searchResults.innerHTML = `<div class="search-results-inner">${itemsHtml}</div>`;
      searchResults.classList.add('has-results');
      bindCanonCardEvents(searchResults, () => {
        clearSearchResults();
        if (searchInput) searchInput.value = '';
      });
    }
  }

  function clearSearchResults() {
    if (searchResults) {
      searchResults.innerHTML = '';
      searchResults.classList.remove('has-results');
    }
    if (!activeTreeNode) {
      exitReadingView();
      return;
    }
    const mainPanel = document.getElementById('codexMainPanel');
    if (mainPanel) {
      renderCentralCanons(activeTreeNode);
    }
  }

  if (searchInput && searchResults) {
    // Real-time input listener (debounced)
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(performSearch, 150);
    });

    // Button click also triggers search
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        performSearch();
      });
    }

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
  }

  // =====================================================================
  // SUGGESTION TAGS
  // =====================================================================

  document.querySelectorAll('.suggestion-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = tag.dataset.query;
        searchInput.focus();
        performSearch();
      }

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
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('active');
    if (hamburgerBtn) hamburgerBtn.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    if (hamburgerBtn) hamburgerBtn.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', () => {
      if (sidebar) {
        sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
      }
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
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

    // When switching to inicio, return to Estado 1 (Vista de Inicio)
    if (sectionId === 'inicio') {
      exitReadingView();
    }

    if (window.innerWidth <= 768) closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Logo superior izquierdo ('Gracianus') -> regresar a Vista de Inicio
  [sidebarBrandBtn, mobileBrandBtn].forEach(brandEl => {
    if (!brandEl) return;
    brandEl.addEventListener('click', () => {
      switchSection('inicio');
    });
    brandEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchSection('inicio');
      }
    });
  });

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      if (!link.dataset.section) return;
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
    if (!dbData || !dbData.canones) return null;
    const n = typeof numero === 'number' ? numero : parseInt(numero, 10);
    if (canonMap.size > 0) {
      return canonMap.get(n) || null;
    }
    return dbData.canones.find(c => c.numero === n) || null;
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

// =====================================================================
// FUNCIÓN INDEPENDIENTE: COPIAR CITA (Dicasterio para los Textos Legislativos)
// =====================================================================

function copiarCitaCanon(boton) {
  try {
    if (window.event) {
      window.event.stopPropagation();
    }

    // Ajusta '.canon-card', '.canon-numero' y '.canon-texto' a las clases exactas del HTML
    const tarjeta = boton.closest('.canon-card') || boton.closest('.search-result-item') || boton.closest('.canon-detail');
    if (!tarjeta) return;

    const numEl = tarjeta.querySelector('.canon-numero') || tarjeta.querySelector('.search-result-number') || tarjeta.querySelector('.canon-detail-title');
    const textEl = tarjeta.querySelector('.canon-texto') || tarjeta.querySelector('.search-result-excerpt') || tarjeta.querySelector('.canon-detail-body');
    if (!numEl || !textEl) return;

    const rawNumero = numEl.innerText || numEl.textContent || '';
    const match = rawNumero.match(/\d+/);
    const numeroCanon = match ? match[0] : rawNumero.trim();

    const rawTexto = textEl.innerText || textEl.textContent || '';
    const textoCanon = rawTexto.trim();

    // Estructura oficial: can. XXX CIC: "Texto..."
    const citaFormateada = `can. ${numeroCanon} CIC: "${textoCanon}"`;

    const handleSuccess = () => {
      const textoOriginal = boton.innerHTML;
      if (boton._copyTimeout) {
        clearTimeout(boton._copyTimeout);
      }
      boton.innerHTML = '✅ Cita copiada';
      boton._copyTimeout = setTimeout(() => {
        boton.innerHTML = textoOriginal;
        boton._copyTimeout = null;
      }, 2000);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(citaFormateada)
        .then(handleSuccess)
        .catch(() => {
          fallbackCopyText(citaFormateada, handleSuccess);
        });
    } else {
      fallbackCopyText(citaFormateada, handleSuccess);
    }
  } catch (error) {
    console.error("Error al copiar la cita: ", error);
  }
}

function fallbackCopyText(text, onSuccess) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const successful = document.execCommand('copy');
    if (successful && typeof onSuccess === 'function') onSuccess();
  } catch (err) {
    console.error('Fallback copy failed: ', err);
  }
  document.body.removeChild(textarea);
}
