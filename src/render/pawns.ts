/**
 * Chibi placeholder pawns (big head, small body). sync() copies logic state into hop
 * targets; update() animates. Pawns never feed anything back into the logic.
 */
import * as THREE from 'three';
import type { GameState } from '../logic';
import type { BoardView } from './board';
import { PLAYER_COLORS } from './palette';

const HOP_SECONDS = 0.45;
const HOP_HEIGHT = 0.7;
/** Offsets when several players share a region (R6.1 allows it). */
const SLOT_OFFSETS: readonly (readonly [number, number])[][] = [
  [[0, 0]],
  [[-0.28, 0.12], [0.28, -0.12]],
  [[-0.3, 0.15], [0.3, 0.15], [0, -0.3]],
  [[-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]],
];

interface PawnView {
  group: THREE.Group;
  body: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** 0..1 hop progress; 1 = standing at `to`. */
  t: number;
  bobPhase: number;
}

const sharedGeo = {
  body: new THREE.CapsuleGeometry(0.17, 0.16, 3, 8),
  head: new THREE.IcosahedronGeometry(0.26, 1),
  eye: new THREE.SphereGeometry(0.035, 6, 4),
  cheek: new THREE.SphereGeometry(0.04, 6, 4),
};
const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe0c2, roughness: 0.7, flatShading: true });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff9eb5 });

function makePawn(color: number): THREE.Group {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true });

  const body = new THREE.Mesh(sharedGeo.body, bodyMat);
  body.position.y = 0.25;
  const head = new THREE.Mesh(sharedGeo.head, skinMat);
  head.position.y = 0.68;
  // Hair/cap in the player colour so the pawn reads from above.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), bodyMat);
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
  return root;
}

export class PawnsView {
  readonly root = new THREE.Group();
  private readonly pawns = new Map<string, PawnView>();

  constructor(private readonly board: BoardView) {
    this.root.name = 'Pawns';
  }

  /** Copy logic state onto hop targets. Creates pawns for new players. */
  sync(state: Readonly<GameState>): void {
    const byNode = new Map<string, string[]>();
    for (const p of state.players) {
      const list = byNode.get(p.nodeId) ?? [];
      list.push(p.id);
      byNode.set(p.nodeId, list);
    }

    for (const p of state.players) {
      const occupants = byNode.get(p.nodeId) as string[];
      const slots = SLOT_OFFSETS[Math.min(occupants.length, 4) - 1] as (readonly [number, number])[];
      const [ox, oz] = slots[occupants.indexOf(p.id) % slots.length] as readonly [number, number];
      const target = this.board.nodePosition(p.nodeId).clone().add(new THREE.Vector3(ox, 0, oz));

      let view = this.pawns.get(p.id);
      if (!view) {
        const body = makePawn(PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length] as number);
        const group = new THREE.Group();
        group.name = `Pawn:${p.id}`;
        group.add(body);
        group.position.copy(target);
        group.rotation.y = Math.PI / 4; // face the iso camera
        this.root.add(group);
        view = { group, body, from: target.clone(), to: target.clone(), t: 1, bobPhase: p.colorIndex * 1.7 };
        this.pawns.set(p.id, view);
        continue;
      }
      if (!view.to.equals(target)) {
        view.from.copy(view.group.position);
        view.to.copy(target);
        view.t = 0;
        const dx = target.x - view.from.x;
        const dz = target.z - view.from.z;
        if (dx * dx + dz * dz > 0.01) view.group.rotation.y = Math.atan2(dx, dz);
      }
    }
  }

  update(dt: number): void {
    for (const v of this.pawns.values()) {
      v.bobPhase += dt * 4;
      if (v.t < 1) {
        v.t = Math.min(1, v.t + dt / HOP_SECONDS);
        const e = v.t * v.t * (3 - 2 * v.t); // smoothstep
        v.group.position.lerpVectors(v.from, v.to, e);
        v.group.position.y += Math.sin(Math.PI * v.t) * HOP_HEIGHT;
        // Squash on take-off/landing, stretch mid-air.
        const s = 1 + Math.sin(Math.PI * v.t) * 0.15;
        v.body.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      } else {
        v.body.scale.set(1, 1, 1);
        v.body.position.y = Math.abs(Math.sin(v.bobPhase)) * 0.04;
      }
    }
  }

  clear(): void {
    for (const v of this.pawns.values()) v.group.removeFromParent();
    this.pawns.clear();
  }
}
