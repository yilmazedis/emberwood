// A KayKit humanoid: model + animator + hand-slot equipment + procedural melee swings.
// The free pack ships without attack clips, so swings are layered on top of the playing
// animation by rotating the spine/arm bones in character space after the mixer runs.
import * as THREE from 'three';
import { cloneCharacter, cloneItem } from './assets.js';
import { Animator } from './animator.js';
import { enchant } from './enchant.js';
import { lerp, easeOutCubic, easeInOut } from './util.js';

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _axis = new THREE.Vector3();
// (for aiming a bow: aimBow)
const _f = new THREE.Vector3(), _v = Array.from({ length: 8 }, () => new THREE.Vector3());
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _flash = new THREE.Color();

// Which way a bow's string lies from its grip (the bow's own origin), in the bow's own space: toward the middle
// of the whole bow, since the string is across from the grip.
function stringSideOf(bow) {
  const parent = bow.parent, keep = { p: bow.position.clone(), q: bow.quaternion.clone(), s: bow.scale.clone() };
  parent?.remove(bow);
  bow.position.set(0, 0, 0);
  bow.quaternion.identity();
  bow.scale.set(1, 1, 1);
  bow.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(bow).getCenter(new THREE.Vector3());
  bow.position.copy(keep.p);
  bow.quaternion.copy(keep.q);
  bow.scale.copy(keep.s);
  parent?.add(bow);
  bow.updateMatrixWorld(true);
  c.y = 0; // (along the bow doesn't count)
  return c.lengthSq() > 1e-8 ? c.normalize() : new THREE.Vector3(0, 0, -1);
}

// piecewise keyframes: [[t, value], ...] with smooth interpolation
function keyed(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t <= t1) return lerp(v0, v1, easeInOut((t - t0) / (t1 - t0)));
  }
  return keys[keys.length - 1][1];
}

// Swing styles, as keyframed angles (radians) in character space:
//   twist: chest yaw (negative = turn to the right)   side: right arm lift outward
//   fwd:   right arm raise forward (negative = up)     lean: spine pitch
//   wrist: blade pitch                                 roll: blade roll (lays the blade flat)
//   lfwd:  left (shield) arm raise forward
export const SWINGS = {
  bow: { // draw and loose: a little side on (twist), the arms aimed by aimBow while `aim` is up: the bow arm out
    // level at the target with the bow upright, the string hand drawn to the cheek; at the middle (0.5) the arrow
    // goes and the hand flicks back (`loose`)
    twist: [[0, 0], [0.32, -0.25], [0.62, -0.25], [1, 0]],
    lean: [[0, 0], [0.32, -0.03], [0.5, -0.03], [0.56, -0.07], [1, 0]],
    elbow: [[0, 0], [0.32, -0.6], [0.5, -0.6], [0.56, -0.15], [1, 0]],
    aim: [[0, 0], [0.3, 1], [0.62, 1], [1, 0]],
    loose: [[0, 0], [0.5, 0], [0.56, 1], [0.8, 0.5], [1, 0]],
  },
  slash: { // forehand: wind up on the right, sweep across to the left
    twist: [[0, 0], [0.3, -0.85], [0.5, 0.8], [1, 0]],
    side: [[0, 0], [0.3, 1.25], [0.5, 0.35], [1, 0]],
    fwd: [[0, 0], [0.3, -0.25], [0.5, -1.45], [1, 0]],
    lean: [[0, 0], [0.3, -0.06], [0.5, 0.12], [1, 0]],
    wrist: [[0, 0], [0.3, -0.8], [0.5, 0], [1, 0]],
    roll: [[0, 0], [0.3, 0], [0.5, -1.3], [1, 0]],
  },
  backslash: { // backhand: arm across the body, sweep out to the right
    twist: [[0, 0], [0.3, 0.75], [0.5, -0.9], [1, 0]],
    side: [[0, 0], [0.3, -0.1], [0.5, 1.15], [1, 0]],
    fwd: [[0, 0], [0.3, -1.35], [0.5, -0.55], [1, 0]],
    lean: [[0, 0], [0.3, -0.05], [0.5, 0.12], [1, 0]],
    wrist: [[0, 0], [0.3, -0.5], [0.5, 1.2], [1, 0]],
  },
  chop: { // overhead: blade cocked behind the head, brought down in front
    twist: [[0, 0], [0.38, -0.3], [0.56, 0.15], [1, 0]],
    side: [[0, 0], [0.38, 0.35], [0.56, 0.1], [1, 0]],
    fwd: [[0, 0], [0.38, -2.9], [0.56, -1.1], [1, 0]],
    lean: [[0, 0], [0.38, -0.22], [0.56, 0.35], [1, 0]],
    wrist: [[0, 0], [0.38, 0.2], [0.56, 1.2], [1, 0]],
  },
  bash: { // shield punch: the shoulder turns away, then the left arm drives forward with a lean
    twist: [[0, 0], [0.3, 0.55], [0.5, -0.4], [1, 0]],
    lean: [[0, 0], [0.3, -0.1], [0.5, 0.3], [1, 0]],
    lfwd: [[0, 0], [0.3, 0.35], [0.5, -1.45], [1, 0]],
    fwd: [[0, 0], [0.3, 0.2], [0.5, 0.35], [1, 0]],
  },
  stab: { // a quick dagger thrust
    twist: [[0, 0], [0.3, 0.35], [0.55, -0.3], [1, 0]],
    side: [[0, 0], [0.3, 0.25], [0.55, 0.05], [1, 0]],
    fwd: [[0, 0], [0.3, -0.5], [0.55, -1.55], [1, 0]],
    lean: [[0, 0], [0.3, -0.05], [0.55, 0.22], [1, 0]],
    wrist: [[0, 0], [0.3, 0.5], [0.55, 1.35], [1, 0]],
  },
  cleave: { // big forehand with a longer wind-up
    twist: [[0, 0], [0.36, -1.15], [0.56, 1.1], [1, 0]],
    side: [[0, 0], [0.36, 1.35], [0.56, 0.4], [1, 0]],
    fwd: [[0, 0], [0.36, -0.2], [0.56, -1.45], [1, 0]],
    lean: [[0, 0], [0.36, -0.12], [0.56, 0.2], [1, 0]],
    wrist: [[0, 0], [0.36, -1.0], [0.56, 0], [1, 0]],
    roll: [[0, 0], [0.36, 0], [0.56, -1.3], [1, 0]],
  },
};
const NO_KEYS = [[0, 0], [1, 0]];

