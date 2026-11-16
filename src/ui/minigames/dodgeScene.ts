/**
 * Hindari Rintangan 3D view (three.js, render only). It owns its OWN WebGLRenderer and canvas
 * inside the minigame overlay, separate from the race Stage, and releases every GPU resource
 * in dispose(). All positions are derived from game time (distance = speed x time); no
 * collision happens here, that is the pure logic's job.
 *
 * Low-poly and cheap for phones: Lambert materials, flat shading, no shadow maps (blob
 * shadows), instanced road dashes and scenery, shared geometries, pixel ratio capped.
 */
import * as THREE from 'three';
import type { DodgeLevel, DodgeState, Lane } from '../../logic';

export const LANE_WIDTH = 1.5;
const MAX_PIXEL_RATIO = 1.5;
const SCENERY_COUNT = 10;
const SCENERY_SPAN = 60;
const DASH_COUNT = 14;
const DASH_SPACING = 4;
const OBSTACLE_COLORS = [0xff6b6b, 0xffd166, 0x4cc9f0, 0x9b5de5, 0xf15bb5, 0x06d6a0];

export interface DodgeSceneOptions {
  sky: string;
  ground: string;
  road: number;
  /** Prop ids of the map, in map order (shape and colour are picked from the index). */
  props: readonly string[];
  reducedMotion: boolean;
}

export interface DodgeFrame {
  tMs: number;
  state: DodgeState;
}

const wrap = (v: number, span: number): number => ((v % span) + span) % span;
const easeOut = (x: number): number => 1 - (1 - x) * (1 - x);

/** Visual lane position (in lane units) at time t: eased tween of the last move. */
export function pawnLaneX(level: DodgeLevel, state: DodgeState, tMs: number): number {
  const m = state.moves[state.moves.length - 1];
  if (!m) return 0;
  const k = Math.min(1, Math.max(0, (tMs - m.inputMs) / level.laneChangeMs));
  return m.from + (m.to - m.from) * easeOut(k);
}

