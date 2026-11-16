/**
 * Board view: one low-poly hex tile per region, path strips with direction arrows, and a
 * DOM label per region (name, difficulty stars, FINAL badge). Read-only view of MapGraph;
 * highlights are driven from main.ts.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { localize, regionDifficulty, type Difficulty, type MapGraph } from '../logic';
import {
  DIFFICULTY_TILE_COLORS,
  FALLBACK_SEA,
  FINISH_TILE_COLOR,
  HIGHLIGHT_COLOR,
  PATH_COLOR,
  START_TILE_COLOR,
  TARGET_COLOR,
} from './palette';

const TILE_RADIUS = 0.8;
const TILE_HEIGHT = 0.4;
/** Map board units (0..100 × 0..40) -> world units. */
const BOARD_SCALE = 0.2;
const STARS: Readonly<Record<Difficulty, string>> = { easy: '★', medium: '★★', hard: '★★★' };

interface TileView {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
  label: HTMLElement;
}

export class BoardView {
  readonly root = new THREE.Group();
  /** Meshes the picker raycasts against; each carries userData.regionId. */
  readonly pickables: THREE.Object3D[] = [];
  private readonly tiles = new Map<string, TileView>();
  private readonly positions = new Map<string, THREE.Vector3>();
  private selectable = new Set<string>();
  private targetId: string | null = null;
  private hovered: string | null = null;
  private time = 0;
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLOR });
  private readonly targetRingMat = new THREE.MeshBasicMaterial({ color: TARGET_COLOR });

  constructor(
    private readonly map: MapGraph,
    private readonly onLabelSelect: (regionId: string) => void,
  ) {
    this.root.name = 'Board';
    this.build();
  }

  /** World position of a region's tile top centre. */
  regionPosition(regionId: string): THREE.Vector3 {
    const p = this.positions.get(regionId);
    if (!p) throw new Error(`unknown region ${regionId}`);
    return p;
  }

  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const p of this.positions.values()) box.expandByPoint(p);
    box.expandByVector(new THREE.Vector3(TILE_RADIUS, 0, TILE_RADIUS));
    box.min.y = 0;
    box.max.y = 1.4;
    return box;
  }

  /** Regions the local player may target now, and the current target. */
  setSelection(selectable: Iterable<string>, targetId: string | null): void {
    this.selectable = new Set(selectable);
    this.targetId = targetId;
    for (const [id, tile] of this.tiles) {
      const isTarget = id === targetId;
      tile.ring.visible = this.selectable.has(id) || isTarget;
      tile.ring.material = isTarget ? this.targetRingMat : this.ringMat;
      tile.label.classList.toggle('selectable', this.selectable.has(id) && !isTarget);
      tile.label.classList.toggle('target', isTarget);
      tile.label.tabIndex = this.selectable.has(id) ? 0 : -1;
    }
    this.applyHover();
  }

  setHovered(regionId: string | null): void {
    this.hovered = regionId;
    this.applyHover();
  }

  update(dt: number): void {
    this.time += dt;
    const pulse = 1 + Math.sin(this.time * 5) * 0.06;
    for (const [id, tile] of this.tiles) {
      if (this.selectable.has(id) || id === this.targetId) tile.ring.scale.setScalar(pulse);
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        for (const mat of [m.material].flat()) mat.dispose();
      }
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.root.removeFromParent();
  }

  private applyHover(): void {
    for (const [id, tile] of this.tiles) {
      const hot = id === this.hovered && this.selectable.has(id);
      tile.material.emissiveIntensity = hot ? 0.35 : this.selectable.has(id) ? 0.12 : 0;
      tile.group.position.y = hot ? 0.08 : 0;
    }
  }

  private build(): void {
    const { data } = this.map;
    let sx = 0, sz = 0;
    for (const r of data.regions) { sx += r.position.x; sz += r.position.z; }
    const cx = sx / data.regions.length;
    const cz = sz / data.regions.length;
    for (const r of data.regions) {
      this.positions.set(r.id, new THREE.Vector3((r.position.x - cx) * BOARD_SCALE, TILE_HEIGHT, (r.position.z - cz) * BOARD_SCALE));
    }

    // Sea plane from the map theme.
    const extent = new THREE.Box3();
    for (const p of this.positions.values()) extent.expandByPoint(p);
    const size = extent.getSize(new THREE.Vector3());
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x + 6, size.z + 6),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(data.theme?.palette?.sea ?? FALLBACK_SEA), roughness: 0.6 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.02;
    sea.receiveShadow = true;
    this.root.add(sea);

    const tileGeo = new THREE.CylinderGeometry(TILE_RADIUS, TILE_RADIUS * 1.05, TILE_HEIGHT, 6);
    tileGeo.translate(0, TILE_HEIGHT / 2, 0);
    const ringGeo = new THREE.TorusGeometry(TILE_RADIUS * 0.95, 0.06, 6, 24);
    ringGeo.rotateX(Math.PI / 2);

    for (const r of data.regions) {
      const isStart = r.id === this.map.startId;
      const isFinish = r.id === this.map.finishId;
      const isFinal = this.map.finalRegions.has(r.id);
      const difficulty = isStart || isFinish ? null : regionDifficulty(this.map, r.id);
      const color = isStart ? START_TILE_COLOR : isFinish ? FINISH_TILE_COLOR : DIFFICULTY_TILE_COLORS[difficulty as Difficulty];
      const material = new THREE.MeshStandardMaterial({
        color, roughness: 0.8, flatShading: true, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0,
      });
      const base = this.positions.get(r.id) as THREE.Vector3;
      const anchor = new THREE.Group();
      anchor.position.set(base.x, 0, base.z);
      const group = new THREE.Group();
      group.name = `Tile:${r.id}`;

      const tile = new THREE.Mesh(tileGeo, material);
      tile.castShadow = true;
      tile.receiveShadow = true;
      tile.userData.regionId = r.id;
      group.add(tile);
      this.pickables.push(tile);

      const tileModel = data.regionTypes[r.type]?.tileModel ?? '';
      const decor = makeDecor(isFinish ? 'finish' : isStart ? 'start' : tileModel);
      if (decor) {
        decor.position.set(0.38, TILE_HEIGHT, -0.3);
        decor.traverse((o) => {
          o.userData.regionId = r.id;
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
        });
        group.add(decor);
        this.pickables.push(decor);
      }

      const ring = new THREE.Mesh(ringGeo, this.ringMat);
      ring.position.y = TILE_HEIGHT + 0.03;
      ring.visible = false;
      group.add(ring);

      // DOM label: name + difficulty stars (+ FINAL). Clickable when selectable (big touch target).
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'region-label';
      label.dataset.testid = `region-${r.id}`;
      label.dataset.regionId = r.id;
      label.tabIndex = -1;
      const tag = isStart ? 'START' : isFinish ? 'FINISH' : isFinal ? 'FINAL' : '';
      label.innerHTML =
        `<span class="name">${escapeHtml(localize(r.name))}</span>` +
        (difficulty ? `<span class="stars d-${difficulty}" aria-label="${difficulty}">${STARS[difficulty]}</span>` : '') +
        (tag ? `<span class="tag">${tag}</span>` : '');
      label.addEventListener('click', () => {
        if (this.selectable.has(r.id)) this.onLabelSelect(r.id);
      });
      const labelObj = new CSS2DObject(label);
      labelObj.position.set(0, TILE_HEIGHT + 1.1, 0);
      labelObj.center.set(0.5, 1);
      group.add(labelObj);

      anchor.add(group);
      this.root.add(anchor);
      this.tiles.set(r.id, { group, material, ring, label });
    }

    // One-way paths with a small arrow towards the target region.
    const pathMat = new THREE.MeshStandardMaterial({ color: PATH_COLOR, roughness: 0.9 });
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xf4a261, roughness: 0.7, flatShading: true });
    const arrowGeo = new THREE.ConeGeometry(0.16, 0.34, 4);
    arrowGeo.rotateX(Math.PI / 2);
    for (const e of data.edges) {
      const a = this.positions.get(e.from) as THREE.Vector3;
      const b = this.positions.get(e.to) as THREE.Vector3;
      const len = a.distanceTo(b) - TILE_RADIUS * 1.6;
      if (len <= 0) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, len), pathMat);
      strip.position.set(mid.x, 0.06, mid.z);
      strip.lookAt(b.x, 0.06, b.z);
      strip.receiveShadow = true;
      this.root.add(strip);
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.set(mid.x, 0.2, mid.z);
      arrow.lookAt(b.x, 0.2, b.z);
      arrow.castShadow = true;
      this.root.add(arrow);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/**
 * Tiny procedural prop per tileModel key (placeholder until GLB tiles exist, art-style.md).
 * Keys are asset names from the map file, not region ids.
 */
