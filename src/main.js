import { Game } from './game.js';

const fill = document.getElementById('load-fill');
const text = document.getElementById('load-text');
const startBtn = document.getElementById('start');
const loading = document.getElementById('loading');

const game = new Game();
window.game = game; // handy for debugging from the console

game.init((f, label) => {
  fill.style.width = `${Math.round(f * 100)}%`;
  if (label) text.textContent = label;
}).then(() => {
  text.textContent = 'Ready';
  startBtn.classList.remove('hidden');
  const go = () => {
    loading.classList.add('gone');
    setTimeout(() => loading.remove(), 900);
    game.start();
  };
  startBtn.addEventListener('click', go, { once: true });
  if (new URLSearchParams(location.search).has('autostart')) go();
}).catch((err) => {
  console.error(err);
  text.textContent = `Failed to load: ${err.message}`;
});
