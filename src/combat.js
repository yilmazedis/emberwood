// Projectiles (fireballs, bolts, knives, meteors, cultist orbs) and ground loot. owner: 'player' (ours:
// they deal damage), 'remote' (another hero's: for show, their game deals the damage) or 'enemy' (they
// hurt our hero). Options: mult (× weapon damage; spell: false = not scaled by Spell Power), aoe
// (blast radius), small (a light touch: no smoke or ring), noLight, meteor (a bigger crash), glide
// (fly level at this height over the ground, following it: heroes' shots, so they never sail over a
// slime or dive into a bump; they end on a monster, a wall or at their range).
import * as THREE from 'three';
import { cloneItem } from './assets.js';
import { heightAt, resolveCollision } from './world.js';
import { inDungeon, wallAt } from './dungeon.js';
import { RARITY, BASES } from './items.js';
import { buildGearModel } from './gear.js';
import { hdr } from './fx.js';
import { rand } from './util.js';

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.geo = new THREE.IcosahedronGeometry(1, 2);
  }

  clear() {
    for (const p of this.list) {
      this.game.scene.remove(p.mesh);
      p.mesh.material.dispose();
      this.game.fx.releaseLight(p.light);
    }
    this.list = [];
  }

  spawn(o) {
    const dir = o.dir ? o.dir.clone() : o.to.clone().sub(o.from);
    if (o.glide) dir.y = 0;
    dir.normalize();
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: hdr(o.color, 3.2) }));
    mesh.scale.setScalar(o.size || 0.3);
    mesh.position.copy(o.from);
    this.game.scene.add(mesh);
    const light = o.noLight ? null : this.game.fx.claimLight(mesh, o.color, 5, 7);
    this.list.push({ ...o, pos: o.from.clone(), dir, mesh, light, traveled: 0, t: 0 });
  }

  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const step = p.speed * dt;
      p.pos.addScaledVector(p.dir, step);
      if (p.glide) p.pos.y += (heightAt(p.pos.x, p.pos.z) + p.glide - p.pos.y) * Math.min(1, dt * 12); // down from the hand, then level
      p.traveled += step;
      p.t += dt;
      p.mesh.position.copy(p.pos);
      p.mesh.scale.setScalar((p.size || 0.3) * (1 + Math.sin(p.t * 30) * 0.08));
      if (p.light) p.light.light.position.copy(p.pos);
      g.fx.add.emit({ pos: p.pos, count: 2, spread: 0.12, velSpread: 0.5, color: hdr(p.color, 2.4), colorEnd: hdr(p.trail || p.color, 0.3), size: (p.size || 0.3) * 1.6, sizeEnd: 0.02, life: 0.35, drag: 2 });

      let hit = null;
      if (p.owner !== 'enemy') {
        for (const e of g.enemies.list) {
          if (!e.alive || e.state === 'spawn') continue;
          const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
          // (the projectile's own size counts: a bolt at chest height still hits a knee-high slime)
          if (Math.hypot(dx, dz) < e.radius + p.radius && p.pos.y + p.radius > e.pos.y - 0.2 && p.pos.y - p.radius < e.pos.y + e.height + 0.3) { hit = e; break; }
        }
      } else {
        // our hero (it hurts), or another hero in the way (it bursts on them; their game counts it)
        for (const pl of [g.player, ...g.others.list]) {
          if (pl.alive && Math.hypot(pl.pos.x - p.pos.x, pl.pos.z - p.pos.z) < pl.radius + p.radius && p.pos.y < pl.pos.y + 2.4) { hit = pl; break; }
        }
      }
      if (!hit && !p.glide && p.pos.y < heightAt(p.pos.x, p.pos.z) + 0.05) hit = 'ground';
      if (!hit && inDungeon(p.pos.x, p.pos.z) && wallAt(p.pos.x, p.pos.z)) hit = 'ground'; // crypt walls stop bolts
      if (hit || p.traveled > p.range) {
        this.explode(p, hit);
        g.scene.remove(p.mesh);
        p.mesh.material.dispose();
        g.fx.releaseLight(p.light);
        this.list.splice(i, 1);
      }
    }
  }

  explode(p, hit) {
    const g = this.game, vol = p.owner === 'player' ? 1 : g.volAt(p.pos);
    if (p.small) {
      g.fx.sparks(p.pos, p.color, 10, 3);
    } else {
      g.fx.burst(p.pos, p.color, p.meteor ? 90 : p.aoe ? 50 : 20, p.meteor ? 9 : p.aoe ? 6 : 3, p.aoe ? 0.45 : 0.3, p.meteor ? 0.9 : 0.6);
      g.fx.flashLight(p.pos, p.color, p.meteor ? 24 : p.aoe ? 14 : 6, p.meteor ? 0.7 : 0.45, p.meteor ? 16 : p.aoe ? 12 : 7);
    }
    if (p.owner !== 'enemy') {
      if (!p.small) {
        g.fx.ring({ x: p.pos.x, y: heightAt(p.pos.x, p.pos.z), z: p.pos.z }, 0.3, p.aoe || 1.2, p.color, p.meteor ? 0.7 : 0.45);
        g.fx.soft.emit({ pos: p.pos, count: p.meteor ? 30 : 12, spread: p.meteor ? 1.2 : 0.5, velSpread: 1.5, vel: { x: 0, y: 1.5, z: 0 }, color: new THREE.Color(0x3a3430), alpha: 0.35, size: 0.9, sizeEnd: p.meteor ? 3 : 1.8, life: p.meteor ? 1.8 : 1.1, drag: 2 });
        if (p.meteor) g.fx.dust(new THREE.Vector3(p.pos.x, heightAt(p.pos.x, p.pos.z) + 0.2, p.pos.z), 30);
      }
      if (vol) g.sfx.play(p.small ? 'hit' : p.meteor ? 'slam' : 'explode', p.small ? 0.5 * vol : vol);
      if (p.meteor && vol) g.sfx.play('explode', vol);
      if (p.meteor) g.shake(0.55 * vol);
      if (p.owner !== 'player') return; // someone else's: their game deals the damage
      if (!p.small) g.shake(0.25);
      const targets = p.aoe
        ? g.enemies.list.filter((e) => e.alive && e.state !== 'spawn' && Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < p.aoe + e.radius)
        : hit && hit !== 'ground' ? [hit] : [];
      for (const e of targets) g.damageEnemy(e, g.player.rollDamage(p.mult, p.spell !== false), p.pos, p.small ? 0.2 : 0.8);
    } else {
      if (vol) g.sfx.play('zap', vol);
      if (hit === g.player) g.damagePlayer(p.dmg, null);
    }
  }
}

