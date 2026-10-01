// The title screen's account part: sign in (or create an account), then pick a hero or make a new one.
// Talks to the game server through net.js; calls onPlay(character) when a hero enters the world.
import { CLASSES, CLASS_IDS, MAX_CHARACTERS, NAME_RULE, USER_RULE } from './classes.js';
import { Assets } from './assets.js';
import { savedToken, PROTOCOL } from './net.js';

const LOCAL_SAVE = 'emberwood-save-v1'; // the single-player save from before accounts
const IMPORTED = 'emberwood-save-imported';
const VIEWS = ['acc-login', 'acc-chars', 'acc-create', 'acc-wait'];
const $ = (id) => document.getElementById(id);
const portrait = (cls) => Assets.icons[`portrait_${cls}`] || Assets.icons.portrait;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function localSave() {
  try {
    if (localStorage.getItem(IMPORTED)) return null;
    const s = JSON.parse(localStorage.getItem(LOCAL_SAVE) || 'null');
    return s && Number.isInteger(s.level) ? s : null;
  } catch { return null; }
}

export class AccountScreen {
  constructor(net, { onPlay }) {
    this.net = net;
    this.onPlay = onPlay;
    this.mode = 'login';
    this.user = '';
    this.chars = [];
    this.selected = null;
    this.cls = 'knight';
    $('acc-login').addEventListener('submit', (e) => { e.preventDefault(); this.submitLogin(); });
    $('acc-switch').addEventListener('click', () => this.showLogin(this.mode === 'login' ? 'register' : 'login'));
    $('char-play').addEventListener('click', () => this.play());
    $('char-del').addEventListener('click', () => this.remove());
    $('acc-logout').addEventListener('click', () => this.logout());
    $('acc-create').addEventListener('submit', (e) => { e.preventDefault(); this.create(); });
    $('create-back').addEventListener('click', () => this.showChars());
    $('acc-retry').addEventListener('click', () => (this.reload ? location.reload() : this.start()));
    $('char-list').addEventListener('click', (e) => {
      const b = e.target.closest('.char-item');
      if (!b) return;
      if (b.dataset.id) { this.selected = b.dataset.id; this.showChars(); } else this.showCreate();
    });
    $('char-list').addEventListener('dblclick', (e) => { if (e.target.closest('.char-item[data-id]')) this.play(); });
    $('class-pick').addEventListener('click', (e) => {
      const b = e.target.closest('.class-opt');
      if (b) { this.cls = b.dataset.cls; this.renderClasses(); }
    });
  }

  // A request to the server, reconnecting first if the line is down (e.g. right after being signed out).
  async ask(t, data = {}) {
    if (!this.net.online) await this.net.connect();
    return this.net.request(t, data);
  }

  view(id) {
    for (const v of VIEWS) $(v).classList.toggle('hidden', v !== id);
    $('account').classList.remove('hidden');
  }

  // reload: the button reloads the page (a new version is out) instead of trying again
  wait(text, canRetry = false, reload = false) {
    this.reload = reload;
    $('acc-wait-text').textContent = text;
    $('acc-retry').textContent = reload ? 'Reload' : 'Try again';
    $('acc-retry').classList.toggle('hidden', !canRetry);
    this.view('acc-wait');
  }

  // Connect, then sign straight in with a saved token if there is one.
  async start(message = '') {
    this.wait('Connecting to the game server…');
    let hello;
    try {
      hello = this.net.online ? this.net.hello : await this.net.connect();
    } catch (err) {
      this.wait(`${err.message} Check your internet connection and try again.`, true);
      return;
    }
    if (hello?.v !== PROTOCOL) { // the game and the server must speak the same language
      this.net.ws?.close();
      if (hello?.v > PROTOCOL) this.wait('Emberwood has been updated. Reload the page to play.', true, true);
      else this.wait('The game server is being updated. Try again in a minute.', true);
      return;
    }
    const token = savedToken.get();
    if (token && !message) {
      try { this.signedIn(await this.ask('resume', { token })); return; } catch { savedToken.set(null); }
    }
    this.showLogin('login', message);
  }

  showLogin(mode, err = '') {
    this.mode = mode;
    const reg = mode === 'register';
    $('acc-login-title').textContent = reg ? 'Create an account' : 'Sign in';
    $('acc-go').textContent = reg ? 'Create account' : 'Sign in';
    $('acc-switch').textContent = reg ? 'Already have an account? Sign in' : 'New here? Create an account';
    $('acc-pass').autocomplete = reg ? 'new-password' : 'current-password';
    $('acc-pass2').classList.toggle('hidden', !reg);
    $('acc-err').textContent = err;
    this.view('acc-login');
    if (!this.net.online) return;
    setTimeout(() => ($('acc-user').value ? $('acc-pass') : $('acc-user')).focus(), 50);
  }

