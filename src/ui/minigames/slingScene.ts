/**
 * Ketapel 3D view (three.js, render only). Like the Hindari Rintangan scene it owns its OWN
 * WebGLRenderer + canvas inside the minigame overlay and frees everything in dispose().
 *
 * Coordinates: the logic uses x right, y up, z away from the shooter; three.js looks down -z, so
 * a logic point (x, y, z) is drawn at (x, y, -z). Nothing here decides a hit: bullets follow the
 * same closed-form parabola as the logic, and a target's fall is a scripted tween started at the
 * landing time the logic reports.
 *
 * Props are procedural low-poly (menara balok, atap genteng, pohon kelapa; kelapa/kendi/layangan
 * for targets), few draw calls, Lambert + flat shading, no shadow maps (CP6 swaps in final art).
 */
import * as THREE from 'three';
import {
  groundTimeSec,
  shotPosition,
  simulateShot,
  SLING_BULLET_R,
  SLING_SHOOTER,
  targetOffsetX,
  type SlingAim,
  type SlingLevel,
  type SlingState,
} from '../../logic';

const MAX_PIXEL_RATIO = 1.5;
const TARGET_R = 0.55;
const AIM_POINTS = 48;
const TRAIL_COUNT = 10;
const FALL_PUSH_M = 1.4;
const BOUNCE_M = 0.12;
const LANDING_MARK_MS = 700;

export interface SlingSceneOptions {
  sky: string;
  ground: string;
  reducedMotion: boolean;
}

export interface SlingFrame {
  tMs: number;
  state: SlingState;
  /** Aim to preview (drag or keyboard); null hides the aim line. */
  aim: SlingAim | null;
}

interface TargetObj {
  group: THREE.Group;
  /** The sphere/jug/kite part that tilts and falls. */
  body: THREE.Object3D;
  /** The platform part that disappears when the target is hit. */
  top: THREE.Object3D;
  baseY: number;
}

const easeIn = (x: number): number => x * x;