// ---------------------------------------------------------------- loot on the ground
const beamGeo = new THREE.CylinderGeometry(0.16, 0.3, 3.2, 12, 1, true).translate(0, 1.6, 0);

function beamMaterial(hex) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: hdr(hex, 1.6) }, uT: { value: 0 } },
    vertexShader: 'varying float vY; void main(){ vY = position.y / 3.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uCol; uniform float uT; varying float vY; void main(){ float a = (1.0 - vY) * (0.45 + 0.1 * sin(uT * 3.0 + vY * 6.0)); gl_FragColor = vec4(uCol, a); }',
  });
}

function makeBag() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.9, flatShading: true });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), m);
  body.scale.set(1, 0.85, 1);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.18, 7), m);
  neck.position.y = 0.3;
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 5, 10), new THREE.MeshStandardMaterial({ color: 0xd8b36a }));
  tie.rotation.x = Math.PI / 2;
  tie.position.y = 0.25;
  g.add(body, neck, tie);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeCoins(amount) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.85, roughness: 0.3, emissive: 0x6a4200, emissiveIntensity: 0.6 });
  const n = Math.min(6, 1 + Math.floor(amount / 6));
  for (let i = 0; i < n; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12), mat);
    c.position.set(rand(-0.15, 0.15), i * 0.05, rand(-0.15, 0.15));
    c.rotation.set(rand(-0.3, 0.3), 0, rand(-0.3, 0.3));
    c.castShadow = true;
    g.add(c);
  }
  return g;
}

