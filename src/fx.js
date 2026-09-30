// Visual effects: GPU point particles, slash arcs, shockwaves, ground telegraphs, light pool.
import * as THREE from 'three';
import { heightAt } from './world.js';
import { rand } from './util.js';

const MAX = 4000;

class Particles {
  constructor(scene, blending) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending,
      vertexShader: `attribute vec4 pcolor; attribute float psize; uniform float uScale; varying vec4 vC;
        void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = psize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 1.6);
        if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.geo = g;
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.list = [];
  }

  emit(o) {
    const n = o.count || 1;
    for (let i = 0; i < n && this.list.length < MAX; i++) {
      const sp = o.spread ?? 0.2;
      const vs = o.velSpread ?? 1;
      const c0 = o.color, c1 = o.colorEnd || o.color;
      this.list.push({
        x: o.pos.x + rand(-sp, sp), y: o.pos.y + rand(-sp, sp) * (o.flat ? 0.2 : 1), z: o.pos.z + rand(-sp, sp),
        vx: (o.vel?.x || 0) + rand(-vs, vs), vy: (o.vel?.y || 0) + rand(-vs, vs) * (o.flatVel ? 0.2 : 1), vz: (o.vel?.z || 0) + rand(-vs, vs),
        life: 0, max: (o.life || 0.8) * rand(0.7, 1.2),
        s0: (o.size || 0.3) * rand(0.7, 1.3), s1: o.sizeEnd ?? 0,
        r0: c0.r, g0: c0.g, b0: c0.b, r1: c1.r, g1: c1.g, b1: c1.b,
        a: o.alpha ?? 1, grav: o.gravity ?? 0, drag: o.drag ?? 1.5,
      });
    }
  }

  update(dt) {
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.life / p.max;
      this.pos[w * 3] = p.x; this.pos[w * 3 + 1] = p.y; this.pos[w * 3 + 2] = p.z;
      this.col[w * 4] = p.r0 + (p.r1 - p.r0) * t;
      this.col[w * 4 + 1] = p.g0 + (p.g1 - p.g0) * t;
      this.col[w * 4 + 2] = p.b0 + (p.b1 - p.b0) * t;
      this.col[w * 4 + 3] = p.a * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      this.size[w] = p.s0 + (p.s1 - p.s0) * t;
      L[w++] = p;
    }
    L.length = w;
    this.geo.setDrawRange(0, w);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
  }
}

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.add = new Particles(scene, THREE.AdditiveBlending);
    this.soft = new Particles(scene, THREE.NormalBlending);
    this.effects = [];
    // A fixed pool of point lights (adding/removing lights forces shader recompiles).
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 9, 1.6);
      scene.add(l);
      this.lights.push({ light: l, owner: null, t: 0, dur: 0, peak: 0 });
    }
  }

  setViewport(heightPx, fov) {
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.add.uniforms.uScale.value = s;
    this.soft.uniforms.uScale.value = s;
  }

  claimLight(owner, color, intensity, distance = 9) {
    const slot = this.lights.find((l) => !l.owner && l.dur <= 0) || null;
    if (!slot) return null;
    slot.owner = owner;
    slot.light.color.set(color);
    slot.light.intensity = intensity;
    slot.light.distance = distance;
    return slot;
  }
  releaseLight(slot) {
    if (!slot) return;
    slot.owner = null;
    slot.light.intensity = 0;
  }
  flashLight(pos, color, intensity, dur, distance = 10) {
    const slot = this.lights.find((l) => !l.owner && l.dur <= 0) || this.lights.find((l) => !l.owner);
    if (!slot) return;
    slot.light.position.copy(pos);
    slot.light.color.set(color);
    slot.light.distance = distance;
    slot.peak = intensity;
    slot.t = 0;
    slot.dur = dur;
  }

  // ----- particle presets
  sparks(pos, hex = 0xfff0c0, count = 12, speed = 5) {
    this.add.emit({ pos, count, spread: 0.15, velSpread: speed, vel: { x: 0, y: 1.5, z: 0 }, color: hdr(hex, 2.5), colorEnd: hdr(0xff6a20, 1), size: 0.16, sizeEnd: 0.02, life: 0.35, gravity: 9, drag: 3 });
  }
  burst(pos, hex, count = 30, speed = 4, size = 0.35, life = 0.7) {
    this.add.emit({ pos, count, spread: 0.3, velSpread: speed, vel: { x: 0, y: 1, z: 0 }, color: hdr(hex, 2.2), colorEnd: hdr(hex, 0.3), size, sizeEnd: 0.02, life, gravity: 2, drag: 2.5 });
  }
  goo(pos, hex, count = 26) {
    this.soft.emit({ pos, count, spread: 0.35, velSpread: 3.5, vel: { x: 0, y: 3.5, z: 0 }, color: new THREE.Color(hex), size: 0.28, sizeEnd: 0.1, life: 0.8, gravity: 12, drag: 0.8 });
  }
  dust(pos, count = 8) {
    this.soft.emit({ pos, count, spread: 0.3, velSpread: 1.2, vel: { x: 0, y: 0.6, z: 0 }, color: new THREE.Color(0xcbb78f), colorEnd: new THREE.Color(0xa99a7a), alpha: 0.45, size: 0.55, sizeEnd: 1.1, life: 0.8, drag: 3, flatVel: true });
  }
  bones(pos, eyeHex = 0x6dffd8) {
    this.soft.emit({ pos, count: 18, spread: 0.4, velSpread: 3, vel: { x: 0, y: 4, z: 0 }, color: new THREE.Color(0xf0e8d4), colorEnd: new THREE.Color(0xb8ae98), size: 0.2, sizeEnd: 0.12, life: 0.9, gravity: 14, drag: 0.6 });
    this.soft.emit({ pos, count: 10, spread: 0.5, velSpread: 1, vel: { x: 0, y: 0.8, z: 0 }, color: new THREE.Color(0xcfc6b2), alpha: 0.4, size: 0.7, sizeEnd: 1.5, life: 1.0, drag: 2.5 });
    this.add.emit({ pos: { x: pos.x, y: pos.y + 0.6, z: pos.z }, count: 14, spread: 0.2, velSpread: 0.5, vel: { x: 0, y: 1.6, z: 0 }, color: hdr(eyeHex, 2.2), colorEnd: hdr(eyeHex, 0.2), size: 0.2, sizeEnd: 0.02, life: 1.2, drag: 1 });
  }
  fire(pos, scale = 1, spirit = false) {
    if (spirit) {
      this.add.emit({ pos, count: 1, spread: 0.2 * scale, velSpread: 0.2, vel: { x: 0, y: 1.5 * scale, z: 0 }, color: hdr(0x9dffb0, 2.4), colorEnd: hdr(0x10c060, 0.5), size: 0.5 * scale, sizeEnd: 0.08, life: 0.8, drag: 1 });
      return;
    }
    this.add.emit({ pos, count: 1, spread: 0.25 * scale, velSpread: 0.25, vel: { x: 0, y: 1.8 * scale, z: 0 }, color: hdr(0xffb040, 2.4), colorEnd: hdr(0xff3a10, 0.6), size: 0.55 * scale, sizeEnd: 0.1, life: 0.7, drag: 1 });
    if (Math.random() < 0.3) this.soft.emit({ pos: { x: pos.x, y: pos.y + 0.9 * scale, z: pos.z }, count: 1, spread: 0.2, velSpread: 0.2, vel: { x: 0.2, y: 1.2, z: 0 }, color: new THREE.Color(0x4a4440), alpha: 0.25, size: 0.5, sizeEnd: 1.4, life: 1.6, drag: 0.6 });
    if (Math.random() < 0.08) this.add.emit({ pos, count: 1, spread: 0.2, velSpread: 0.8, vel: { x: 0, y: 3, z: 0 }, color: hdr(0xffc060, 3), size: 0.08, sizeEnd: 0.02, life: 1.4, drag: 0.5 });
  }
  heal(pos) {
    this.add.emit({ pos, count: 40, spread: 0.7, velSpread: 0.6, vel: { x: 0, y: 2.6, z: 0 }, color: hdr(0x7dff9a, 2), colorEnd: hdr(0x2aff80, 0.3), size: 0.22, sizeEnd: 0.04, life: 1.1, drag: 1.2, flat: true });
  }
  levelUp(pos) {
    this.add.emit({ pos, count: 90, spread: 0.9, velSpread: 1.2, vel: { x: 0, y: 5, z: 0 }, color: hdr(0xffe08a, 2.6), colorEnd: hdr(0xff9a2a, 0.4), size: 0.25, sizeEnd: 0.03, life: 1.5, drag: 1.4, flat: true });
    this.ring(pos, 0.5, 5, 0xffd060, 0.8);
    this.pillar(pos, 0xffd060, 1.2);
  }

  // ----- mesh effects
  arc(pos, yaw, { span = 2, rIn = 0.7, rOut = 2.4, color = 0xfff2d0, dur = 0.22, reverse = false, height = 1.0 } = {}) {
    const geo = new THREE.RingGeometry(rIn, rOut, 40, 1, -Math.PI / 2 - span / 2, span);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uCol: { value: hdr(color, 2.2) }, uProg: { value: 0 }, uFade: { value: 1 }, uSpan: { value: span }, uIn: { value: rIn }, uOut: { value: rOut }, uRev: { value: reverse ? 1 : 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uCol; uniform float uProg, uFade, uSpan, uIn, uOut, uRev; varying vec3 vP;
        void main(){
          float r = length(vP.xz); float ang = atan(vP.x, vP.z);
          float a01 = clamp(ang / uSpan + 0.5, 0.0, 1.0); if (uRev > 0.5) a01 = 1.0 - a01;
          float head = uProg * 1.25;
          float trail = smoothstep(head - 0.7, head, a01) * step(a01, head);
          float mid = mix(uIn, uOut, 0.72);
          float radial = smoothstep(uIn, mid, r) * (1.0 - smoothstep(mid, uOut, r));
          float a = trail * radial * uFade;
          gl_FragColor = vec4(uCol * (0.6 + radial), a);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y + height, pos.z);
    mesh.rotation.y = yaw;
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    this.effects.push({ mesh, t: 0, dur, update: (e, p) => { mat.uniforms.uProg.value = Math.min(1, p * 1.6); mat.uniforms.uFade.value = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45; } });
  }

  ring(pos, r0, r1, color, dur = 0.5, y = 0.15, intensity = 2) {
    const geo = new THREE.RingGeometry(0.82, 1, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: hdr(color, intensity), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y + y, pos.z);
    this.scene.add(mesh);
    this.effects.push({ mesh, t: 0, dur, update: (e, p) => { const s = r0 + (r1 - r0) * (1 - Math.pow(1 - p, 3)); mesh.scale.setScalar(s); mat.opacity = 1 - p; } });
  }

  pillar(pos, color, dur = 1) {
    const geo = new THREE.CylinderGeometry(0.9, 0.9, 6, 24, 1, true);
    geo.translate(0, 3, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uCol: { value: hdr(color, 1.8) }, uA: { value: 1 } },
      vertexShader: 'varying float vY; void main(){ vY = position.y / 6.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uCol; uniform float uA; varying float vY; void main(){ gl_FragColor = vec4(uCol, uA * (1.0 - vY) * 0.6); }',
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.effects.push({ mesh, t: 0, dur, update: (e, p) => { mat.uniforms.uA.value = 1 - p; mesh.scale.set(1 - p * 0.6, 1 + p * 0.3, 1 - p * 0.6); } });
  }

  // Ground warning circle that fills up; calls onDone when it completes.
  telegraph(pos, radius, dur, onDone, color = 0xff3a2a) {
    let y = -Infinity;
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI * 2, r = i === 8 ? 0 : radius;
      y = Math.max(y, heightAt(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r));
    }
    const geo = new THREE.CircleGeometry(1, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uCol: { value: new THREE.Color(color) }, uProg: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uCol; uniform float uProg; varying vec2 vP;
        void main(){ float r = length(vP);
          float edge = smoothstep(0.9, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
          float fill = step(r, uProg) * 0.35 + 0.12;
          gl_FragColor = vec4(uCol, max(edge * 0.9, fill)); }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, y + 0.06, pos.z);
    mesh.scale.setScalar(radius);
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.effects.push({ mesh, t: 0, dur, update: (e, p) => { mat.uniforms.uProg.value = p; }, done: onDone });
  }

  update(dt) {
    this.add.update(dt);
    this.soft.update(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      const p = Math.min(1, e.t / e.dur);
      e.update(e, p);
      if (p >= 1) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        this.effects.splice(i, 1);
        if (e.done) e.done();
      }
    }
    for (const l of this.lights) {
      if (l.owner || l.dur <= 0) continue;
      l.t += dt;
      const p = l.t / l.dur;
      l.light.intensity = p >= 1 ? 0 : l.peak * (1 - p) * (1 - p);
      if (p >= 1) l.dur = 0;
    }
  }
}

export { hdr };
