/**
 * Unified pointer input (mouse, touch, pen) -> named input intents.
 * Gameplay never reads raw DOM events; it receives intents and maps them to GameActions.
 *
 * - "select": a tap/click (press and release close together in space and time).
 * - "hover":  mouse-only pointer position for highlight feedback.
 * - "selectIndex": keyboard alternative (digits 1-9 pick the n-th legal move), so the
 *   game is playable without a pointer.
 */
export type InputIntent =
  | { type: 'select'; clientX: number; clientY: number; pointerType: string }
  | { type: 'hover'; clientX: number; clientY: number }
  | { type: 'hoverEnd' }
  | { type: 'selectIndex'; index: number };

/** Max travel (CSS px) for a press to still count as a tap; touch is less precise. */
const TAP_SLOP_PX: Readonly<Record<string, number>> = { mouse: 6, pen: 10, touch: 14 };
const TAP_MAX_MS = 600;

export class PointerInput {
  private press: { id: number; x: number; y: number; t: number; type: string } | null = null;
  private readonly abort = new AbortController();

  constructor(
    target: HTMLElement,
    private readonly emit: (intent: InputIntent) => void,
  ) {
    const opts = { signal: this.abort.signal };
    target.addEventListener('pointerdown', this.onDown, opts);
    target.addEventListener('pointerup', this.onUp, opts);
    target.addEventListener('pointercancel', this.onCancel, opts);
    target.addEventListener('pointermove', this.onMove, opts);
    target.addEventListener('pointerleave', () => this.emit({ type: 'hoverEnd' }), opts);
    target.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    window.addEventListener('keydown', this.onKey, opts);
  }

  dispose(): void {
    this.abort.abort();
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType };
  };

  private readonly onUp = (e: PointerEvent): void => {
    const p = this.press;
    this.press = null;
    if (!p || p.id !== e.pointerId) return;
    const slop = TAP_SLOP_PX[p.type] ?? 10;
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (moved <= slop && performance.now() - p.t <= TAP_MAX_MS) {
      this.emit({ type: 'select', clientX: e.clientX, clientY: e.clientY, pointerType: p.type });
    }
  };

  private readonly onCancel = (): void => {
    this.press = null;
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.emit({ type: 'hover', clientX: e.clientX, clientY: e.clientY });
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    // e.code is the physical key, so this works on any keyboard layout.
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) this.emit({ type: 'selectIndex', index: Number(m[1]) - 1 });
  };
}
