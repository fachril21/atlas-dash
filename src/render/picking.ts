/** Screen point -> map region id, by raycasting the board's pickable meshes. */
import * as THREE from 'three';

export class NodePicker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly canvas: HTMLCanvasElement,
    private readonly pickables: readonly THREE.Object3D[],
  ) {}

  /** clientX/clientY are viewport CSS pixels, as delivered by PointerEvent. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables as THREE.Object3D[], true);
    for (const h of hits) {
      const id = h.object.userData.regionId;
      if (typeof id === 'string') return id;
    }
    return null;
  }
}
