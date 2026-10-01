import { Game } from './game.js';
import { Net } from './net.js';
import { LocalWorld } from './local.js';
import { AccountScreen } from './account.js';

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

// The title screen fades out when a hero enters the world, and comes back on "Leave game".
let hideT = 0;
let accounts = null; // the sign-in and hero screens (online play)
// ?autostart: play offline with the hero saved in this browser (automated tests, no server needed)
const offline = new URLSearchParams(location.search).has('autostart');

function hideTitle() {
  loading.classList.add('gone');
  clearTimeout(hideT);
  hideT = setTimeout(() => loading.classList.add('away'), 900);
}

function enter(char) {
  goFullscreen();
  hideTitle();
  game.setCharacter(char);
  if (game.started) {
    game.resume();
  } else {
    game.start();
    cacheForOffline();
  }
  game.link.enter().catch((err) => { // into the shared world (it shows the monsters and the others)
    console.warn('could not enter the world', err);
    game.ui.centerMsg('Could not reach the game server: reconnecting…');
  });
}

// The messages every world sends (the server's, or the one running here offline).
function attachWorld(net) {
  game.net = net;
  game.link.attach(net);
  net.on('chat', (m) => game.chat.receive(m));
}

game.onLeave = (why) => {
  clearTimeout(hideT);
  loading.classList.add('returned');
  loading.classList.remove('away');
  requestAnimationFrame(() => loading.classList.remove('gone'));
  if (!accounts) {
    text.textContent = 'Your progress is saved.';
    startBtn.textContent = 'Continue';
    return;
  }
  text.textContent = '';
  if (why) accounts.start(why); // signed out (e.g. signed in elsewhere): say why
  else accounts.backFromGame(game.character?.id);
};

game.init((f, label) => {
  fill.style.width = `${Math.round(f * 100)}%`;
  if (label) text.textContent = label;
}).then(() => {
  if (offline) {
    game.offline = true;
    attachWorld(new LocalWorld());
    text.textContent = 'Ready';
    startBtn.classList.remove('hidden');
    const go = () => {
      if (!game.started) { enter({ id: 'local', name: 'Sir Ember', cls: 'knight', save: game.loadSave() }); return; }
      goFullscreen();
      hideTitle();
      game.resume();
      game.link.enter();
    };
    startBtn.addEventListener('click', go);
    go();
    return;
  }
  loading.classList.add('returned'); // the loading bar has done its job
  text.textContent = '';
  const net = new Net();
  attachWorld(net);
  accounts = new AccountScreen(net, { onPlay: enter });
  net.on('kicked', (m) => game.kicked(m.msg));
  net.on('signedOut', (m) => game.kicked(m.msg));
  net.on('connection', ({ online }) => {
    game.ui.connection(online);
    // back after a dropped line: step into the world again (net.js already picked the hero again)
    if (online && game.character && !game.onTitle) game.link.enter().catch(() => { /* the next drop retries */ });
  });
  accounts.start();
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
