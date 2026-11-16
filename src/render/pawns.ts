/**
 * Chibi placeholder pawns (big head, small body). sync() copies logic state into a queue of
 * hops along each player's path; update() animates. Purely cosmetic: the win is decided by
 * the logic event, the walk to the finish just plays afterwards (DR-06).
 */
import * as THREE from 'three';
import type { GameState, MapGraph } from '../logic';
import type { BoardView } from './board';
import { PLAYER_COLORS } from './palette';

const HOP_SECONDS = 0.45;
/** Walk to the finish after winning (ui-flow §10: 2 s). */
const FINISH_WALK_SECONDS = 2;
const HOP_HEIGHT = 0.7;
const SLOT_OFFSETS: readonly (readonly [number, number])[][] = [
  [[0, 0]],
  [[-0.28, 0.12], [0.28, -0.12]],
  [[-0.3, 0.15], [0.3, 0.15], [0, -0.3]],
  [[-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]],
];

interface Hop {
  to: THREE.Vector3;
  seconds: number;
}

interface PawnView {
  group: THREE.Group;
  body: THREE.Group;
  shownPathLength: number;
  queue: Hop[];
  from: THREE.Vector3;
  current: Hop | null;
  t: number;
  bobPhase: number;
  facing: number;
}

const sharedGeo = {
  body: new THREE.CapsuleGeometry(0.17, 0.16, 3, 8),
  head: new THREE.IcosahedronGeometry(0.26, 1),
  cap: new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2),
  eye: new THREE.SphereGeometry(0.035, 6, 4),
  cheek: new THREE.SphereGeometry(0.04, 6, 4),
};
const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe0c2, roughness: 0.7, flatShading: true });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff9eb5 });

function makePawn(color: number): { body: THREE.Group; material: THREE.Material } {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true });
  const body = new THREE.Mesh(sharedGeo.body, bodyMat);
  body.position.y = 0.25;
  const head = new THREE.Mesh(sharedGeo.head, skinMat);
  head.position.y = 0.68;
  const cap = new THREE.Mesh(sharedGeo.cap, bodyMat);
  cap.position.y = 0.7;
  cap.rotation.x = -0.25;
  const eyeL = new THREE.Mesh(sharedGeo.eye, eyeMat);
  const eyeR = new THREE.Mesh(sharedGeo.eye, eyeMat);
  eyeL.position.set(-0.09, 0.67, 0.235);
  eyeR.position.set(0.09, 0.67, 0.235);
  const cheekL = new THREE.Mesh(sharedGeo.cheek, cheekMat);
  const cheekR = new THREE.Mesh(sharedGeo.cheek, cheekMat);
  cheekL.position.set(-0.15, 0.6, 0.2);
  cheekR.position.set(0.15, 0.6, 0.2);
  for (const m of [body, head, cap]) m.castShadow = true;
  root.add(body, head, cap, eyeL, eyeR, cheekL, cheekR);
  return { body: root, material: bodyMat };
}

export class PawnsView {
  readonly root = new THREE.Group();
  private readonly pawns = new Map<string, PawnView>();
  private readonly materials: THREE.Material[] = [];

  constructor(
    private readonly board: BoardView,
    private readonly map: MapGraph,
  ) {
    this.root.name = 'Pawns';
  }

  sync(state: Readonly<GameState>): void {
    const byNode = new Map<string, string[]>();
    for (const p of state.players) {
      const list = byNode.get(p.nodeId) ?? [];
      list.push(p.id);
      byNode.set(p.nodeId, list);
    }
    const slotPos = (playerId: string, regionId: string): THREE.Vector3 => {
      const occupants = byNode.get(regionId) ?? [playerId];
      const slots = SLOT_OFFSETS[Math.min(occupants.length, 4) - 1] as (readonly [number, number])[];
      const i = Math.max(0, occupants.indexOf(playerId));
      const [ox, oz] = slots[i % slots.length] as readonly [number, number];
      return this.board.regionPosition(regionId).clone().add(new THREE.Vector3(ox, 0, oz));
    };

    for (const p of state.players) {
      let view = this.pawns.get(p.id);
      if (!view) {
        const { body, material } = makePawn(PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length] as number);
        this.materials.push(material);
        const group = new THREE.Group();
        group.name = `Pawn:${p.id}`;
        group.add(body);
        group.position.copy(slotPos(p.id, p.nodeId));
        group.rotation.y = Math.PI / 4;
        this.root.add(group);
        view = {
          group, body, shownPathLength: p.path.length, queue: [], from: group.position.clone(),
          current: null, t: 1, bobPhase: p.colorIndex * 1.7, facing: Math.PI / 4,
        };
        this.pawns.set(p.id, view);
        continue;
      }
      // Queue one hop per newly conquered region (and the cosmetic walk to the finish).
      for (let i = view.shownPathLength; i < p.path.length; i++) {
        const regionId = p.path[i] as string;
        const isFinishWalk = regionId === this.map.finishId;
        const to = i === p.path.length - 1 ? slotPos(p.id, regionId) : this.board.regionPosition(regionId).clone();
        view.queue.push({ to, seconds: isFinishWalk ? FINISH_WALK_SECONDS : HOP_SECONDS });
      }
      view.shownPathLength = p.path.length;
      // Re-slot when others arrive/leave, if standing still.
      if (!view.current && view.queue.length === 0) {
        const want = slotPos(p.id, p.nodeId);
        if (want.distanceToSquared(view.group.position) > 1e-4) view.queue.push({ to: want, seconds: 0.25 });
      }
      // Face the current target while idle.
      if (p.targetId) {
        const tp = this.board.regionPosition(p.targetId);
        view.facing = Math.atan2(tp.x - view.group.position.x, tp.z - view.group.position.z);
      }
    }
  }

  update(dt: number): void {
    for (const v of this.pawns.values()) {
      v.bobPhase += dt * 4;
      if (!v.current && v.queue.length > 0) {
        v.current = v.queue.shift() as Hop;
        v.from.copy(v.group.position);
        v.t = 0;
        const dx = v.current.to.x - v.from.x;
        const dz = v.current.to.z - v.from.z;
        if (dx * dx + dz * dz > 0.01) v.facing = Math.atan2(dx, dz);
      }
      v.group.rotation.y += shortestAngle(v.group.rotation.y, v.facing) * Math.min(1, dt * 10);
      if (v.current) {
        v.t = Math.min(1, v.t + dt / v.current.seconds);
        const e = v.t * v.t * (3 - 2 * v.t);
        v.group.position.lerpVectors(v.from, v.current.to, e);
        const hops = v.current.seconds > 1 ? 3 : 1; // the finish walk bounces a few times
        const arc = Math.abs(Math.sin(Math.PI * v.t * hops));
        v.group.position.y += arc * (v.current.seconds < 0.3 ? 0 : HOP_HEIGHT);
        const s = 1 + arc * 0.15;
        v.body.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
        if (v.t >= 1) v.current = null;
      } else {
        v.body.scale.set(1, 1, 1);
        v.body.position.y = Math.abs(Math.sin(v.bobPhase)) * 0.04;
      }
    }
  }

  /** True while any pawn still has hops queued (e.g. the finish walk). */
  get animating(): boolean {
    for (const v of this.pawns.values()) if (v.current || v.queue.length > 0) return true;
    return false;
  }

  dispose(): void {
    for (const v of this.pawns.values()) v.group.removeFromParent();
    this.pawns.clear();
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
  }
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
