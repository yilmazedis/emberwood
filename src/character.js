// A KayKit humanoid: model + animator + hand-slot equipment + procedural melee swings.
// The free pack ships without attack clips, so swings are layered on top of the playing
// animation by rotating the spine/arm bones in character space after the mixer runs.
import * as THREE from 'three';
import { cloneCharacter, cloneItem } from './assets.js';
import { Animator } from './animator.js';
import { lerp, easeOutCubic, easeInOut } from './util.js';

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _flash = new THREE.Color();

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
const SWINGS = {
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

export class Humanoid {
  constructor(charName, { scale = 1, tint = null } = {}) {
    const c = cloneCharacter(charName);
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
    this.armsOut = 0; // whirlwind pose weight
    this.sideSign = 1; // flipped at runtime if the rig's right arm is mirrored
  }

  get position() {
    return this.group.position;
  }

  equip(hand, modelName, glow = null) {
    const bone = this.bones[hand === 'r' ? 'handslotr' : 'handslotl'];
    if (this.hands[hand]) {
      bone.remove(this.hands[hand]);
      this.hands[hand] = null;
    }
    if (modelName) {
      const m = cloneItem(modelName, glow);
      bone.add(m);
      this.hands[hand] = m;
    }
  }

  setMeshVisible(name, visible) {
    if (this.meshes[name]) this.meshes[name].visible = visible;
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

  applyProcedural() {
    const b = this.bones;
    if (this.swing) {
      const s = SWINGS[this.swing.style] || SWINGS.slash;
      const p = Math.min(1, this.swing.t / this.swing.dur);
      const twist = keyed(s.twist, p), fwd = keyed(s.fwd, p), side = keyed(s.side, p), lean = keyed(s.lean, p);
      const wrist = keyed(s.wrist, p), roll = keyed(s.roll || NO_KEYS, p);
      this.model.updateMatrixWorld(true);
      this.rotateBone(b.spine, AX, lean);
      this.rotateBone(b.spine, AY, twist * 0.45);
      this.rotateBone(b.chest, AY, twist * 0.55);
      this.rotateBone(b.head, AY, -twist * 0.75); // keep eyes on the target
      this.rotateBone(b.upperarmr, AZ, -side * this.sideSign);
      this.rotateBone(b.upperarmr, AX, fwd);
      this.rotateBone(b.wristr, AX, wrist);
      this.rotateBone(b.wristr, AZ, roll);
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
    if (this.swing) {
      this.swing.t += dt;
      this.applyProcedural();
      if (this.swing.t >= this.swing.dur) this.swing = null;
    } else if (this.armsOut > 0.01) {
      this.applyProcedural();
    }
    if (this.flash > 0 || this.highlight > 0 || this._lit) {
      this.flash = Math.max(0, this.flash - dt * 6);
      const f = easeOutCubic(this.flash);
      _flash.copy(this.flashColor).multiplyScalar(f * 0.9);
      this.materials.forEach((m, i) => {
        m.emissive.copy(this.baseEmissive[i]).add(_flash);
        m.emissive.r += this.highlight * 0.18;
        m.emissive.g += this.highlight * 0.05;
      });
      this._lit = this.flash > 0 || this.highlight > 0;
    }
  }
}
