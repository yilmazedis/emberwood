// Live 3D "paper doll" in the character panel, mirroring the player's equipment.
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { applyEquipmentVisuals } from './player.js';
import { CLASSES } from './classes.js';

export class Doll {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || 180, canvas.clientHeight || 220, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff2e0, 0x3a2a1a, 2.0));
    const key = new THREE.DirectionalLight(0xffe2b8, 2.6);
    key.position.set(2, 4, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb6ff, 1.6);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    this.camera = new THREE.PerspectiveCamera(30, 180 / 220, 0.1, 50);
    this.camera.position.set(0, 1.45, 5.6);
    this.camera.lookAt(0, 1.15, 0);
    this.model = null;
    this.setClass('knight');
    this.visible = false;
    this.t = 0;
    this.drag = null;
    this.spin = 0.5;
    canvas.addEventListener('pointerdown', (e) => { this.drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag === null) return;
      this.spin += (e.clientX - this.drag) * 0.015;
      this.drag = e.clientX;
    });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
  }

  setClass(cls) {
    const model = CLASSES[cls].model;
    if (model === this.model) return;
    if (this.h) this.scene.remove(this.h.group);
    this.model = model;
    this.h = new Humanoid(model);
    this.scene.add(this.h.group);
  }

  setEquipment(eq, cls = 'knight') {
    this.setClass(cls);
    applyEquipmentVisuals(this.h, eq, cls);
  }

  update(dt) {
    if (!this.visible) return;
    this.t += dt;
    if (this.drag === null) this.spin += dt * 0.35;
    this.h.group.rotation.y = this.spin;
    this.h.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
