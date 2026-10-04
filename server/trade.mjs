// Trading between two heroes: one asks, the other says yes, and a trade window opens for both. Each puts in
// items from their bag and some gold (any change takes both "accept"s back), and when both accept, the server
// does the swap itself, on the heroes' saves as their games sent them with their accept: it checks every item
// and coin is really there, writes both heroes and tells each game its new bag and gold. A hero's save from
// before the swap is refused afterwards (its rev is behind), so nothing is lost or doubled.
import { ITEMS } from '../src/items.js';

const ASK_FOR = 30000; // ms an invitation lasts
const NEAR = 25; // m: how close two heroes must be to trade
const MAX_ITEMS = 12;
const BAG_SIZE = 30;

const trades = new Map(); // id -> { id, sides: [side, side] }; side: { c, id: character id, items: [item], gold, ok, save }
const tradeOf = new Map(); // character id -> trade
const asks = new Map(); // asked character id -> { from: character id, at }
let lastId = 0;

const sideOf = (t, charId) => t.sides.find((s) => s.id === charId);
const otherOf = (t, charId) => t.sides.find((s) => s.id !== charId);

function view(t, me) {
  const mine = sideOf(t, me), theirs = otherOf(t, me);
  return { t: 'tradeState', id: t.id, with: theirs.c.char?.name || '?', mine: { items: mine.items, gold: mine.gold, ok: mine.ok }, theirs: { items: theirs.items, gold: theirs.gold, ok: theirs.ok } };
}

function sendState(t) {
  for (const s of t.sides) s.c.send(view(t, s.id));
}

function close(t, msg) {
  trades.delete(t.id);
  for (const s of t.sides) {
    tradeOf.delete(s.id);
    s.c.send({ t: 'tradeClosed', msg });
  }
}

// A hero left, travelled or went away: their trade (if any) ends.
export function cancelFor(charId, msg) {
  const t = trades.get(tradeOf.get(charId));
  if (t) close(t, msg);
  asks.delete(charId);
}

// Two heroes in the world, near each other, both free to trade?
function check(c, them, { world, Oops }) {
  if (!c.pid || !them?.pid) throw new Oops('They are not in the world.');
  const a = world.players.get(c.pid), b = world.players.get(them.pid);
  if (!a || !b || a.area !== b.area || Math.hypot(a.x - b.x, a.z - b.z) > NEAR) throw new Oops('Stand closer to trade.');
  if (!a.alive || !b.alive) throw new Oops('Not now.');
}

export function request(c, m, ctx) {
  const { inWorld, Oops } = ctx;
  if (!c.char) throw new Oops('Pick a hero first.');
  const them = inWorld.get(Number(m.pid));
  if (!them?.char || them === c) throw new Oops('Nobody to trade with.');
  check(c, them, ctx);
  if (tradeOf.has(c.char.id)) throw new Oops('You are trading already.');
  if (tradeOf.has(them.char.id)) throw new Oops(`${them.char.name} is trading with someone else.`);
  const now = Date.now();
  if (now - (c.askedAt || 0) < 3000) throw new Oops('Wait a moment before asking again.');
  c.askedAt = now;
  asks.set(them.char.id, { from: c.char.id, fromPid: c.pid, at: now });
  them.send({ t: 'tradeAsk', from: c.char.name, c: c.char.cls });
  return { t: 'tradeAsked', name: them.char.name };
}

export function answer(c, m, ctx) {
  const { inWorld, Oops } = ctx;
  if (!c.char) throw new Oops('Pick a hero first.');
  const ask = asks.get(c.char.id);
  asks.delete(c.char.id);
  if (!ask || Date.now() - ask.at > ASK_FOR) throw new Oops('That offer to trade ran out.');
  const them = inWorld.get(ask.fromPid);
  if (!them?.char || them.char.id !== ask.from) throw new Oops('They are not in the world any more.');
  if (!m.yes) { them.send({ t: 'chat', s: 1, x: `${c.char.name} does not want to trade.` }); return { t: 'answered' }; }
  check(c, them, ctx);
  if (tradeOf.has(c.char.id) || tradeOf.has(them.char.id)) throw new Oops('One of you is trading already.');
  const t = { id: ++lastId, sides: [{ c: them, id: them.char.id, items: [], gold: 0, ok: false }, { c, id: c.char.id, items: [], gold: 0, ok: false }] };
  trades.set(t.id, t);
  for (const s of t.sides) tradeOf.set(s.id, t.id);
  sendState(t);
  return { t: 'answered' };
}

