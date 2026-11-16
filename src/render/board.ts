/**
 * Board view: one low-poly hex tile per map node, plus path strips for edges.
 * Read-only view of the MapGraph; highlights are driven from outside.
 */
import * as THREE from 'three';
import type { MapGraph } from '../logic';
import { HIGHLIGHT_COLOR, PATH_COLOR, REGION_COLORS, REGION_FALLBACK_COLOR, WATER_COLOR } from './palette';

const TILE_RADIUS = 0.85;
const TILE_HEIGHT = 0.4;
export const TILE_TOP_Y = TILE_HEIGHT;

interface TileView {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
}

export class BoardView {
  readonly root = new THREE.Group();
  /** Meshes the picker raycasts against; each carries userData.nodeId. */
  readonly pickables: THREE.Object3D[] = [];
  private readonly tiles = new Map<string, TileView>();
  private readonly positions = new Map<string, THREE.Vector3>();
  private highlighted = new Set<string>();
  private hovered: string | null = null;
  private time = 0;

  constructor(private readonly map: MapGraph) {
    this.root.name = 'Board';
    this.build();
  }

  /** World position of a node's tile top centre. */
  nodePosition(nodeId: string): THREE.Vector3 {
    const p = this.positions.get(nodeId);
    if (!p) throw new Error(`unknown node ${nodeId}`);
    return p;
  }

  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const p of this.positions.values()) box.expandByPoint(p);
    box.expandByVector(new THREE.Vector3(TILE_RADIUS, 0, TILE_RADIUS));
    box.min.y = 0;
    box.max.y = 1.2; // pawns and props stand above the tiles
    return box;
  }

  /** Mark the nodes the local player may move to. */
  setHighlighted(nodeIds: Iterable<string>): void {
    this.highlighted = new Set(nodeIds);
    for (const [id, tile] of this.tiles) tile.ring.visible = this.highlighted.has(id);
    this.applyHover();
  }

  setHovered(nodeId: string | null): void {
    this.hovered = nodeId;
    this.applyHover();
  }

  update(dt: number): void {
    this.time += dt;
    const pulse = 1 + Math.sin(this.time * 5) * 0.06;
    for (const id of this.highlighted) {
      const tile = this.tiles.get(id);
      if (tile) tile.ring.scale.setScalar(pulse);
    }
  }

  private applyHover(): void {
    for (const [id, tile] of this.tiles) {
      const hot = id === this.hovered && this.highlighted.has(id);
      tile.material.emissiveIntensity = hot ? 0.35 : this.highlighted.has(id) ? 0.12 : 0;
      tile.group.position.y = hot ? 0.08 : 0;
    }
  }

  private build(): void {
    const { data } = this.map;
    // Centre the layout on the origin. Map y -> world z.
    let sx = 0, sz = 0;
    for (const n of data.nodes) { sx += n.pos.x; sz += n.pos.y; }
    const cx = sx / data.nodes.length;
    const cz = sz / data.nodes.length;
    for (const n of data.nodes) this.positions.set(n.id, new THREE.Vector3(n.pos.x - cx, TILE_TOP_Y, n.pos.y - cz));

    // Water plane under everything.
    const extent = new THREE.Box3();
    for (const p of this.positions.values()) extent.expandByPoint(p);
    const size = extent.getSize(new THREE.Vector3());
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x + 8, size.z + 8),
      new THREE.MeshStandardMaterial({ color: WATER_COLOR, roughness: 0.6 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.02;
    water.receiveShadow = true;
    this.root.add(water);

    const tileGeo = new THREE.CylinderGeometry(TILE_RADIUS, TILE_RADIUS * 1.05, TILE_HEIGHT, 6);
    tileGeo.translate(0, TILE_HEIGHT / 2, 0);
    const ringGeo = new THREE.TorusGeometry(TILE_RADIUS * 0.95, 0.06, 6, 24);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLOR });

    for (const n of data.nodes) {
      const color = REGION_COLORS[n.type] ?? REGION_FALLBACK_COLOR;
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        flatShading: true,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0,
      });
      const group = new THREE.Group();
      group.name = `Tile:${n.id}`;
      const base = this.positions.get(n.id) as THREE.Vector3;
      const anchor = new THREE.Group();
      anchor.position.set(base.x, 0, base.z);

      const tile = new THREE.Mesh(tileGeo, material);
      tile.castShadow = true;
      tile.receiveShadow = true;
      tile.userData.nodeId = n.id;
      group.add(tile);
      this.pickables.push(tile);

      const decor = makeDecor(n.type);
      if (decor) {
        decor.position.set(0.42, TILE_HEIGHT, -0.32);
        decor.traverse((o) => {
          o.userData.nodeId = n.id;
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
        });
        group.add(decor);
        this.pickables.push(decor);
      }

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = TILE_HEIGHT + 0.03;
      ring.visible = false;
      group.add(ring);

      anchor.add(group);
      this.root.add(anchor);
      this.tiles.set(n.id, { group, material, ring });
    }

    // Paths: flat strips between tiles; a small arrow shows one-way direction.
    const pathMat = new THREE.MeshStandardMaterial({ color: PATH_COLOR, roughness: 0.9 });
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xf4a261, roughness: 0.7, flatShading: true });
    const arrowGeo = new THREE.ConeGeometry(0.16, 0.34, 4);
    arrowGeo.rotateX(Math.PI / 2); // point along +Z
    for (const e of data.edges) {
      const a = this.positions.get(e.from) as THREE.Vector3;
      const b = this.positions.get(e.to) as THREE.Vector3;
      const len = a.distanceTo(b) - TILE_RADIUS * 1.6;
      if (len <= 0) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, len), pathMat);
      strip.position.set(mid.x, 0.06, mid.z);
      strip.lookAt(b.x, 0.06, b.z);
      strip.receiveShadow = true;
      this.root.add(strip);
      if (!e.twoWay) {
        const arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.position.set(mid.x, 0.2, mid.z);
        arrow.lookAt(b.x, 0.2, b.z);
        arrow.castShadow = true;
        this.root.add(arrow);
      }
    }
  }
}

/** Tiny low-poly prop per region type, so tiles read at a glance. */
function makeDecor(type: string): THREE.Object3D | null {
  const g = new THREE.Group();
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
  switch (type) {
    case 'forest': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 5), mat(0x8d5524));
      trunk.position.y = 0.1;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 6), mat(0x2d9d4b));
      crown.position.y = 0.42;
      g.add(trunk, crown);
      return g;
    }
    case 'mountain':
    case 'volcano': {
      const peak = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.6, 5), mat(type === 'volcano' ? 0x6d4c41 : 0x8d8d8d));
      peak.position.y = 0.3;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.22, 5), mat(type === 'volcano' ? 0xff5722 : 0xffffff));
      cap.position.y = 0.52;
      g.add(peak, cap);
      return g;
    }
    case 'city': {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.2), mat(0xffffff));
      a.position.y = 0.21;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.16), mat(0xffc8dd));
      b.position.set(-0.2, 0.13, 0.08);
      g.add(a, b);
      return g;
    }
    case 'beach': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.42, 5), mat(0xc68b59));
      trunk.position.y = 0.21;
      trunk.rotation.z = 0.25;
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.12, 6), mat(0x43aa8b));
      leaves.position.set(-0.05, 0.44, 0);
      g.add(trunk, leaves);
      return g;
    }
    case 'harbor': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 5), mat(0xffffff));
      pole.position.y = 0.3;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.15, 0.02), mat(0xef233c));
      flag.position.set(0.12, 0.52, 0);
      g.add(pole, flag);
      return g;
    }
    default:
      return null;
  }
}
