/** Bright toy-diorama palette (R10). Keyed by region type; unknown types fall back. */
export const REGION_COLORS: Readonly<Record<string, number>> = {
  harbor: 0xffd166,
  beach: 0xffe3a3,
  forest: 0x6fcf72,
  city: 0xb39ddb,
  mountain: 0xa1887f,
  volcano: 0xff8a65,
};
export const REGION_FALLBACK_COLOR = 0xe0e0e0;

/** Player colours by PlayerState.colorIndex. */
export const PLAYER_COLORS: readonly number[] = [0xff4d6d, 0x3a86ff, 0x2ec4b6, 0xffb703];

export const SKY_COLOR = 0xbfe9ff;
export const WATER_COLOR = 0x7fd3f7;
export const PATH_COLOR = 0xfff4dc;
export const HIGHLIGHT_COLOR = 0xffffff;