// What we put in: { items: [item objects from our bag], gold }. Any change takes both accepts back.
export function offer(c, m, { Oops }) {
  const t = trades.get(tradeOf.get(c.char?.id));
  if (!t) throw new Oops('You are not trading.');
  const me = sideOf(t, c.char.id);
  const items = Array.isArray(m.items) ? m.items.slice(0, MAX_ITEMS) : [];
  if (items.some((it) => !it || typeof it !== 'object' || typeof it.id !== 'string' || typeof it.k !== 'string' || !Object.hasOwn(ITEMS, it.k))) throw new Oops('Unknown item.');
  if (new Set(items.map((it) => it.id)).size !== items.length) throw new Oops('An item can only go in once.');
  me.items = items;
  me.gold = Math.max(0, Math.floor(Number(m.gold) || 0));
  for (const s of t.sides) s.ok = false;
  sendState(t);
  return { t: 'offered' };
}

// We accept, with our hero as our game has it now. When both have, the swap happens.
export function accept(c, m, { checkSave, store, Oops }) {
  const t = trades.get(tradeOf.get(c.char?.id));
  if (!t) throw new Oops('You are not trading.');
  const me = sideOf(t, c.char.id);
  me.save = checkSave(m.save);
  me.ok = true;
  if (!t.sides.every((s) => s.ok)) { sendState(t); return { t: 'accepted' }; }
  // both accepted: check, then swap
  const [a, b] = t.sides;
  const problem = verify(a) || verify(b) || fits(a, b) || fits(b, a);
  if (problem) { close(t, problem); return { t: 'accepted' }; }
  const outA = swap(a, b), outB = swap(b, a);
  for (const [s, save] of [[a, outA], [b, outB]]) {
    const ch = s.c.char;
    ch.rev = (ch.rev || 0) + 1;
    store.saveCharacter(s.c.acc, ch.id, save);
    s.c.send({ t: 'tradeDone', bag: save.bag, gold: save.gold, rev: ch.rev, got: (s === a ? b : a).items.length, gotGold: (s === a ? b : a).gold });
  }
  trades.delete(t.id);
  for (const s of t.sides) tradeOf.delete(s.id);
  console.log(`trade: ${a.c.char.name} gave ${a.items.length} items + ${a.gold}g, ${b.c.char.name} gave ${b.items.length} items + ${b.gold}g`);
  return { t: 'accepted' };
}

export function cancel(c) {
  const t = trades.get(tradeOf.get(c.char?.id));
  if (t) close(t, `${c.char.name} closed the trade.`);
  return { t: 'cancelled' };
}

// Every item offered is in the hero's bag as it saved it (by id, the same item), and the gold is there.
function verify(s) {
  const bag = Array.isArray(s.save.bag) ? s.save.bag : [];
  for (const it of s.items) {
    const have = bag.find((x) => x && x.id === it.id);
    if (!have || have.k !== it.k || (have.n || 1) !== (it.n || 1) || (have.p ?? null) !== (it.p ?? null)) return `${s.c.char.name} no longer has everything they offered.`;
  }
  if ((s.save.gold || 0) < s.gold) return `${s.c.char.name} does not have that much gold.`;
  return null;
}

// Room in the receiver's bag for what the giver puts in (after the receiver's own offer leaves it).
function fits(receiver, giver) {
  const bag = Array.isArray(receiver.save.bag) ? receiver.save.bag : [];
  const free = Array.from({ length: BAG_SIZE }, (_, i) => bag[i] || null).filter((x) => !x || receiver.items.some((it) => it.id === x.id)).length;
  return free < giver.items.length ? `${receiver.c.char.name} has no room in their bag.` : null;
}

// The receiver's save after the swap: its offered items and gold out, the giver's in.
function swap(receiver, giver) {
  const save = { ...receiver.save };
  const out = new Set(receiver.items.map((it) => it.id));
  const bag = Array.from({ length: BAG_SIZE }, (_, i) => save.bag?.[i] || null).map((x) => (x && out.has(x.id) ? null : x));
  for (const it of giver.items) {
    const have = giver.save.bag.find((x) => x && x.id === it.id);
    bag[bag.indexOf(null)] = have;
  }
  save.bag = bag;
  save.gold = Math.max(0, (save.gold || 0) - receiver.gold + giver.gold);
  return save;
}