// ---------------------------------------------------------------- gloves & boots on the model
// The Knight has no separate glove/boot meshes, but its hands and feet are skinned to their own
// bones. uBoneTint[bone] = (glove amount, boot amount); each vertex sums it by its skin weights,
// and the fragment shader blends in the gear's colour, metalness/roughness and glow.
const MAX_BONES = 32;

function injectGearTint(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      uniform vec2 uBoneTint[${MAX_BONES}];
      varying vec2 vGear;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vGear = uBoneTint[int(skinIndex.x)] * skinWeight.x + uBoneTint[int(skinIndex.y)] * skinWeight.y
            + uBoneTint[int(skinIndex.z)] * skinWeight.z + uBoneTint[int(skinIndex.w)] * skinWeight.w;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform vec3 uGloveColor; uniform vec3 uBootColor;
      uniform vec3 uGloveMat; uniform vec3 uBootMat; // metalness, roughness, glow
      uniform vec3 uGearGlow;
      varying vec2 vGear;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      float gloveA = clamp(vGear.x, 0.0, 1.0), bootA = clamp(vGear.y, 0.0, 1.0);
      float gearLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, uGloveColor * (0.55 + 0.9 * gearLum), gloveA);
      diffuseColor.rgb = mix(diffuseColor.rgb, uBootColor * (0.55 + 0.9 * gearLum), bootA);`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor = mix(mix(metalnessFactor, uGloveMat.x, gloveA), uBootMat.x, bootA);`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(mix(roughnessFactor, uGloveMat.y, gloveA), uBootMat.y, bootA);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += uGearGlow * (uGloveMat.z * gloveA + uBootMat.z * bootA);`);
}

export class Humanoid {
  // palette: repaint the character (assets.js PALETTES); tint: multiply all its colours
  constructor(charName, { scale = 1, tint = null, palette = null } = {}) {
    const c = cloneCharacter(charName, palette);
    this.model = c.root;
    this.bones = c.bones;
    this.meshes = c.meshes;
    this.materials = c.materials;
    this.group = new THREE.Group();
    this.group.add(this.model);
    this.model.scale.setScalar(scale);
    this.scale = scale;
    if (tint !== null) for (const m of this.materials) m.color.set(tint);
    this.baseEmissive = this.materials.map((m) => m.emissive.clone());
    this.anim = new Animator(this.model);
    this.anim.setBase('Idle_A');
    this.hands = { r: null, l: null };
    this.swing = null;
    this.flash = 0;
    this.flashColor = new THREE.Color(1, 1, 1);
    this.highlight = 0;
    this.frost = 0; // icy tint while slowed (0..1)
    this.armsOut = 0; // whirlwind pose weight
    this.sideSign = 1; // flipped at runtime if the rig's right arm is mirrored
  }

  get position() {
    return this.group.position;
  }

  // plus: the item's upgrade (+8 and up glow: enchant.js); center: it glows around its middle (shields…)
  equip(hand, modelName, glow = null, tint = null, plus = 0, center = false) {
    const bone = this.bones[hand === 'r' ? 'handslotr' : 'handslotl'];
    const key = `${modelName}|${glow}|${tint}|${plus >= 8 ? plus : 0}`;
    if (this.handKeys?.[hand] === key) return; // (already holding just that)
    (this.handKeys ||= {})[hand] = key;
    this.handFx ||= {};
    this.handFx[hand]?.dispose();
    this.handFx[hand] = null;
    if (this.hands[hand]) {
      bone.remove(this.hands[hand]);
      this.hands[hand] = null;
    }
    if (modelName) {
      const m = cloneItem(modelName, glow, tint);
      if (modelName.startsWith('bow')) m.rotateY(Math.PI); // (the pack's bow sits in the hand string-out: turned, its string faces the archer)
      bone.add(m);
      this.hands[hand] = m;
      this.handFx[hand] = enchant(m, plus, { center });
    }
  }

  // Armor colours the body (its own material, so the head and limbs keep theirs); null: as it was.
  setBodyTint(hex) {
    const body = Object.values(this.meshes).find((m) => /_Body$/.test(m.name));
    if (!body) return;
    if (!this.bodyMat) {
      this.bodyMat = body.material.clone();
      this.bodyBase = this.bodyMat.color.clone();
      body.material = this.bodyMat;
      this.materials.push(this.bodyMat);
      this.baseEmissive.push(this.bodyMat.emissive.clone());
    }
    this.bodyMat.color.copy(this.bodyBase);
    if (hex !== null && hex !== undefined) this.bodyMat.color.lerp(new THREE.Color(hex), 0.55);
  }

  setMeshVisible(name, visible) {
    if (this.meshes[name]) this.meshes[name].visible = visible;
  }

  // Give the arm/leg meshes their own material that can show gloves and boots (see injectGearTint).
  enableGearTint() {
    if (this.gear !== undefined) return;
    const limbs = Object.values(this.meshes).filter((m) => m.isSkinnedMesh && /_(Arm|Leg)(Left|Right)$/.test(m.name));
    if (!limbs.length) { this.gear = null; return; }
    const uniforms = {
      uBoneTint: { value: Array.from({ length: MAX_BONES }, () => new THREE.Vector2()) },
      uGloveColor: { value: new THREE.Color() },
      uBootColor: { value: new THREE.Color() },
      uGloveMat: { value: new THREE.Vector3() },
      uBootMat: { value: new THREE.Vector3() },
      uGearGlow: { value: new THREE.Color(0xff6a10).multiplyScalar(0.1) },
    };
    const mat = limbs[0].material.clone();
    mat.onBeforeCompile = (shader) => injectGearTint(shader, uniforms);
    for (const m of limbs) m.material = mat;
    this.materials.push(mat);
    this.baseEmissive.push(mat.emissive.clone());
    const bones = limbs[0].skeleton.bones;
    this.gear = { uniforms, boneIndex: (name) => bones.findIndex((b) => b.name === name) };
  }

  // region 'hands' | 'feet'; spec = { color, metal, rough, glow, cover: { hand: 1, lowerarm: 0.7, … } } or null
  setGear(region, spec) {
    if (!this.gear) return;
    const u = this.gear.uniforms;
    const axis = region === 'hands' ? 'x' : 'y';
    for (const v of u.uBoneTint.value) v[axis] = 0;
    if (!spec) return;
    for (const [bone, amount] of Object.entries(spec.cover)) {
      for (const side of ['l', 'r']) {
        const i = this.gear.boneIndex(bone + side); // bone names are sanitized: "hand.l" -> "handl"
        if (i >= 0 && i < MAX_BONES) u.uBoneTint.value[i][axis] = amount;
      }
    }
    (region === 'hands' ? u.uGloveColor : u.uBootColor).value.set(spec.color);
    // No environment map in this world, so real metalness only darkens: keep it low on the model.
    (region === 'hands' ? u.uGloveMat : u.uBootMat).value.set(Math.min(spec.metal ?? 0, 0.2), spec.rough ?? 0.8, spec.glow ?? 0);
  }

  // Make a material glow (e.g. the skeletons' "Glow" eye material); bloom picks it up.
  setGlow(materialName, hex, intensity = 2.5) {
    this.materials.forEach((m, i) => {
      if (m.name !== materialName) return;
      m.emissive.set(hex);
      m.emissiveIntensity = intensity;
      this.baseEmissive[i].copy(m.emissive);
    });
  }

  startSwing(duration, style = 'slash') {
    this.swing = { t: 0, dur: duration, style };
  }

  hitFlash(hex = 0xffffff, amount = 1) {
    this.flash = amount;
    this.flashColor.set(hex);
  }

  // rotate a bone by `angle` around an axis given in character (model) space
  rotateBone(bone, axis, angle) {
    if (!bone || Math.abs(angle) < 1e-4) return;
    this.model.getWorldQuaternion(_qa);
    _axis.copy(axis).applyQuaternion(_qa);
    _qb.setFromAxisAngle(_axis, angle);
    bone.parent.getWorldQuaternion(_qc);
    // local delta = parentWorld^-1 * worldDelta * parentWorld
    const delta = _qa.copy(_qc).invert().multiply(_qb).multiply(_qc);
    bone.quaternion.premultiply(delta);
    bone.updateMatrixWorld(true);
  }

  // Rotate a bone by a rotation given in world space.
  rotateBoneQ(bone, q) {
    if (!bone) return;
    bone.parent.getWorldQuaternion(_qc);
    bone.quaternion.premultiply(_qa.copy(_qc).invert().multiply(q).multiply(_qc));
    bone.updateMatrixWorld(true);
  }

  // A bow at full draw, worked out from where the bones are (so any model and base animation fits), blended in
  // by w: the bow arm swung onto the line straight ahead at shoulder height, the bow rolled upright about it,
  // the string hand brought to the cheek (and, as loose goes to 1, flicked back from it).
  aimBow(w, loose = 0) {
    const b = this.bones;
    if (!b.upperarml || !b.handl || !b.upperarmr || !b.handr || !b.head) return;
    this.model.updateMatrixWorld(true);
    const fwd = _f.set(0, 0, 1).applyQuaternion(this.model.getWorldQuaternion(_qb));
    fwd.y = 0;
    fwd.normalize();
    const [ls, lh, d1, d2, d3, rs, rh, head] = _v;
    // the bow arm, at the target
    b.upperarml.getWorldPosition(ls);
    b.handl.getWorldPosition(lh);
    _q1.setFromUnitVectors(d1.copy(lh).sub(ls).normalize(), fwd);
    this.rotateBoneQ(b.upperarml, _q2.identity().slerp(_q1, w));
    // the bow upright: its long side turned straight up at the wrist (the least turn, so it keeps its string side)
    const bow = this.hands.l;
    if (bow) {
      bow.updateMatrixWorld(true);
      _q1.setFromUnitVectors(d1.set(0, 1, 0).transformDirection(bow.matrixWorld), UP);
      this.rotateBoneQ(b.wristl, _q2.identity().slerp(_q1, w));
      // …and turned about the upright so its string is behind the grip, toward the archer
      const side = bow.userData.stringSide ||= stringSideOf(bow);
      d1.copy(side).transformDirection(bow.matrixWorld);
      d1.y = 0;
      if (d1.lengthSq() > 1e-6) {
        d1.normalize();
        d2.copy(fwd).negate();
        let ang = Math.acos(Math.max(-1, Math.min(1, d1.dot(d2))));
        if (d3.crossVectors(d1, d2).y < 0) ang = -ang;
        this.rotateBoneQ(b.wristl, _q1.setFromAxisAngle(UP, ang * w));
      }
    }
    // the string hand, at the cheek (a little out and back once loosed)
    b.upperarmr.getWorldPosition(rs);
    b.handr.getWorldPosition(rh);
    b.head.getWorldPosition(head);
    const right = d3.copy(rs).sub(ls).normalize();
    head.addScaledVector(fwd, 0.25 - 0.3 * loose).addScaledVector(right, 0.28 + 0.12 * loose);
    head.y -= 0.12;
    _q1.setFromUnitVectors(d1.copy(rh).sub(rs).normalize(), d2.copy(head).sub(rs).normalize());
    this.rotateBoneQ(b.upperarmr, _q2.identity().slerp(_q1, w));
  }

  applyProcedural() {
    const b = this.bones;
    if (this.swing) {
      const s = SWINGS[this.swing.style] || SWINGS.slash;
      const p = Math.min(1, this.swing.t / this.swing.dur);
      const twist = keyed(s.twist, p), fwd = keyed(s.fwd || NO_KEYS, p), side = keyed(s.side || NO_KEYS, p), lean = keyed(s.lean, p);
      const wrist = keyed(s.wrist || NO_KEYS, p), roll = keyed(s.roll || NO_KEYS, p), lfwd = keyed(s.lfwd || NO_KEYS, p);
      const lside = keyed(s.lside || NO_KEYS, p), lroll = keyed(s.lroll || NO_KEYS, p), elbow = keyed(s.elbow || NO_KEYS, p);
      this.model.updateMatrixWorld(true);
      this.rotateBone(b.spine, AX, lean);
      this.rotateBone(b.spine, AY, twist * 0.45);
      this.rotateBone(b.chest, AY, twist * 0.55);
      this.rotateBone(b.head, AY, -twist * 0.75); // keep eyes on the target
      this.rotateBone(b.upperarmr, AZ, -side * this.sideSign);
      this.rotateBone(b.upperarmr, AX, fwd);
      this.rotateBone(b.wristr, AX, wrist);
      this.rotateBone(b.wristr, AZ, roll);
      this.rotateBone(b.upperarml, AX, lfwd);
      this.rotateBone(b.upperarml, AZ, lside * this.sideSign);
      this.rotateBone(b.wristl, AZ, lroll);
      this.rotateBone(b.lowerarmr, AX, -elbow);
      if (s.aim) { const w = keyed(s.aim, p); if (w > 0.001) this.aimBow(w, keyed(s.loose || NO_KEYS, p)); }
    }
    if (this.armsOut > 0.01) {
      this.model.updateMatrixWorld(true);
      this.rotateBone(b.upperarmr, AZ, -1.25 * this.armsOut * this.sideSign);
      this.rotateBone(b.upperarmr, AX, -0.5 * this.armsOut);
      this.rotateBone(b.upperarml, AZ, 1.25 * this.armsOut * this.sideSign);
    }
  }

  update(dt) {
    this.anim.update(dt);
    if (this.handFx) for (const fx of Object.values(this.handFx)) fx?.update(dt);
    if (this.swing) {
      this.swing.t += dt;
      this.applyProcedural();
      if (this.swing.t >= this.swing.dur) this.swing = null;
    } else if (this.armsOut > 0.01) {
      this.applyProcedural();
    }
    if (this.flash > 0 || this.highlight > 0 || this.frost > 0 || this._lit) {
      this.flash = Math.max(0, this.flash - dt * 6);
      const f = easeOutCubic(this.flash);
      _flash.copy(this.flashColor).multiplyScalar(f * 0.9);
      this.materials.forEach((m, i) => {
        m.emissive.copy(this.baseEmissive[i]).add(_flash);
        m.emissive.r += this.highlight * 0.18;
        m.emissive.g += this.highlight * 0.05 + this.frost * 0.16;
        m.emissive.b += this.frost * 0.42;
      });
      this._lit = this.flash > 0 || this.highlight > 0 || this.frost > 0;
    }
  }
}
