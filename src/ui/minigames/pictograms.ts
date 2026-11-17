/**
 * Placeholder artwork as inline SVG strings (CP5b; final art arrives in CP6). No external assets
 * and no map-specific names: shapes are generic silhouettes picked by the icon's position in the
 * map's own `icons` list, so two icons of one colour group always differ in silhouette (a11y:
 * never colour alone).
 */

const STROKE = '#23324a';

/** Generic 48x48 silhouettes. Index = position in the map's icon list (wraps around). */
const SHAPES: readonly string[] = [
  // 0 bowl with steam
  '<path d="M5 24h38a19 17 0 0 1-38 0z"/><path d="M15 18c-3-4 3-5 0-10M24 18c-3-4 3-5 0-10M33 18c-3-4 3-5 0-10" fill="none"/>',
  // 1 skewer with three pieces
  '<path d="M5 43L43 5" fill="none"/><circle cx="15" cy="33" r="5.5"/><circle cx="24" cy="24" r="5.5"/><circle cx="33" cy="15" r="5.5"/>',
  // 2 mound
  '<path d="M4 41h40L24 7z"/><circle cx="24" cy="28" r="2" fill="#fff"/><circle cx="17" cy="35" r="2" fill="#fff"/><circle cx="31" cy="35" r="2" fill="#fff"/>',
  // 3 ball on a stick
  '<circle cx="24" cy="19" r="14"/><path d="M24 33v11M16 44h16" fill="none"/>',
  // 4 cup with straw
  '<path d="M11 15h26l-4 28H15z"/><path d="M27 15l6-11h8" fill="none"/>',
  // 5 puppet
  '<circle cx="24" cy="11" r="6"/><path d="M24 17l-15 8 7 4-5 15h26l-5-15 7-4z"/>',
  // 6 pillar with a ball on top
  '<circle cx="24" cy="8" r="5"/><rect x="20" y="13" width="8" height="22"/><rect x="11" y="35" width="26" height="9"/>',
  // 7 tower with a flame
  '<path d="M24 2c5 5 5 9 0 12c-5-3-5-7 0-12z"/><path d="M20 16h8l4 27H16z"/>',
  // 8 palace with a dome
  '<rect x="5" y="28" width="38" height="15"/><path d="M13 28a11 13 0 0 1 22 0z"/><rect x="2" y="20" width="6" height="23"/><rect x="40" y="20" width="6" height="23"/>',
  // 9 rock with a roof on top
  '<path d="M3 44l11-21 9 6 9-15 13 30z"/><path d="M25 8l7-6 7 6z"/>',
  // 10 three small islands
  '<ellipse cx="11" cy="31" rx="9" ry="6"/><ellipse cx="30" cy="24" rx="12" ry="8"/><ellipse cx="38" cy="38" rx="8" ry="5"/><path d="M2 45h44" fill="none"/>',
  // 11 lizard
  '<path d="M3 31c6-9 15-9 22-5l9-6 5 4-7 6 6 8-4 3-6-6-10 2-8 6z"/>',
  // 12 curved roof on posts
  '<path d="M3 18c9 3 13 1 21-9 8 10 12 12 21 9-2 7-9 9-21 9S5 25 3 18z"/><rect x="12" y="27" width="5" height="16"/><rect x="31" y="27" width="5" height="16"/>',
  // 13 clock tower
  '<path d="M13 16l11-13 11 13z"/><rect x="13" y="16" width="22" height="28"/><circle cx="24" cy="28" r="7" fill="#fff"/><path d="M24 23v5l3 2" fill="none"/>',
];

const COLORS: Record<string, string> = {
  cokelat: '#b5703f', brown: '#b5703f',
  kuning: '#ffd23f', yellow: '#ffd23f',
  hijau: '#3ddc84', green: '#3ddc84',
  merah: '#ff5a5f', red: '#ff5a5f',
  biru: '#4aa3ff', blue: '#4aa3ff',
  putih: '#f6f6f2', white: '#f6f6f2',
  ungu: '#9b5de5', purple: '#9b5de5',
  oranye: '#ff9f1c', orange: '#ff9f1c',
  hitam: '#4a4a55', black: '#4a4a55',
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Fill colour of a group label (known colour words, else a stable hue from the label). */
export function groupColor(label: string): string {
  return COLORS[label.toLowerCase()] ?? `hsl(${hash(label) % 360} 65% 62%)`;
}

export function shapeCount(): number {
  return SHAPES.length;
}

/** A card face: silhouette `index` (wraps) filled with the group colour. */
export function iconSvg(index: number, color: string): string {
  const shape = SHAPES[((index % SHAPES.length) + SHAPES.length) % SHAPES.length] as string;
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="${color}" stroke="${STROKE}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${shape}</svg>`;
}

/** Silhouettes that read as buildings or scenery (a bowl is no place), used for place pictures. */
const PLACE_SHAPES: readonly number[] = [6, 7, 8, 9, 10, 12, 13];

/**
 * A stand-in "picture" for a place: a sky/ground scene with a big generic silhouette, coloured
 * from the place id. Carries no text, so it cannot leak the answer (hard mode shows it alone).
 */
export function placeSceneSvg(placeIndex: number, placeId: string): string {
  const h = hash(placeId);
  const hue = h % 360;
  const shape = SHAPES[PLACE_SHAPES[((placeIndex % PLACE_SHAPES.length) + PLACE_SHAPES.length) % PLACE_SHAPES.length] as number] as string;
  const body = `hsl(${(hue + 40) % 360} 60% 70%)`;
  return `<svg viewBox="0 0 160 100" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
    <rect width="160" height="100" fill="hsl(${hue} 70% 82%)"/>
    <circle cx="${28 + (h % 20)}" cy="22" r="11" fill="#fff6bf"/>
    <rect y="74" width="160" height="26" fill="hsl(${(hue + 120) % 360} 45% 62%)"/>
    <g transform="translate(42 12) scale(1.45)" fill="${body}" stroke="${STROKE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${shape}</g>
  </svg>`;
}

/** Whack-a-Mole characters: different silhouettes (round ears vs pointed ears); the decoy has a red cross badge. */
export function moleSvg(): string {
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round">
    <circle cx="13" cy="22" r="9" fill="#c9a27e"/><circle cx="51" cy="22" r="9" fill="#c9a27e"/>
    <ellipse cx="32" cy="40" rx="23" ry="21" fill="#b08968"/>
    <circle cx="23" cy="36" r="3" fill="${STROKE}"/><circle cx="41" cy="36" r="3" fill="${STROKE}"/>
    <ellipse cx="32" cy="46" rx="5" ry="4" fill="#ff8fa3"/>
    <path d="M12 44l-8-2M12 50l-8 3M52 44l8-2M52 50l8 3" fill="none"/>
  </svg>`;
}

export function catSvg(): string {
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round">
    <path d="M8 26L12 3 27 15zM56 26L52 3 37 15z" fill="#ff9f43"/>
    <ellipse cx="32" cy="40" rx="24" ry="21" fill="#ff9f43"/>
    <path d="M20 34l7 3M44 34l-7 3" fill="none"/>
    <path d="M28 46l4 3 4-3z" fill="#ff8fa3"/>
    <path d="M10 44l-8 1M10 50l-8 4M54 44l8 1M54 50l8 4" fill="none"/>
    <circle cx="54" cy="10" r="9" fill="#e63946"/><path d="M50 6l8 8M58 6l-8 8" stroke="#fff" stroke-width="3" fill="none"/>
  </svg>`;
}