export class DodgeScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80);
  private readonly resizeObserver: ResizeObserver;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly obstacleMeshes: THREE.Object3D[][] = [];
  private readonly hintMeshes: THREE.Object3D[][] = [];
  private readonly pawn = new THREE.Group();
  private readonly pawnMat: THREE.MeshLambertMaterial;
  private readonly feet: THREE.Mesh[] = [];
  private readonly dashes: THREE.InstancedMesh;
  private readonly treeTrunks: THREE.InstancedMesh;
  private readonly treeTops: THREE.InstancedMesh;
  private readonly tmp = new THREE.Object3D();
  private disposed = false;
  /** Shake amount 0..1, decays in render(); set by hit(). */
  private shake = 0;
  private flash = 0;
  private lastT = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly level: DodgeLevel,
    private readonly opts: DodgeSceneOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.domElement.className = 'dodge-canvas';
    this.renderer.domElement.dataset.testid = 'mg-canvas';
    container.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(opts.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, level.visibleDistanceM * 0.5, level.visibleDistanceM);
    this.camera.far = level.visibleDistanceM + 10;

    // Light: bright hemisphere fill + one directional key (no shadow maps; blob shadows instead).
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xbfd8ff, 2.0));
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.position.set(-4, 9, 5);
    this.scene.add(sun);

    // Ground and road.
    const road = this.track(new THREE.MeshLambertMaterial({ color: opts.road }));
    const side = this.track(new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.ground) }));
    const planeGeo = this.track(new THREE.PlaneGeometry(1, 1));
    const roadMesh = new THREE.Mesh(planeGeo, road);
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.scale.set(LANE_WIDTH * 3 + 0.3, 140, 1);
    roadMesh.position.z = -50;
    const groundMesh = new THREE.Mesh(planeGeo, side);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.scale.set(60, 140, 1);
    groundMesh.position.set(0, -0.02, -50);
    this.scene.add(groundMesh, roadMesh);

    // Lane dashes (2 lines), one instanced draw call.
    const dashGeo = this.track(new THREE.PlaneGeometry(0.1, 1.4));
    const dashMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.dashes = new THREE.InstancedMesh(dashGeo, dashMat, DASH_COUNT * 2);
    this.dashes.frustumCulled = false;
    this.scene.add(this.dashes);

    // Roadside trees, two instanced meshes.
    const trunkGeo = this.track(new THREE.CylinderGeometry(0.12, 0.16, 0.7, 6));
    const topGeo = this.track(new THREE.ConeGeometry(0.6, 1.3, 7));
    const trunkMat = this.track(new THREE.MeshLambertMaterial({ color: 0x9c6b3f, flatShading: true }));
    const topMat = this.track(new THREE.MeshLambertMaterial({ color: 0x4caf6f, flatShading: true }));
    this.treeTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, SCENERY_COUNT * 2);
    this.treeTops = new THREE.InstancedMesh(topGeo, topMat, SCENERY_COUNT * 2);
    this.treeTrunks.frustumCulled = false;
    this.treeTops.frustumCulled = false;
    this.scene.add(this.treeTrunks, this.treeTops);

    // Obstacle shapes by prop index: shared geometry + material per prop id.
    const shapes: THREE.BufferGeometry[] = [
      new THREE.BoxGeometry(1.0, 0.9, 1.0),
      new THREE.CylinderGeometry(0.5, 0.5, 1.1, 8),
      new THREE.ConeGeometry(0.55, 1.3, 7),
      new THREE.DodecahedronGeometry(0.58),
      new THREE.OctahedronGeometry(0.65),
      new THREE.TorusKnotGeometry(0.34, 0.14, 24, 6),
    ].map((g) => this.track(g));
    const heights = [0.9, 1.1, 1.3, 1.16, 1.3, 1.0];
    const blobGeo = this.track(new THREE.CircleGeometry(0.62, 12));
    const blobMat = this.track(new THREE.MeshBasicMaterial({ color: 0x23324a, transparent: true, opacity: 0.18, depthWrite: false }));
    const propMats = opts.props.map((_, i) => this.track(new THREE.MeshLambertMaterial({
      color: OBSTACLE_COLORS[i % OBSTACLE_COLORS.length] as number, flatShading: true,
    })));
    const hintGeo = this.track(new THREE.PlaneGeometry(LANE_WIDTH * 0.9, 1.4));
    const hintMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.35, depthWrite: false }));

    for (const row of level.rows) {
      const meshes: THREE.Object3D[] = [];
      const hints: THREE.Object3D[] = [];
      row.blocked.forEach((lane, i) => {
        const propIndex = Math.max(0, opts.props.indexOf(row.props[i] as string));
        const si = propIndex % shapes.length;
        const o = new THREE.Group();
        const body = new THREE.Mesh(shapes[si] as THREE.BufferGeometry, propMats[propIndex] ?? propMats[0]);
        body.position.y = (heights[si] as number) / 2 + 0.02;
        const blob = new THREE.Mesh(blobGeo, blobMat);
        blob.rotation.x = -Math.PI / 2;
        blob.position.y = 0.01;
        o.add(blob, body);
        o.position.x = lane * LANE_WIDTH;
        o.visible = false;
        this.scene.add(o);
        meshes.push(o);
        const h = new THREE.Mesh(hintGeo, hintMat);
        h.rotation.x = -Math.PI / 2;
        h.position.set(lane * LANE_WIDTH, 0.03, 0);
        h.visible = false;
        this.scene.add(h);
        hints.push(h);
      });
      this.obstacleMeshes.push(meshes);
      this.hintMeshes.push(hints);
    }

    // The pawn: a round chibi with big eyes and bouncing feet.
    this.pawnMat = this.track(new THREE.MeshLambertMaterial({ color: 0xff4d6d, flatShading: true }));
    const bodyGeo = this.track(new THREE.SphereGeometry(0.4, 12, 10));
    const eyeGeo = this.track(new THREE.SphereGeometry(0.07, 8, 6));
    const footGeo = this.track(new THREE.SphereGeometry(0.13, 8, 6));
    const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: 0x23324a }));
    const footMat = this.track(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const body = new THREE.Mesh(bodyGeo, this.pawnMat);
    body.scale.set(1, 1.1, 1);
    body.position.y = 0.55;
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.15, 0.7, -0.34);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.15, 0.7, -0.34);
    const footL = new THREE.Mesh(footGeo, footMat);
    const footR = new THREE.Mesh(footGeo, footMat);
    this.feet.push(footL, footR);
    const pawnBlob = new THREE.Mesh(blobGeo, blobMat);
    pawnBlob.rotation.x = -Math.PI / 2;
    pawnBlob.position.y = 0.01;
    this.pawn.add(body, eyeL, eyeR, footL, footR, pawnBlob);
    this.scene.add(this.pawn);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.update({ tMs: 0, state: { tMs: 0, lives: level.lives, targetLane: 0 as Lane, moves: [], nextRow: 0, iFrameUntilMs: 0, hits: [], dodged: 0, result: null } });
  }

  /** Visual hit feedback: pawn flash + camera shake (shake skipped with reducedMotion). */
  hit(): void {
    this.flash = 1;
    if (!this.opts.reducedMotion) this.shake = 1;
  }

  update(frame: DodgeFrame): void {
    if (this.disposed) return;
    const { tMs, state } = frame;
    const dt = Math.max(0, tMs - this.lastT) / 1000;
    this.lastT = tMs;
    const lvl = this.level;
    const mps = lvl.speedMps;
    const scroll = (mps * tMs) / 1000;

    // Obstacles and hint shadows from time: distance ahead = speed x time.
    const hintDist = (mps * lvl.hintLeadMs) / 1000;
    lvl.rows.forEach((row, i) => {
      const dist = (mps * (row.tHitMs - tMs)) / 1000;
      const z = -dist;
      const show = dist < lvl.visibleDistanceM && dist > -6;
      for (const o of this.obstacleMeshes[i] ?? []) {
        o.visible = show;
        o.position.z = z;
        o.rotation.y = Math.sin((tMs + i * 300) / 400) * 0.25;
      }
      const showHint = hintDist > 0 && dist >= lvl.visibleDistanceM - 0.01 && dist < lvl.visibleDistanceM + hintDist;
      for (const h of this.hintMeshes[i] ?? []) {
        h.visible = showHint;
        h.position.z = z;
      }
    });

    // Pawn.
    const x = pawnLaneX(lvl, state, tMs) * LANE_WIDTH;
    this.pawn.position.x = x;
    const phase = tMs / 90;
    this.pawn.position.y = Math.abs(Math.sin(phase)) * 0.12;
    this.feet.forEach((f, i) => {
      f.position.set(i === 0 ? -0.18 : 0.18, 0.12 + Math.max(0, Math.sin(phase + i * Math.PI)) * 0.18, -0.05);
    });
    this.pawn.rotation.z = -(x - pawnLaneX(lvl, state, tMs - 40) * LANE_WIDTH) * 0.6; // lean into the move
    const invincible = tMs < state.iFrameUntilMs && state.lives > 0;
    this.pawn.visible = !(invincible && Math.floor(tMs / 90) % 2 === 1);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.pawnMat.emissive.setRGB(this.flash * 0.9, this.flash * 0.1, this.flash * 0.1);

    // Road dashes and trees scroll with the ground.
    const span = DASH_COUNT * DASH_SPACING;
    for (let i = 0; i < DASH_COUNT; i++) {
      const z = DASH_SPACING * 2 - wrap(i * DASH_SPACING - scroll, span);
      for (let l = 0; l < 2; l++) {
        this.tmp.position.set((l === 0 ? -0.5 : 0.5) * LANE_WIDTH * 1, 0.025, z);
        this.tmp.rotation.set(-Math.PI / 2, 0, 0);
        this.tmp.updateMatrix();
        this.dashes.setMatrixAt(i * 2 + l, this.tmp.matrix);
      }
    }
    this.dashes.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < SCENERY_COUNT; i++) {
      for (let s = 0; s < 2; s++) {
        const z = 6 - wrap(i * (SCENERY_SPAN / SCENERY_COUNT) + (s ? 3 : 0) - scroll, SCENERY_SPAN);
        const sx = (s === 0 ? -1 : 1) * (LANE_WIDTH * 2.6 + ((i * 7) % 3) * 0.7);
        this.tmp.rotation.set(0, 0, 0);
        this.tmp.scale.set(1, 1, 1);
        this.tmp.position.set(sx, 0.35, z);
        this.tmp.updateMatrix();
        this.treeTrunks.setMatrixAt(i * 2 + s, this.tmp.matrix);
        this.tmp.position.set(sx, 1.2, z);
        this.tmp.scale.setScalar(0.8 + ((i * 5) % 4) * 0.12);
        this.tmp.updateMatrix();
        this.treeTops.setMatrixAt(i * 2 + s, this.tmp.matrix);
      }
    }
    this.tmp.scale.set(1, 1, 1);
    this.treeTrunks.instanceMatrix.needsUpdate = true;
    this.treeTops.instanceMatrix.needsUpdate = true;

    // Camera: behind and above (about 30 degrees), follows the pawn a little.
    this.shake = Math.max(0, this.shake - dt * 1.2 * 3);
    const sh = this.shake * Math.sin(tMs * 0.09) * 0.18;
    this.camera.position.set(x * 0.4 + sh, 4.0, 6.4);
    this.camera.lookAt(x * 0.25, 0.5, -6);

    this.renderer.render(this.scene, this.camera);
  }

  /** Debug/QA info about the GPU side. */
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
      if (m.isMesh) {
        m.geometry.dispose();
        for (const mat of [m.material].flat()) mat.dispose();
      }
    });
    for (const d of this.disposables) d.dispose();
    this.dashes.dispose();
    this.treeTrunks.dispose();
    this.treeTops.dispose();
    this.scene.clear();
    this.renderer.dispose();
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
    // Portrait phones: widen the vertical FOV so all three lanes stay in view.
    this.camera.fov = w / h < 0.8 ? 70 : 55;
    this.camera.updateProjectionMatrix();
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  }
}
