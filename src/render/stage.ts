/**
 * Renderer, isometric orthographic camera, lights, resize and the frame loop.
 * One WebGLRenderer, driven only by setAnimationLoop.
 */
import * as THREE from 'three';
import { SKY_COLOR } from './palette';

export type FrameCallback = (dtSeconds: number) => void;

/** Max device pixel ratio: phones at 3x would draw 9x the pixels of 1x. */
const MAX_PIXEL_RATIO = 1.5;
/** True isometric: 45 deg yaw, atan(1/sqrt(2)) ~ 35.26 deg pitch. */
const ISO_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();
const CAMERA_DISTANCE = 40;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  readonly sun: THREE.DirectionalLight;

  private readonly timer = new THREE.Timer();
  private readonly frameCallbacks: FrameCallback[] = [];
  private fitBox = new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 1, 5));
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // soft since r182
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY_COLOR);

    // Bright, soft fill + one shadow-casting key light.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9ccfe0, 1.6));
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.timer.connect(document);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Frame the given world box (e.g. the board) and fit the sun's shadow camera to it. */
  setFitBox(box: THREE.Box3): void {
    this.fitBox = box.clone();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.6 + 1;

    this.camera.position.copy(center).addScaledVector(ISO_DIRECTION, CAMERA_DISTANCE);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld();

    this.sun.position.copy(center).add(new THREE.Vector3(-6, 14, 8));
    this.sun.target.position.copy(center);
    const sc = this.sun.shadow.camera;
    sc.left = -radius;
    sc.right = radius;
    sc.top = radius;
    sc.bottom = -radius;
    sc.near = 1;
    sc.far = 40;
    sc.updateProjectionMatrix();
    this.updateProjection();
  }

  onFrame(cb: FrameCallback): void {
    this.frameCallbacks.push(cb);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => {
      this.timer.update(); // no timestamp argument: avoids negative delta after tab hide (r186/r187)
      const dt = Math.min(Math.max(this.timer.getDelta(), 0), 0.1);
      for (const cb of this.frameCallbacks) cb(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.timer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false); // CSS controls the element size
    this.updateProjection();
  }

  /** Fit the ortho frustum around fitBox as seen from the iso camera, for any aspect ratio. */
  private updateProjection(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const aspect = w / h;

    this.camera.updateMatrixWorld();
    const inv = this.camera.matrixWorldInverse;
    const { min, max } = this.fitBox;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const p = new THREE.Vector3();
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      p.set(x, y, z).applyMatrix4(inv);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const margin = 1.12;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let halfW = ((maxX - minX) / 2) * margin;
    let halfH = ((maxY - minY) / 2) * margin;
    // Leave room for the HUD bars at the top and bottom.
    halfH *= 1.25;
    if (halfW / halfH > aspect) halfH = halfW / aspect;
    else halfW = halfH * aspect;

    this.camera.left = cx - halfW;
    this.camera.right = cx + halfW;
    this.camera.top = cy + halfH;
    this.camera.bottom = cy - halfH;
    this.camera.updateProjectionMatrix();
  }
}
