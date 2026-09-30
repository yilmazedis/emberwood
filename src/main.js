import { Game } from './game.js';

const fill = document.getElementById('load-fill');
const text = document.getElementById('load-text');
const startBtn = document.getElementById('start');
const loading = document.getElementById('loading');
const installBtn = document.getElementById('install');
const iosHint = document.getElementById('ios-install');

// Show the touch or desktop texts right away (the game refines this on the first touch).
document.body.classList.toggle('touch', window.matchMedia('(pointer: coarse)').matches);

// ---------------------------------------------------------------- installable app (PWA)
const standalone = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = !/Android/.test(ua) && (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // show our own button instead of the browser's mini-bar
  installPrompt = e;
  installBtn.classList.remove('hidden');
});
installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  installBtn.classList.add('hidden');
});
window.addEventListener('appinstalled', () => installBtn.classList.add('hidden'));
if (isIOS && !standalone) iosHint.classList.remove('hidden'); // Safari has no install prompt

// On phones in the browser: go fullscreen and lock to landscape where supported (Android).
async function goFullscreen() {
  if (standalone || !document.body.classList.contains('touch')) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    await screen.orientation?.lock?.('landscape');
  } catch {
    /* not supported (e.g. iPhone Safari): play as is */
  }
}

// ---------------------------------------------------------------- boot
const game = new Game();
window.game = game; // handy for debugging from the console

// The title screen fades out on start, and comes back (with Continue) when you leave the game.
let hideT = 0;
function hideTitle() {
  loading.classList.add('gone');
  clearTimeout(hideT);
  hideT = setTimeout(() => loading.classList.add('away'), 900);
}
game.onLeave = () => {
  clearTimeout(hideT);
  loading.classList.add('returned');
  loading.classList.remove('away');
  text.textContent = 'Your progress is saved.';
  startBtn.textContent = 'Continue';
  requestAnimationFrame(() => loading.classList.remove('gone'));
};

game.init((f, label) => {
  fill.style.width = `${Math.round(f * 100)}%`;
  if (label) text.textContent = label;
}).then(() => {
  text.textContent = 'Ready';
  startBtn.classList.remove('hidden');
  const go = () => {
    goFullscreen();
    hideTitle();
    if (game.started) { game.resume(); return; }
    game.start();
    cacheForOffline();
  };
  startBtn.addEventListener('click', go);
  if (new URLSearchParams(location.search).has('autostart')) go();
}).catch((err) => {
  console.error(err);
  text.textContent = `Failed to load: ${err.message}`;
});

// Everything the game just downloaded (models, three.js, fonts) goes into the offline cache.
function cacheForOffline() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => {
    const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith('http'));
    reg.active?.postMessage({ type: 'cache', urls });
  }).catch(() => {});
}
