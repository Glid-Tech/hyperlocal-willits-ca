// Offline use and "Save to my phone" (see sw.js).
//
// The service worker saves a copy of the whole site the first time someone visits, so it keeps
// working with no internet. Saving it to the home screen gives it an app icon too. Chrome and Edge
// can show their own install prompt; on iPhone and iPad people add it from the Share menu, so the page
// explains how.

const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
const supported = 'serviceWorker' in navigator && (location.protocol === 'https:' || LOCAL.includes(location.hostname));

export const device = (() => {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ipad = ios && (/iPad/.test(ua) || navigator.platform === 'MacIntel');
  const android = !ios && /Android/i.test(ua);
  const mac = !ios && /Macintosh/.test(ua);
  // Pages opened inside Facebook, Instagram and similar apps can't be saved to the home screen.
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|Twitter|Snapchat|Pinterest|TikTok|musical_ly|BytedanceWebview|GSA\//.test(ua) || (android && /; wv\)/.test(ua));
  let browser = 'other';
  if (ios) browser = /CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : 'safari';
  else if (/SamsungBrowser/.test(ua)) browser = 'samsung';
  else if (/Firefox\//.test(ua)) browser = 'firefox';
  else if (/Edg(e|A)?\//.test(ua)) browser = 'edge';
  else if (/Chrome\//.test(ua)) browser = 'chrome';
  else if (mac && /Safari\//.test(ua)) browser = 'safari';
  // Safari's own version, e.g. 26 or 27. Since Safari 26 the iOS version in the user agent is frozen at 18_6,
  // so this is the reliable way to tell iOS 26 (Share is behind "•••") from iOS 27 (behind the three-line menu).
  const version = browser === 'safari' ? Number((ua.match(/Version\/(\d+)/) || [])[1]) || 0 : 0;
  return { ios, ipad, android, mac, mobile: ios || android, browser, version, inApp };
})();

const standaloneQuery = window.matchMedia ? matchMedia('(display-mode: standalone)') : null;
const isInstalled = () => !!(standaloneQuery?.matches || navigator.standalone === true);

const state = { supported, ready: false, installed: isInstalled(), canPrompt: false, online: navigator.onLine };
const listeners = new Set();
let installEvent = null;
const emit = () => { for (const fn of listeners) fn({ ...state }); };

/** Call fn now and whenever offline readiness, connection or install state changes. */
export function onOfflineChange(fn) {
  listeners.add(fn);
  fn({ ...state });
}

export function initOffline() {
  addEventListener('online', () => { state.online = true; emit(); });
  addEventListener('offline', () => { state.online = false; emit(); });
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // we show our own "Save to my phone" button instead of the browser's banner
    installEvent = e;
    state.canPrompt = true;
    emit();
  });
  addEventListener('appinstalled', () => {
    installEvent = null;
    state.canPrompt = false;
    state.installed = true;
    emit();
  });
  standaloneQuery?.addEventListener?.('change', () => { state.installed = isInstalled(); emit(); });
  if (!supported) return;

  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type !== 'offline-status') return;
    state.ready = !!e.data.ready;
    emit();
  });
  const register = () => navigator.serviceWorker.register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(reg => reg.active?.postMessage({ type: 'status' }))
    .catch(err => console.warn('Could not save a copy for offline use:', err));
  // Wait until the page has loaded so saving the copy never slows down the first visit.
  if (document.readyState === 'complete') setTimeout(register, 1500);
  else addEventListener('load', () => setTimeout(register, 1500), { once: true });
}

/** Show the browser's own install prompt when it offers one. Resolves to 'accepted', 'dismissed' or 'unavailable'. */
export async function promptInstall() {
  if (!installEvent) return 'unavailable';
  const e = installEvent;
  installEvent = null;
  state.canPrompt = false;
  emit();
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') keepSavedCopy();
    return outcome;
  } catch {
    return 'unavailable';
  }
}

/** Ask the browser not to clear the saved copy when the device runs low on space. */
export function keepSavedCopy() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
}