function makeDecor(key: string): THREE.Object3D | null {
  const g = new THREE.Group();
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (key) {
    case 'tile_forest':
      add(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 5), 0x8d5524, 0, 0.1, 0);
      add(new THREE.IcosahedronGeometry(0.22, 0), 0x2d9d4b, 0, 0.36, 0);
      return g;
    case 'tile_mountain':
      add(new THREE.ConeGeometry(0.34, 0.6, 5), 0x8d8d8d, 0, 0.3, 0);
      add(new THREE.ConeGeometry(0.13, 0.22, 5), 0xffffff, 0, 0.52, 0);
      return g;
    case 'tile_sea_karst':
      add(new THREE.CylinderGeometry(0.1, 0.16, 0.45, 6), 0x5d8a5e, 0, 0.22, 0);
      add(new THREE.CylinderGeometry(0.07, 0.12, 0.3, 6), 0x6fa86f, -0.22, 0.15, 0.1);
      return g;
    case 'tile_city':
      add(new THREE.BoxGeometry(0.2, 0.42, 0.2), 0xffffff, 0, 0.21, 0);
      add(new THREE.BoxGeometry(0.16, 0.26, 0.16), 0xffc8dd, -0.2, 0.13, 0.08);
      return g;
    case 'tile_ricefield':
      for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.42 - i * 0.1, 0.06, 0.42 - i * 0.1), 0x7bc96f - i * 0x081008, -0.1, 0.03 + i * 0.06, 0.05);
      return g;
    case 'tile_beach': {
      const trunk = add(new THREE.CylinderGeometry(0.035, 0.05, 0.42, 5), 0xc68b59, 0, 0.21, 0);
      trunk.rotation.z = 0.25;
      add(new THREE.ConeGeometry(0.26, 0.12, 6), 0x43aa8b, -0.05, 0.44, 0);
      return g;
    }
    case 'start':
    case 'finish': {
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5), 0xffffff, 0, 0.35, 0);
      add(new THREE.BoxGeometry(0.28, 0.17, 0.02), key === 'finish' ? 0x222222 : 0xef233c, 0.14, 0.6, 0);
      return g;
    }
    default:
      return null;
  }
}
