/**
 * GRACIANUS: CODEX NAVIGATOR — PWA & Install Prompt Manager
 * Native-like install experience for iOS, Android & Desktop browsers.
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'gracianus_pwa_v2_dismissed';
  const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Clear legacy 7-day blocker if present
  try {
    localStorage.removeItem('gracianus_pwa_dismissed');
  } catch (e) {}

  // 1. Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // Browsers allow SW on http, https, and localhost
      if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        navigator.serviceWorker.register('/gracianus-codex/sw.js', { scope: '/gracianus-codex/' })
          .then(reg => {
            console.log('[PWA] Service Worker registrado con éxito:', reg.scope);
          })
          .catch(err => {
            console.warn('[PWA] Error al registrar Service Worker:', err);
          });
      }
    });
  }

  // 2. Platform & Environment Detection
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = (/iphone|ipad|ipod/.test(ua) && !window.MSStream) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true ||
                       document.referrer.includes('android-app://');

  let deferredPrompt = null;
  let bannerEl = null;
  let isBannerScheduled = false;

  // 3. Create the prompt DOM element
  function createBanner() {
    if (bannerEl && document.body.contains(bannerEl)) {
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
              <span>Pulsa el botón <strong>Compartir</strong> <svg class="pwa-inline-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> de Safari.</span>
            </div>
            <div class="pwa-ios-step">
              <span class="pwa-step-num">2</span>
              <span>Selecciona <strong>«Añadir a la pantalla de inicio»</strong> <svg class="pwa-inline-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>.</span>
            </div>
          </div>
          <button class="pwa-btn-dismiss" id="pwaBtnDismissIOS" style="width: 100%;">Entendido</button>
        </div>
      `;
    } else {
      // Android / Chromium / Generic action
      actionsHtml = `
        <div class="pwa-action-android" id="pwaActionAndroid">
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
      `;
    }

    banner.innerHTML = `
      <div class="pwa-banner-card">
        <button class="pwa-banner-close" id="pwaBannerClose" aria-label="Cerrar sugerencia de instalación">✕</button>
        <div class="pwa-banner-header">
          <div class="pwa-banner-icon">
            <img src="/gracianus-codex/assets/icon-192.png" alt="Icono Gracianus" width="42" height="42">
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
      try {
        sessionStorage.setItem('gracianus_pwa_session_dismissed', '1');
        localStorage.setItem(STORAGE_KEY, Date.now().toString());
      } catch (e) {}

      setTimeout(() => {
        if (banner.parentNode) {
          banner.parentNode.removeChild(banner);
        }
        bannerEl = null;
      }, 400);
    }

    // Attach dismissal listeners
    const closeBtn = banner.querySelector('#pwaBannerClose');
    const dismissBtn = banner.querySelector('#pwaBtnDismiss');
    const dismissIosBtn = banner.querySelector('#pwaBtnDismissIOS');
    const installBtn = banner.querySelector('#pwaBtnInstall');

    if (closeBtn) closeBtn.addEventListener('click', dismissPrompt);
    if (dismissBtn) dismissBtn.addEventListener('click', dismissPrompt);
    if (dismissIosBtn) dismissIosBtn.addEventListener('click', dismissPrompt);

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
          try {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('[PWA] Respuesta del usuario:', outcome);
            deferredPrompt = null;
          } catch (err) {
            console.warn('[PWA] Error en prompt:', err);
          }
          dismissPrompt();
        } else {
          // If native prompt is not active, display guidance smoothly inside the card
          const actionContainer = banner.querySelector('#pwaActionAndroid');
          if (actionContainer) {
            actionContainer.innerHTML = `
              <div class="pwa-ios-steps" style="margin-bottom: 8px;">
                <div class="pwa-ios-step">
                  <span class="pwa-step-num">1</span>
                  <span>Abre el menú del navegador (<strong>⋮</strong>) y pulsa <strong>«Instalar aplicación»</strong> o <strong>«Añadir a pantalla de inicio»</strong>.</span>
                </div>
              </div>
              <button class="pwa-btn-dismiss" id="pwaBtnDismissAlt" style="width: 100%;">Entendido</button>
            `;
            const altDismiss = banner.querySelector('#pwaBtnDismissAlt');
            if (altDismiss) altDismiss.addEventListener('click', dismissPrompt);
          }
        }
      });
    }

    return banner;
  }

  // 4. Show the banner with visibility transition
  function showBanner(force = false) {
    if (!force) {
      // Don't show if already installed and running standalone
      if (isStandalone) {
        return;
      }

      // Check session and local dismissal
      try {
        if (sessionStorage.getItem('gracianus_pwa_session_dismissed')) {
          return;
        }
        const lastDismissed = localStorage.getItem(STORAGE_KEY);
        if (lastDismissed) {
          const elapsed = Date.now() - parseInt(lastDismissed, 10);
          if (!isNaN(elapsed) && elapsed < DISMISS_DURATION_MS) {
            return;
          }
        }
      } catch (e) {}
    }

    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => showBanner(force));
      return;
    }

    const banner = createBanner();
    if (!banner) return;

    // Double requestAnimationFrame ensures reliable transition trigger
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.classList.add('pwa-visible');
      });
    });
  }

  // 5. Schedule banner trigger safely
  function scheduleBanner(delayMs = 2000) {
    if (isBannerScheduled) return;
    isBannerScheduled = true;
    setTimeout(() => {
      showBanner(false);
    }, delayMs);
  }

  // 6. Listen for Android/Chromium beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Evento beforeinstallprompt capturado');
    scheduleBanner(1200);
  });

  // 7. General trigger on page ready (iOS & general fallback)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scheduleBanner(2500);
    });
  } else {
    scheduleBanner(2500);
  }

  // 8. Event when app is successfully installed
  window.addEventListener('appinstalled', () => {
    if (bannerEl) {
      bannerEl.classList.remove('pwa-visible');
    }
    try {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch (e) {}
    console.log('[PWA] Gracianus: Codex Navigator ha sido instalada con éxito.');
  });

  // 9. Global manual helper for instant verification
  window.gracianusShowInstallPrompt = function(force = true) {
    showBanner(force);
  };

  // 10. Permanent sidebar install button trigger
  function initSidebarButton() {
    const sidebarBtn = document.getElementById('sidebarInstallBtn');
    if (!sidebarBtn) return;

    sidebarBtn.addEventListener('click', (e) => {
      e.preventDefault();

      // Close mobile drawer if open so modal or native prompt is fully visible
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      const hamburgerBtn = document.getElementById('hamburgerBtn');
      if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        if (hamburgerBtn) hamburgerBtn.classList.remove('active');
        document.body.style.overflow = '';
      }

      // If native beforeinstallprompt is available (Android / Chrome)
      if (deferredPrompt) {
        console.log('[PWA] Disparando instalación nativa desde la barra lateral...');
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(choice => {
          console.log('[PWA] Respuesta del usuario a la instalación:', choice.outcome);
          if (choice.outcome === 'accepted') {
            deferredPrompt = null;
          }
        }).catch(err => {
          console.warn('[PWA] Error al disparar prompt nativo:', err);
          showBanner(true);
        });
      } else {
        // iOS Safari, desktop or prompt already used/unavailable
        console.log('[PWA] Prompt nativo no disponible; forzando tarjeta flotante con instrucciones...');
        showBanner(true);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebarButton);
  } else {
    initSidebarButton();
  }

})();
