/**
 * GRACIANUS: CODEX NAVIGATOR — PWA & Install Prompt Manager
 * Native-like install experience for iOS, Android & Desktop browsers.
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'gracianus_pwa_dismissed';
  const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  // 1. Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => {
          console.log('[PWA] Service Worker registrado con éxito:', reg.scope);
        })
        .catch(err => {
          console.warn('[PWA] Error al registrar Service Worker:', err);
        });
    });
  }

  // 2. Standalone Check (already installed / opened as PWA)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true ||
                       document.referrer.includes('android-app://');

  if (isStandalone) {
    // App is already running in standalone mode, do not show install prompt
    return;
  }

  // 3. Check dismissal preference in localStorage
  const lastDismissed = localStorage.getItem(STORAGE_KEY);
  if (lastDismissed) {
    const elapsed = Date.now() - parseInt(lastDismissed, 10);
    if (!isNaN(elapsed) && elapsed < DISMISS_DURATION_MS) {
      return; // Recently dismissed by user
    }
  }

  // 4. Platform Detection
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua) && !window.MSStream;

  let deferredPrompt = null;
  let bannerEl = null;

  function createBanner() {
    if (bannerEl) return bannerEl;

    const banner = document.createElement('div');
    banner.className = 'pwa-install-banner';
    banner.id = 'pwaInstallBanner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Instalar Gracianus: Codex Navigator');

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
          
          <!-- Android / Desktop Install Action -->
          <div class="pwa-action-android" id="pwaActionAndroid" style="${isIOS ? 'display: none;' : ''}">
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

          <!-- iOS Safari Install Instructions -->
          <div class="pwa-action-ios" id="pwaActionIOS" style="${isIOS ? '' : 'display: none;'}">
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
        </div>
      </div>
    `;

    document.body.appendChild(banner);
    bannerEl = banner;

    function dismissPrompt() {
      banner.classList.remove('pwa-visible');
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
      setTimeout(() => {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
      }, 400);
    }

    const closeBtn = banner.querySelector('#pwaBannerClose');
    const dismissBtn = banner.querySelector('#pwaBtnDismiss');
    const dismissIosBtn = banner.querySelector('#pwaBtnDismissIOS');
    const installBtn = banner.querySelector('#pwaBtnInstall');

    if (closeBtn) closeBtn.addEventListener('click', dismissPrompt);
    if (dismissBtn) dismissBtn.addEventListener('click', dismissPrompt);
    if (dismissIosBtn) dismissIosBtn.addEventListener('click', dismissPrompt);

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          console.log('[PWA] Usuario aceptó la instalación.');
        }
        deferredPrompt = null;
        dismissPrompt();
      });
    }

    return banner;
  }

  function showBanner() {
    const banner = createBanner();
    requestAnimationFrame(() => {
      setTimeout(() => {
        banner.classList.add('pwa-visible');
      }, 100);
    });
  }

  // 5. Android / Chrome / Edge native beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show banner after short delay for non-intrusive UX
    setTimeout(showBanner, 2000);
  });

  // 6. iOS Safari (show guidance banner after 3 seconds)
  if (isIOS) {
    setTimeout(showBanner, 3000);
  }

  // 7. App installed event listener
  window.addEventListener('appinstalled', () => {
    if (bannerEl) {
      bannerEl.classList.remove('pwa-visible');
    }
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    console.log('[PWA] Gracianus: Codex Navigator ha sido instalada con éxito.');
  });
})();
