/**
 * Offline support: registers the service worker generated at build time and
 * exposes its state, so the UI can say when the app is ready offline and when
 * a new version is waiting (it is activated only when the user asks).
 */
import { ref } from 'vue';

export const offlineReady = ref(false);
export const updateAvailable = ref(false);
let waiting: ServiceWorker | null = null;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then((reg) => {
        const track = (w: ServiceWorker | null) => {
          if (!w) return;
          const check = () => {
            if (w.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                waiting = w;
                updateAvailable.value = true;
              } else offlineReady.value = true;
            }
            if (w.state === 'activated') offlineReady.value = true;
          };
          check();
          w.addEventListener('statechange', check);
        };
        if (reg.waiting && navigator.serviceWorker.controller) track(reg.waiting);
        if (reg.active) offlineReady.value = true;
        track(reg.installing);
        reg.addEventListener('updatefound', () => track(reg.installing));
      })
      .catch(() => {
        /* offline support is optional; the app works online without it */
      });
  });
}

/** Activate the waiting version and reload into it. */
export function applyUpdate(): void {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waiting.postMessage('SKIP_WAITING');
}
