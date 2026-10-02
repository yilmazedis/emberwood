// Offline play (?autostart, used by the automated tests): the shared world (sim/world.js) runs right
// here in the page instead of on the game server, behind the same messages, so the game can't tell.
import { WorldSim, TICK } from './sim/world.js';

export class LocalWorld {
  constructor() {
    this.time = 0;
    this.acc = 0;
    this.sim = new WorldSim({ now: () => Math.round(this.time * 1000) });
    this.handlers = {};
    this.online = true;
    this.session = null;
    this.who = null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  emit(type, data) {
    this.handlers[type]?.(data);
  }

  async request(t, data = {}) {
    if (t === 'enter') {
      this.who = { name: data.name, cls: data.cls };
      const where = this.sim.join(1, { ...data, key: 'local' });
      return { t: 'entered', pid: 1, chat: [], online: 1, ...where };
    }
    if (t === 'travel') {
      const r = this.sim.travel(1, String(data.to || ''), { respawn: !!data.respawn });
      if (r.error) throw new Error(r.error);
      return { t: 'traveled', ...r };
    }
    if (t === 'exit') {
      this.sim.leave(1);
      return { t: 'exited' };
    }
    if (t.startsWith('party')) throw new Error('Parties need the game server (play online).');
    if (t === 'chat') {
      const text = String(data.text || '').trim().slice(0, 160);
      if (text) this.emit('chat', { t: 'chat', i: 1, n: this.who?.name, c: this.who?.cls, x: text, ts: Math.round(this.time * 1000) });
      return { t: 'said' };
    }
    return {};
  }

  send(t, data) {
    if (t === 'u') this.sim.input(1, data);
  }

  // Called every frame: the world moves on in steps of TICK, like the server's.
  update(dt) {
    this.time += dt;
    this.acc += dt;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.sim.step(TICK, (pid, msg) => this.emit('w', msg));
    }
  }
}