  async submitLogin() {
    const user = $('acc-user').value.trim(), pass = $('acc-pass').value, reg = this.mode === 'register';
    const err = (m) => { $('acc-err').textContent = m; };
    if (!USER_RULE.test(user)) return err('Usernames are 3–16 letters, numbers or _.');
    if (pass.length < 6) return err('Passwords need at least 6 characters.');
    if (reg && pass !== $('acc-pass2').value) return err('The two passwords are different.');
    $('acc-go').disabled = true;
    try {
      this.signedIn(await this.ask(reg ? 'register' : 'login', { user, pass }));
    } catch (e) {
      err(e.message);
    } finally {
      $('acc-go').disabled = false;
    }
  }

  signedIn(r) {
    savedToken.set(r.token);
    this.user = r.user;
    this.chars = r.chars;
    this.world = r.world;
    $('acc-pass').value = '';
    $('acc-pass2').value = '';
    if (this.chars.length) this.showChars(); else this.showCreate();
  }

  // ---------------------------------------------------------------- heroes
  showChars(selectId = null) {
    if (selectId) this.selected = selectId;
    if (!this.chars.some((c) => c.id === this.selected)) this.selected = this.chars[0]?.id || null;
    $('acc-who').textContent = this.user;
    const n = this.world;
    $('acc-online').textContent = n ? `${n} ${n === 1 ? 'hero is' : 'heroes are'} in the world right now` : '';
    $('char-list').innerHTML = this.chars.map((c) => `
      <button type="button" class="char-item${c.id === this.selected ? ' on' : ''}" data-id="${c.id}">
        <img src="${portrait(c.cls)}" alt=""><b>${escapeHtml(c.name)}</b><span>Level ${c.level} ${CLASSES[c.cls]?.name || ''}</span>
      </button>`).join('') + (this.chars.length < MAX_CHARACTERS ? '<button type="button" class="char-item new">+ New hero</button>' : '');
    $('char-play').disabled = !this.selected;
    $('char-del').classList.toggle('hidden', !this.selected);
    $('chars-err').textContent = '';
    this.view('acc-chars');
  }

  // Back from the game: fetch the list again (levels changed) and select the hero just played.
  async backFromGame(charId) {
    try {
      const r = await this.ask('chars');
      this.chars = r.chars;
      this.world = r.world;
    } catch { /* show what we have */ }
    this.showChars(charId);
  }

  renderClasses() {
    $('class-pick').innerHTML = CLASS_IDS.map((id) => `
      <button type="button" class="class-opt${id === this.cls ? ' on' : ''}" data-cls="${id}">
        <img src="${portrait(id)}" alt=""><b>${CLASSES[id].name}</b><span>${CLASSES[id].role}</span>
      </button>`).join('');
    $('class-desc').textContent = CLASSES[this.cls].desc;
    const save = localSave();
    $('import-row').classList.toggle('hidden', !save || this.cls !== 'knight');
    if (save) $('import-level').textContent = save.level;
  }

  showCreate() {
    if (this.chars.length >= MAX_CHARACTERS) return;
    $('char-name').value = '';
    $('create-err').textContent = '';
    $('create-back').classList.toggle('hidden', !this.chars.length);
    this.renderClasses();
    this.view('acc-create');
  }

  async create() {
    const name = $('char-name').value.trim();
    const err = (m) => { $('create-err').textContent = m; };
    if (!NAME_RULE.test(name)) return err('Names are 3–14 letters, no spaces or numbers.');
    const save = this.cls === 'knight' && $('char-import').checked ? localSave() : null;
    try {
      const r = await this.ask('createChar', { name, cls: this.cls, save });
      if (save) try { localStorage.setItem(IMPORTED, '1'); } catch { /* private mode */ }
      this.chars = r.chars;
      this.showChars(r.created);
    } catch (e) {
      err(e.message);
    }
  }

  async remove() {
    const c = this.chars.find((x) => x.id === this.selected);
    if (!c || !window.confirm(`Delete ${c.name}, your level ${c.level} ${CLASSES[c.cls].name.toLowerCase()}, forever?`)) return;
    try {
      this.chars = (await this.ask('deleteChar', { id: c.id })).chars;
      this.showChars();
    } catch (e) {
      $('chars-err').textContent = e.message;
    }
  }

  async logout() {
    try { await this.ask('logout'); } catch { /* signed out locally anyway */ }
    savedToken.set(null);
    this.net.session = null;
    this.chars = [];
    this.showLogin('login');
  }

  async play() {
    if (!this.selected) return;
    $('char-play').disabled = true;
    try {
      const r = await this.ask('play', { id: this.selected });
      this.net.session = { charId: r.char.id };
      $('account').classList.add('hidden');
      this.onPlay(r.char);
    } catch (e) {
      $('chars-err').textContent = e.message;
    } finally {
      $('char-play').disabled = false;
    }
  }
}
