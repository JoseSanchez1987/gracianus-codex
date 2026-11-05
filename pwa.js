/**
 * GRACIANUS: CODEX NAVIGATOR — PWA & Install Prompt Manager
 * Native-like install experience for iOS, Android & Desktop browsers (macOS Safari, Chrome, Edge).
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'gracianus_pwa_dismissed';
  const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Debug check: add ?pwa or ?debug to URL to force prompt display
  const urlParams = new URLSearchParams(window.location.search);
  const isDebugMode = urlParams.has('pwa') || urlParams.has('debug') || urlParams.has('install');

  // 1. Service Worker Registration (only if supported and on http/https)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // Browsers disallow Service Workers on file://
      if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        navigator.serviceWorker.register('sw.js')
          .then(reg => {
            console.log('[PWA] Service Worker registrado con éxito:', reg.scope);
          })
          .catch(err => {
            console.warn('[PWA] Error al registrar Service Worker:', err);
          });
      } else {
        console.log('[PWA] Modo local file:// detectado: el Service Worker requiere http:// o https://.');
      }
    });
  }

  // 2. Standalone Check (already running as standalone app)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true ||
                       document.referrer.includes('android-app://');

  if (isStandalone && !isDebugMode) {
    console.log('[PWA] App ejecutándose en modo standalone.');
    return;
  }

  // 3. Platform & Protocol Detection
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = (/iphone|ipad|ipod/.test(ua) && !window.MSStream) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMac = /macintosh|mac os x/.test(ua);
  const isSafariMac = isMac && /safari/.test(ua) && !/chrome|crios|edg|opr|firefox/.test(ua);
  const isFileProtocol = window.location.protocol === 'file:';

  let deferredPrompt = null;
  let bannerEl = null;

  // 4. Create and inject the modal into the DOM
  function createBanner() {
    if (bannerEl && document.getElementById('pwaInstallBanner')) {
      return bannerEl;
    }

    const banner = document.createElement('div');
    banner.className = 'pwa-install-banner';
    banner.id = 'pwaInstallBanner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Instalar Gracianus: Codex Navigator');

    let actionsHtml = '';

    if (isIOS) {
      // iOS Safari guidance
      actionsHtml = `
        <div class="pwa-action-ios" id="pwaActionIOS">
          <div class="pwa-ios-steps">
            <div class="pwa-ios-step">
              <span class="pwa-step-num">1</span>
              <span>Pulsa el botón <strong>Compartir</strong> <svg class="pwa-inline-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> en Safari.</span>
            </div>
            <div class="pwa-ios-step">
              <span class="pwa-step-num">2</span>
              <span>Elige <strong>«Añadir a pantalla de inicio»</strong> <svg class="pwa-inline-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>.</span>
            </div>
          </div>
          <button class="pwa-btn-dismiss" id="pwaBtnDismissIOS" style="width: 100%;">Entendido</button>
        </div>
      `;
    } else {
      // Standard action row with install & dismiss buttons + dynamic container for fallback
      actionsHtml = `
        <div class="pwa-action-container" id="pwaActionContainer">
          <div id="pwaFallbackContainer"></div>
          <div class="pwa-action-buttons" id="pwaButtonsRow">
            <button class="pwa-btn-install" id="pwaBtnInstall">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Instalar App
            </button>
            <button class="pwa-btn-dismiss" id="pwaBtnDismiss">Ahora no</button>
          </div>
        </div>
      `;
    }

    banner.innerHTML = `
      <div class="pwa-banner-card">
        <button class="pwa-banner-close" id="pwaBannerClose" aria-label="Cerrar sugerencia de instalación">✕</button>
        <div class="pwa-banner-header">
          <div class="pwa-banner-icon">
            <img src="assets/icon-192.png" alt="Icono Gracianus" width="42" height="42">
          </div>
          <div class="pwa-banner-title-box">
            <h4 class="pwa-banner-title">Gracianus: Codex Navigator</h4>
            <p class="pwa-banner-subtitle">Aplicación Web Progresiva</p>
          </div>
        </div>
        <div class="pwa-banner-body">
          <p class="pwa-banner-text">Instala la aplicación para consultar el Código de Derecho Canónico a pantalla completa, de forma nativa y sin conexión a internet.</p>
          ${actionsHtml}
        </div>
      </div>
    `;

    document.body.appendChild(banner);
    bannerEl = banner;

    function dismissPrompt() {
      banner.classList.remove('pwa-visible');
      if (!isDebugMode) {
        localStorage.setItem(STORAGE_KEY, Date.now().toString());
      }
      setTimeout(() => {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
        bannerEl = null;
      }, 400);
    }

    // Attach dismissal listeners
    const closeBtn = banner.querySelector('#pwaBannerClose');
    const dismissBtns = banner.querySelectorAll('.pwa-btn-dismiss');
    const installBtn = banner.querySelector('#pwaBtnInstall');

    if (closeBtn) closeBtn.addEventListener('click', dismissPrompt);
    dismissBtns.forEach(btn => btn.addEventListener('click', dismissPrompt));

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        // 1. Verificación del entorno: si beforeinstallprompt está disponible (HTTPS / localhost válido)
        if (deferredPrompt) {
          try {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('[PWA] Respuesta del usuario a la instalación:', outcome);
            deferredPrompt = null;
          } catch (err) {
            console.warn('[PWA] Error al ejecutar deferredPrompt:', err);
          }
          dismissPrompt();
          return;
        }

        // 2. Fallback elegante sin alert()
        const fallbackContainer = banner.querySelector('#pwaFallbackContainer');
        const buttonsRow = banner.querySelector('#pwaButtonsRow');
        if (!fallbackContainer) return;

        let fallbackHtml = '';

        if (isFileProtocol) {
          // Entorno local file:///
          fallbackHtml = `
            <div class="pwa-fallback-box">
              <div class="pwa-fallback-badge">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Protocolo Local (file:///)
              </div>
              <p class="pwa-fallback-desc">
                Los navegadores requieren un servidor con origen seguro (<code>https://</code> o <code>http://localhost</code>) para habilitar la instalación automática con un clic.
              </p>
              ${isSafariMac ? `
                <div class="pwa-desktop-steps">
                  <div class="pwa-desktop-step">
                    <span class="pwa-step-num">1</span>
                    <span>En Safari Mac puedes anclarla ya: ve a <strong>Archivo</strong> en la barra superior.</span>
                  </div>
                  <div class="pwa-desktop-step">
                    <span class="pwa-step-num">2</span>
                    <span>Haz clic en <strong>«Añadir al Dock…»</strong> para tenerla como app independiente.</span>
                  </div>
                </div>
              ` : `
                <p class="pwa-fallback-desc" style="font-size: 0.8rem; color: var(--color-slate, #5A6577); margin-bottom: 0;">
                  💡 <strong>Para instalar con 1 clic en Chrome/Edge:</strong> Inicia un servidor local rápido (ej. Live Server de VS Code o <code>python3 -m http.server</code>) o alójala en un servidor seguro con <code>https://</code>.
                </p>
              `}
            </div>
          `;
        } else {
          // Entorno HTTP o navegador que no dispara beforeinstallprompt
          fallbackHtml = `
            <div class="pwa-fallback-box">
              <div class="pwa-fallback-badge">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Pasos de instalación
              </div>
              ${isSafariMac ? `
                <div class="pwa-desktop-steps">
                  <div class="pwa-desktop-step">
                    <span class="pwa-step-num">1</span>
                    <span>En el menú de Safari, ve a <strong>Archivo</strong>.</span>
                  </div>
                  <div class="pwa-desktop-step">
                    <span class="pwa-step-num">2</span>
                    <span>Selecciona <strong>«Añadir al Dock…»</strong>.</span>
                  </div>
                </div>
              ` : `
                <div class="pwa-desktop-steps">
                  <div class="pwa-desktop-step">
                    <span class="pwa-step-num">1</span>
                    <span>Busca el icono de <strong>Instalar</strong> en la barra de direcciones o en el menú de opciones (<strong>⋮</strong>).</span>
                  </div>
                </div>
              `}
            </div>
          `;
        }

        // Render fallback content smoothly
        fallbackContainer.innerHTML = fallbackHtml;

        // Transition the button row to a single "Entendido" button
        if (buttonsRow) {
          buttonsRow.innerHTML = `
            <button class="pwa-btn-dismiss" id="pwaBtnDismissUnderstood" style="width: 100%;">Entendido</button>
          `;
          const understoodBtn = buttonsRow.querySelector('#pwaBtnDismissUnderstood');
          if (understoodBtn) understoodBtn.addEventListener('click', dismissPrompt);
        }
      });
    }

    return banner;
  }

  function showBanner(force = false) {
    if (!force && !isDebugMode) {
      const lastDismissed = localStorage.getItem(STORAGE_KEY);
      if (lastDismissed) {
        const elapsed = Date.now() - parseInt(lastDismissed, 10);
        if (!isNaN(elapsed) && elapsed < DISMISS_DURATION_MS) {
          return; // Dismissed recently
        }
      }
    }

    const banner = createBanner();
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (banner) banner.classList.add('pwa-visible');
      }, 100);
    });
  }

  // 5. Native beforeinstallprompt (Android / Desktop Chrome / Edge over HTTPS or localhost)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Evento beforeinstallprompt capturado con éxito');

    // If banner is already created, make sure it is ready
    if (!bannerEl) {
      setTimeout(() => showBanner(false), 1500);
    }
  });

  // 6. Unified Auto-trigger on page load
  // Ensures macOS Safari, iOS, and Desktop browsers always receive the prompt
  function initAutoPrompt() {
    setTimeout(() => {
      showBanner(false);
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoPrompt);
  } else {
    initAutoPrompt();
  }

  // 7. App installed event listener
  window.addEventListener('appinstalled', () => {
    if (bannerEl) {
      bannerEl.classList.remove('pwa-visible');
    }
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    console.log('[PWA] Gracianus: Codex Navigator ha sido instalada con éxito.');
  });

  // 8. Global helper for manual debugging or button trigger
  window.gracianusShowInstallPrompt = function(force = true) {
    showBanner(force);
  };

})();