export class SlingScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 140);
  private readonly resizeObserver: ResizeObserver;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly targets: TargetObj[] = [];
  private readonly bullet: THREE.Mesh;
  private readonly trail: THREE.InstancedMesh;
  private readonly aimLine: THREE.Line;
  private readonly aimMat: THREE.LineDashedMaterial;
  private readonly band: THREE.Line;
  private readonly bandPos: THREE.BufferAttribute;
  private readonly landing: THREE.Mesh;
  private readonly tmp = new THREE.Object3D();
  private disposed = false;
  private lastLanded = 0;
  private landingAt = -1e9;
  /** GPU counters read right after the last dispose (QA: they must be back to 0). */
  static lastDisposedStats: { geometries: number; textures: number; calls: number } | null = null;
  /** Aim-line colour: true while the hint says the current aim hits (green). */
  hitPreview = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly level: SlingLevel,
    private readonly opts: SlingSceneOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.domElement.className = 'sling-canvas';
    this.renderer.domElement.dataset.testid = 'mg-canvas';
    container.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(opts.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 40, 90);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xbfd8ff, 2.0));
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.position.set(-6, 12, 8);
    this.scene.add(sun);

    // Ground, plus a few instanced trees on the sides so the field has depth.
    const groundGeo = this.track(new THREE.PlaneGeometry(1, 1));
    const groundMat = this.track(new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.ground) }));
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.scale.set(120, 140, 1);
    ground.position.set(0, -0.02, -40);
    this.scene.add(ground);
    const trunkGeo = this.track(new THREE.CylinderGeometry(0.15, 0.2, 1.0, 6));
    const topGeo = this.track(new THREE.ConeGeometry(0.9, 2.0, 7));
    const trunkMat = this.track(new THREE.MeshLambertMaterial({ color: 0x9c6b3f, flatShading: true }));
    const topMat = this.track(new THREE.MeshLambertMaterial({ color: 0x4caf6f, flatShading: true }));
    const trees = 14;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees);
    const tops = new THREE.InstancedMesh(topGeo, topMat, trees);
    for (let i = 0; i < trees; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (11 + ((i * 7) % 5) * 1.6);
      const z = -6 - ((i * 13) % 9) * 4.2;
      this.tmp.position.set(x, 0.5, z);
      this.tmp.scale.set(1, 1, 1);
      this.tmp.updateMatrix();
      trunks.setMatrixAt(i, this.tmp.matrix);
      this.tmp.position.set(x, 1.9, z);
      this.tmp.scale.setScalar(0.9 + ((i * 5) % 4) * 0.15);
      this.tmp.updateMatrix();
      tops.setMatrixAt(i, this.tmp.matrix);
    }
    trunks.frustumCulled = false;
    tops.frustumCulled = false;
    this.disposables.push(trunks, tops);
    this.scene.add(trunks, tops);

    // Targets and their platforms.
    this.buildTargets();

    // Slingshot (a Y of two prongs) and the band to the pouch.
    const woodMat = this.track(new THREE.MeshLambertMaterial({ color: 0x8d5a3b, flatShading: true }));
    const handleGeo = this.track(new THREE.CylinderGeometry(0.1, 0.13, 1.1, 6));
    const prongGeo = this.track(new THREE.CylinderGeometry(0.07, 0.1, 0.8, 6));
    const handle = new THREE.Mesh(handleGeo, woodMat);
    handle.position.set(0, 0.55, 0);
    const prongL = new THREE.Mesh(prongGeo, woodMat);
    prongL.position.set(-0.3, 1.3, 0);
    prongL.rotation.z = 0.4;
    const prongR = new THREE.Mesh(prongGeo, woodMat);
    prongR.position.set(0.3, 1.3, 0);
    prongR.rotation.z = -0.4;
    this.scene.add(handle, prongL, prongR);
    this.bandPos = new THREE.BufferAttribute(new Float32Array(9), 3);
    const bandGeo = this.track(new THREE.BufferGeometry());
    bandGeo.setAttribute('position', this.bandPos);
    this.band = new THREE.Line(bandGeo, this.track(new THREE.LineBasicMaterial({ color: 0x3a2a1c })));
    this.band.frustumCulled = false;
    this.scene.add(this.band);

    // Bullet, trail and the landing mark.
    const bulletGeo = this.track(new THREE.SphereGeometry(SLING_BULLET_R * 1.3, 10, 8));
    this.bullet = new THREE.Mesh(bulletGeo, this.track(new THREE.MeshLambertMaterial({ color: 0x23324a, flatShading: true })));
    this.scene.add(this.bullet);
    this.trail = new THREE.InstancedMesh(
      this.track(new THREE.SphereGeometry(SLING_BULLET_R * 0.8, 6, 5)),
      this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })),
      TRAIL_COUNT,
    );
    this.trail.frustumCulled = false;
    this.disposables.push(this.trail);
    this.scene.add(this.trail);
    this.landing = new THREE.Mesh(
      this.track(new THREE.CircleGeometry(0.5, 12)),
      this.track(new THREE.MeshBasicMaterial({ color: 0x23324a, transparent: true, opacity: 0.35, depthWrite: false })),
    );
    this.landing.rotation.x = -Math.PI / 2;
    this.landing.visible = false;
    this.scene.add(this.landing);

    // Aim line: dashed (readable without colour), green with the hint card when it would hit.
    const aimGeo = this.track(new THREE.BufferGeometry());
    aimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AIM_POINTS * 3), 3));
    this.aimMat = this.track(new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.5, gapSize: 0.35 }));
    this.aimLine = new THREE.Line(aimGeo, this.aimMat);
    this.aimLine.frustumCulled = false;
    this.aimLine.visible = false;
    this.scene.add(this.aimLine);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private buildTargets(): void {
    const { level } = this;
    const mats = {
      wood: this.track(new THREE.MeshLambertMaterial({ color: 0x8d5a3b, flatShading: true })),
      brick: [0xe76f51, 0xf4a261, 0xe9c46a].map((c) => this.track(new THREE.MeshLambertMaterial({ color: c, flatShading: true }))),
      clay: this.track(new THREE.MeshLambertMaterial({ color: 0xc8553d, flatShading: true })),
      leaf: this.track(new THREE.MeshLambertMaterial({ color: 0x3fa66b, flatShading: true })),
      coconut: this.track(new THREE.MeshLambertMaterial({ color: 0x7a4a2b, flatShading: true })),
      dark: this.track(new THREE.MeshLambertMaterial({ color: 0x2b1b12, flatShading: true })),
      jug: this.track(new THREE.MeshLambertMaterial({ color: 0xd9822b, flatShading: true })),
      kite: this.track(new THREE.MeshLambertMaterial({ color: 0xff5a5f, flatShading: true, side: THREE.DoubleSide })),
      kite2: this.track(new THREE.MeshLambertMaterial({ color: 0xffd23f, flatShading: true, side: THREE.DoubleSide })),
    };
    const g = {
      box: this.track(new THREE.BoxGeometry(1, 1, 1)),
      pole: this.track(new THREE.CylinderGeometry(0.09, 0.12, 1, 6)),
      trunk: this.track(new THREE.CylinderGeometry(0.16, 0.26, 1, 7)),
      roof: this.track(new THREE.ConeGeometry(0.95, 0.5, 4)),
      leaf: this.track(new THREE.ConeGeometry(0.3, 1.5, 4)),
      coco: this.track(new THREE.IcosahedronGeometry(TARGET_R, 0)),
      dot: this.track(new THREE.SphereGeometry(0.07, 5, 4)),
      jugBody: this.track(new THREE.SphereGeometry(TARGET_R * 0.9, 9, 7)),
      jugNeck: this.track(new THREE.CylinderGeometry(0.16, 0.22, 0.4, 7)),
      kite: this.track(new THREE.OctahedronGeometry(TARGET_R * 1.1)),
    };
    const fogMats: THREE.Material[] = [];
    level.targets.forEach((tg, i) => {
      const group = new THREE.Group();
      const baseTop = Math.max(0.6, tg.center.y - TARGET_R); // platform top = where the target sits
      const top = new THREE.Group();
      const body = new THREE.Group();
      const kind = tg.platform % 3;
      if (kind === 0) {
        // menara balok: stacked blocks, the top one is the "top part".
        const n = Math.max(2, Math.round(baseTop / 0.9));
        const h = baseTop / n;
        for (let b = 0; b < n; b++) {
          const m = new THREE.Mesh(g.box, mats.brick[(b + i) % 3]);
          m.scale.set(1.15 - b * 0.02, h * 0.98, 1.15 - b * 0.02);
          m.position.set(((b * 37 + i * 11) % 7 - 3) * 0.015, h * (b + 0.5), 0);
          m.rotation.y = ((b * 53 + i * 17) % 11 - 5) * 0.02;
          (b === n - 1 ? top : group).add(m);
        }
      } else if (kind === 1) {
        // atap genteng: a pole carrying a tile roof.
        const poleH = Math.max(0.3, baseTop - 0.5);
        const pole = new THREE.Mesh(g.pole, mats.wood);
        pole.scale.set(1, poleH, 1);
        pole.position.y = poleH / 2;
        group.add(pole);
        const roof = new THREE.Mesh(g.roof, mats.clay);
        roof.rotation.y = Math.PI / 4;
        roof.position.y = poleH + 0.25;
        top.add(roof);
      } else {
        // pohon kelapa: a tapering trunk with a fan of leaves on top.
        const trunkH = Math.max(0.4, baseTop - 0.1);
        const trunk = new THREE.Mesh(g.trunk, mats.wood);
        trunk.scale.set(1, trunkH, 1);
        trunk.position.y = trunkH / 2;
        group.add(trunk);
        for (let l = 0; l < 5; l++) {
          const leaf = new THREE.Mesh(g.leaf, mats.leaf);
          const a = (l / 5) * Math.PI * 2 + i;
          leaf.position.set(Math.cos(a) * 0.55, trunkH + 0.05, Math.sin(a) * 0.55);
          leaf.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
          top.add(leaf);
        }
      }
      // The target itself, by skin.
      const skin = tg.skin % 3;
      if (skin === 0) {
        body.add(new THREE.Mesh(g.coco, mats.coconut));
        for (const [dx, dy] of [[-0.18, 0.12], [0.1, 0.2], [0, -0.05]] as const) {
          const dot = new THREE.Mesh(g.dot, mats.dark);
          dot.position.set(dx, dy, TARGET_R * 0.88);
          body.add(dot);
        }
      } else if (skin === 1) {
        body.add(new THREE.Mesh(g.jugBody, mats.jug));
        const neck = new THREE.Mesh(g.jugNeck, mats.jug);
        neck.position.y = TARGET_R * 0.95;
        body.add(neck);
      } else {
        const kite = new THREE.Mesh(g.kite, i % 2 === 0 ? mats.kite : mats.kite2);
        kite.scale.set(1, 1.25, 0.28);
        body.add(kite);
      }
      body.position.y = baseTop + TARGET_R;
      group.add(top, body);
      group.position.set(tg.center.x, 0, -tg.center.z);
      // Kabut Asap: far targets are half transparent, but keep an outline.
      if (level.fog && tg.center.z >= level.fogDepthM) {
        const fogMat = this.track(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, flatShading: true }));
        fogMats.push(fogMat);
        body.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.material = fogMat;
            const edges = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(m.geometry)), this.track(new THREE.LineBasicMaterial({ color: 0x23324a })));
            m.add(edges);
          }
        });
      }
      this.scene.add(group);
      this.targets.push({ group, body, top, baseY: body.position.y });
    });
  }

  /** Where the aim line should end for a hit preview etc. is the logic's job; this only draws. */
  update(frame: SlingFrame): void {
    if (this.disposed) return;
    const { tMs, state, aim } = frame;
    const lvl = this.level;

    // Targets: moving ones slide along x (frozen where they were hit), hit ones fall.
    this.targets.forEach((t, i) => {
      const tg = lvl.targets[i] as SlingLevel['targets'][number];
      const dn = state.down.find((d) => d.index === i);
      const at = dn ? dn.atMs : tMs;
      t.group.position.x = tg.center.x + targetOffsetX(lvl, i, at);
      if (!dn) {
        t.body.position.y = t.baseY;
        t.body.rotation.set(0, 0, 0);
        t.body.position.z = 0;
        t.top.visible = true;
        return;
      }
      const k = Math.min(1, Math.max(0, (tMs - dn.atMs) / lvl.fallMs));
      const dir = Math.sign(dn.yawDeg || 1);
      t.top.visible = false;
      const dist = t.baseY - TARGET_R * 0.8; // fall distance to the ground
      const fall = this.opts.reducedMotion ? (k >= 1 ? 1 : 0) : easeIn(k);
      const bounce = k >= 1 ? 0 : k > 0.8 ? Math.sin(((k - 0.8) / 0.2) * Math.PI) * BOUNCE_M : 0;
      t.body.position.y = t.baseY - dist * fall + bounce;
      t.body.position.x = this.opts.reducedMotion ? 0 : dir * FALL_PUSH_M * k;
      t.body.position.z = this.opts.reducedMotion ? 0 : -FALL_PUSH_M * 0.5 * k;
      t.body.rotation.z = this.opts.reducedMotion ? 0 : -dir * (Math.PI / 2) * k;
    });

    // Bullet, trail, band.
    const f = state.flight;
    const pouchPull = aim ? 0.4 + aim.power * 1.0 : 0;
    const home = new THREE.Vector3(SLING_SHOOTER.x, SLING_SHOOTER.y, -SLING_SHOOTER.z);
    if (f) {
      const sec = Math.max(0, (tMs - f.releasedAtMs) / 1000);
      const p = shotPosition(f.aim, lvl.windMps, Math.min(sec, f.flightMs / 1000));
      this.bullet.position.set(p.x, p.y, -p.z);
      this.bullet.visible = true;
      for (let k = 0; k < TRAIL_COUNT; k++) {
        const ts = Math.max(0, sec - (k + 1) * 0.035);
        const q = shotPosition(f.aim, lvl.windMps, ts);
        this.tmp.position.set(q.x, q.y, -q.z);
        this.tmp.scale.setScalar(1 - k / TRAIL_COUNT);
        this.tmp.rotation.set(0, 0, 0);
        this.tmp.updateMatrix();
        this.trail.setMatrixAt(k, this.tmp.matrix);
      }
      this.trail.visible = true;
      this.trail.instanceMatrix.needsUpdate = true;
      this.band.visible = true;
      this.setBand(home.z, 0); // band relaxed after the release
    } else {
      this.trail.visible = false;
      const ready = state.bulletsLeft > 0 && !state.result;
      this.bullet.visible = ready;
      this.bullet.position.set(home.x, home.y, home.z + pouchPull);
      this.band.visible = ready;
      this.setBand(home.z, pouchPull);
    }
    this.tmp.scale.set(1, 1, 1);

    // Landing mark: a dark patch where a missed bullet came down.
    if (state.landed.length > this.lastLanded) {
      const last = state.landed[state.landed.length - 1] as SlingState['landed'][number];
      this.lastLanded = state.landed.length;
      if (last.hitIndex === null) {
        this.landing.position.set(last.impact.x, 0.02, -last.impact.z);
        this.landingAt = tMs;
      }
    }
    const lk = (tMs - this.landingAt) / LANDING_MARK_MS;
    this.landing.visible = lk >= 0 && lk < 1;
    if (this.landing.visible) (this.landing.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - lk);

    // Aim line: the trajectory for the shown aim, `aimLineFrac` of the way to the ground.
    if (aim && !f && state.bulletsLeft > 0) {
      const T = groundTimeSec(aim.power);
      const pos = this.aimLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < AIM_POINTS; k++) {
        const p = shotPosition(aim, lvl.windMps, (k / (AIM_POINTS - 1)) * T * lvl.aimLineFrac);
        pos.setXYZ(k, p.x, p.y, -p.z);
      }
      pos.needsUpdate = true;
      this.aimLine.computeLineDistances();
      this.aimLine.visible = true;
      this.hitPreview = lvl.hitPreview && simulateShot(lvl, aim, tMs, state.down.map((d) => d.index)).hitIndex !== null;
      this.aimMat.color.set(this.hitPreview ? 0x2ecc71 : 0xffffff);
    } else {
      this.aimLine.visible = false;
      this.hitPreview = false;
    }

    // Camera: fixed behind the shooter, slightly above (no shake while aiming).
    this.camera.position.set(0, 3.5, 6.2);
    this.camera.lookAt(0, 3.0, -14);
    this.renderer.render(this.scene, this.camera);
  }

  private setBand(z: number, pull: number): void {
    const a = this.bandPos;
    a.setXYZ(0, -0.52, 1.62, z);
    a.setXYZ(1, 0, SLING_SHOOTER.y, z + pull);
    a.setXYZ(2, 0.52, 1.62, z);
    a.needsUpdate = true;
  }

  stats(): { geometries: number; textures: number; calls: number } {
    const i = this.renderer.info;
    return { geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m.isMesh || (o as THREE.Line).isLine) && m.geometry) {
        m.geometry.dispose();
        for (const mat of [m.material].flat()) mat?.dispose();
      }
    });
    for (const d of this.disposables) d.dispose();
    this.scene.clear();
    this.renderer.dispose();
    SlingScene.lastDisposedStats = this.stats();
    this.renderer.forceContextLoss(); // free the GL context now, not at GC time
    this.renderer.domElement.remove();
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones: widen the vertical FOV so the whole field stays in view.
    this.camera.fov = w / h < 0.8 ? 64 : 46;
    this.camera.updateProjectionMatrix();
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  }
}