export class LootManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.fullMsgT = 0;
  }

  _spawn(kind, obj, pos, data) {
    const group = new THREE.Group();
    group.add(obj);
    group.position.copy(pos).setY(pos.y + 0.6);
    this.game.scene.add(group);
    const a = rand(0, Math.PI * 2), s = rand(1.2, 2.6);
    const l = { kind, group, obj, data, vel: new THREE.Vector3(Math.cos(a) * s, rand(4.5, 6), Math.sin(a) * s), landed: false, t: 0, bounces: 0 };
    if (kind === 'item') {
      const r = RARITY[data.rarity];
      if (r.beam) {
        l.beam = new THREE.Mesh(beamGeo, beamMaterial(r.beam));
        l.beam.visible = false;
        group.add(l.beam);
      }
      l.label = this.game.ui.createLabel(data.name, r.color, (out) => out.copy(group.position).setY(group.position.y + 0.95));
    }
    this.list.push(l);
    return l;
  }

  dropItem(item, pos) {
    let obj;
    const gear = BASES[item.base]?.gear;
    if (item.model) {
      obj = cloneItem(item.model);
      obj.scale.setScalar(0.62);
      obj.rotation.set(0, 0, item.slot === 'weapon' ? 1.25 : 0);
    } else if (gear) {
      obj = buildGearModel(gear);
      obj.scale.setScalar(gear.kind === 'ring' ? 0.9 : 0.8);
    } else {
      obj = makeBag();
    }
    this._spawn('item', obj, pos, item);
    this.game.sfx.play('drop', item.rarity === 'legendary' ? 1 : 0.6);
  }

  dropGold(amount, pos) {
    this._spawn('gold', makeCoins(amount), pos, amount);
  }

  dropPotion(pos) {
    const o = cloneItem('mug_full');
    o.scale.setScalar(0.55);
    this._spawn('potion', o, pos, 1);
  }

  remove(l) {
    this.game.scene.remove(l.group);
    if (l.label) this.game.ui.removePlate(l.label);
    l.dead = true;
  }

  clear() {
    for (const l of this.list) this.remove(l);
    this.list = [];
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.fullMsgT -= dt;
    for (const l of this.list) {
      l.t += dt;
      const gp = l.group.position;
      const ground = heightAt(gp.x, gp.z) + (l.kind === 'item' ? 0.35 : 0.08);
      if (!l.landed) {
        l.vel.y -= 16 * dt;
        gp.addScaledVector(l.vel, dt);
        if (inDungeon(gp.x, gp.z)) resolveCollision(gp, 0.35); // don't land inside a crypt wall
        l.obj.rotation.y += dt * 8;
        if (gp.y <= ground && l.vel.y < 0) {
          gp.y = ground;
          if (l.bounces++ < 1) { l.vel.y *= -0.35; l.vel.x *= 0.4; l.vel.z *= 0.4; } else { l.landed = true; if (l.beam) l.beam.visible = true; }
        }
      } else {
        if (l.kind === 'item') {
          l.obj.position.y = Math.sin(l.t * 2.5) * 0.08;
          l.obj.rotation.y += dt * 1.2;
          if (l.beam) l.beam.material.uniforms.uT.value = l.t;
        } else {
          gp.y = ground;
          l.obj.rotation.y += dt * 2;
        }
      }
      if (!p.alive) continue;
      const dx = p.pos.x - gp.x, dz = p.pos.z - gp.z, d = Math.hypot(dx, dz);
      if (l.kind !== 'item' && l.landed && d < 2.8) {
        // magnet towards the player
        const k = Math.min(1, dt * 10);
        gp.x += dx * k; gp.z += dz * k;
        if (d < 0.6) {
          if (l.kind === 'gold') g.addGold(l.data, gp);
          else g.addPotion(gp);
          this.remove(l);
        }
      } else if (l.kind === 'item' && l.landed && d < 1.3) {
        if (p.addItem(l.data)) {
          g.ui.log(`Picked up <b style="color:${RARITY[l.data.rarity].color}">${l.data.name}</b>`);
          g.sfx.play('pickup');
          g.quests.onEvent('loot', { rarity: l.data.rarity });
          this.remove(l);
        } else if (this.fullMsgT <= 0) {
          g.ui.centerMsg('Your bag is full');
          this.fullMsgT = 3;
        }
      }
      if (l.t > (l.kind === 'item' && l.data.rarity !== 'common' ? 240 : 120)) this.remove(l);
    }
    this.list = this.list.filter((l) => !l.dead);
  }
}
