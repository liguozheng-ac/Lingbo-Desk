import { Color, Oklch } from "culori";
//#region src/model-v2.d.ts
declare const MODEL_V2: FittedModel;
//#endregion
//#region src/fitted.d.ts
/**
 * One fitted quantity (lightness, chroma or hue drift) as a function of shade and hue:
 *
 *   value(shade, h) = intercepts[s] + Σ_k weights[s][k] · fourier(curves[k], h)
 *
 * where `fourier(coeffs, h) = [const] + a1·cos(h) + b1·sin(h) + a2·cos(2h) + b2·sin(2h) + …` with `h` in degrees.
 * When `curvesHaveConst` is `false` the constant lives in `intercepts` instead.
 */
interface FittedBlock {
  curves: number[][];
  curvesHaveConst: boolean;
  intercepts: number[];
  weights: number[][];
}
interface FittedModel {
  chroma: FittedBlock;
  /** Degrees added to the input hue, or `null` when the hue is used as is. */
  hueDrift: FittedBlock | null;
  lightness: FittedBlock;
  /** Shades the rows of every block refer to, in order. */
  shades: Shade[];
}
interface FittedOklch {
  /** Chroma, `>= 0`. */
  c: number;
  /** Hue in degrees, wrapped to `[0, 360)`. */
  h: number;
  /** Lightness in `[0, 1]`. */
  l: number;
}
/**
 * Evaluate one fitted block for a shade row.
 *
 * @param block The fitted block.
 * @param shadeIndex Row index into the model's `shades`.
 * @param hue Hue in degrees.
 */
declare function evaluateFittedBlock(block: FittedBlock, shadeIndex: number, hue: number): number;
/**
 * OKLCH of a shade in a fitted model (`v2` by default), before brightness / saturation adjustments.
 *
 * The model is a smooth fit of the Tailwind CSS v4 palette over hue, except around yellow (≈ 65°–145°), where it
 * targets a share of the sRGB gamut instead to avoid neon light shades. See `scripts/fitted/`.
 *
 * @param shade One of `50 | 100 | … | 950`.
 * @param hue Hue in degrees, e.g. `220.25`.
 * @returns `{ l, c, h }` with `l` in `[0, 1]`, `c >= 0` and `h` in `[0, 360)`.
 *
 * @example
 * fittedOklch(500, 220.25) // ≈ { l: 0.701, c: 0.135, h: 220.25 }
 */
declare function fittedOklch(shade: Shade, hue: number, model?: FittedModel): FittedOklch;
/**
 * Evaluate a Fourier series in hue.
 *
 * @param coeffs `[const?, a1, b1, a2, b2, …]`.
 * @param hue Hue in degrees.
 * @param withConst Whether `coeffs` starts with a constant term.
 */
declare function fourierSeries(coeffs: number[], hue: number, withConst: boolean): number;
//#endregion
//#region src/index.d.ts
interface ChromaticColor {
  color: Color;
  toCSS: () => string;
  toHex: () => string;
  withAlpha: (alpha: number) => ChromaticColor;
}
interface ChromaticColorFromOptions {
  alpha?: number;
  /** Only used by the `v1` model. */
  baseChroma?: number;
  brightness?: number;
  hueOffset?: number;
  /** Colour model, defaults to `v2`. See {@link ChromaticModel}. */
  model?: ChromaticModel;
  saturation?: number;
  shade?: Shade;
}
/**
 * How shades are derived from a hue. Versions are frozen once released: a different fit becomes a new version, so
 * colours never change under an existing one.
 *
 * - `v2`: lightness, chroma and a small hue drift all vary smoothly with hue, fitted to the Tailwind CSS v4 palette
 *   (and to a share of the sRGB gamut around yellow). See {@link fittedOklch} and {@link MODEL_V2}. The default.
 * - `v1`: fixed lightness per shade, chroma `(0.18 + 0.04 · cos(hue)) × per-shade multiplier`, shades 50 / 100 mixed
 *   with white. The model of chromatic 1.x.
 */
type ChromaticModel = 'v1' | 'v2';
interface ChromaticModelOptions {
  /** Colour model, defaults to `v2`. */
  model?: ChromaticModel;
}
interface ChromaticPalette {
  baseHue: number;
  /** Chroma of shade 500 at `baseHue`. */
  chroma: number;
  getAllShades: (hueOffset?: number, alpha?: number) => ColorShades;
  model: ChromaticModel;
  shadeBy: (shade: Shade) => ChromaticColor;
}
type ColorShades = Record<Shade, ChromaticColor>;
type Shade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
interface ShadeConfig {
  chromaMultiplier: number;
  lightness: number;
  mixWithWhite?: number;
}
type ShadeConfigMap = Record<Shade, ShadeConfig>;
declare const symbolicShadeValues: Shade[];
declare const symbolicShadeConfig: ShadeConfigMap;
interface ColorScheme {
  [colorName: string]: ColorShades | Function;
  addColor: (name: string, hueOffset: number) => ColorScheme;
  adjustHue: (newBaseHue: number) => ColorScheme;
  getColor: (colorName: string, shade?: Shade) => ChromaticColor | undefined;
  toCSS: (colorName: string, shade?: Shade) => string | undefined;
  toHex: (colorName: string, shade?: Shade) => string | undefined;
}
interface DynamicTheme {
  animateHue: (targetHue: number, steps?: number, duration?: number) => Promise<ColorScheme>;
  getScheme: () => ColorScheme;
  seasonal: {
    autumn: () => ColorScheme;
    spring: () => ColorScheme;
    summer: () => ColorScheme;
    winter: () => ColorScheme;
  };
  setHue: (newHue: number) => ColorScheme;
}
/**
 * Estimate the base chroma for a hue in the Chromatic palette model.
 *
 * @param baseHue Base hue in degrees. Typical values are `0` to `360`.
 * Example: `220.25` for a blue-leaning base hue.
 * @returns Base chroma scalar used before shade/brightness/saturation adjustments.
 * Example output: around `0.15` to `0.22`.
 *
 * @example
 * const c = baseChromaByHue(220.25) // ~0.15-0.16
 */
declare function baseChromaByHue(baseHue: number): number;
/**
 * Build one chromatic color from hue + shade + optional symbolic adjustments.
 *
 * @param baseHue Base hue in degrees. Defaults to `200`.
 * Example values: `30` (orange), `120` (green), `220.25` (blue).
 * @param options Optional per-color controls.
 * - `shade`: one of `50|100|200|300|400|500|600|700|800|900|950` (defaults to `500`)
 * - `hueOffset`: hue shift in degrees (example: `60` for secondary color)
 * - `brightness`: percentage where `100` is unchanged, `120` is brighter, `80` is dimmer
 * - `saturation`: percentage where `100` is unchanged, `0` is grayscale-ish, `150` is more vivid
 * - `alpha`: opacity from `0` to `1` (example: `0.5`)
 * - `baseChroma`: optional override for computed base chroma (advanced use, `v1` model only)
 * - `model`: `'v2'` (default) or `'v1'`, see {@link ChromaticModel}
 * @returns `ChromaticColor` wrapper with `.toHex()`, `.toCSS()`, and `.withAlpha()`.
 *
 * @example
 * const accent = chromaticColorFrom(220.25, {
 *   shade: 500,
 *   hueOffset: 60,
 *   brightness: 115,
 *   saturation: 90,
 *   alpha: 1,
 * })
 * accent.toHex()
 */
declare function chromaticColorFrom(baseHue?: number, options?: ChromaticColorFromOptions): ChromaticColor;
/**
 * Create a dynamic theme controller that can update hue over time.
 *
 * @param baseHue Initial base hue in degrees. Defaults to `200`.
 * @param options Optional `{ model }`, see {@link ChromaticModel}.
 * @returns `DynamicTheme` with `getScheme`, `setHue`, `animateHue`, and seasonal presets.
 *
 * @example
 * const dynamic = chromaticFrom(220.25)
 * dynamic.setHue(280)
 * const winter = dynamic.seasonal.winter()
 */
declare function chromaticFrom(baseHue?: number, options?: ChromaticModelOptions): DynamicTheme;
/**
 * Create a reusable palette object for one base hue.
 *
 * @param baseHue Base hue in degrees. Defaults to `200`.
 * @param baseChroma Optional manual chroma override (`v1` model only). If omitted, it is computed from `baseHue`.
 * @param options Optional `{ model }`, see {@link ChromaticModel}.
 * @returns `ChromaticPalette` with `shadeBy()` and `getAllShades()`.
 *
 * @example
 * const palette = chromaticPaletteFrom(220.25)
 * const primary500 = palette.shadeBy(500).toHex()
 * const shifted = palette.getAllShades(60) // all shades with +60 hue offset
 */
declare function chromaticPaletteFrom(baseHue?: number, baseChroma?: number, options?: ChromaticModelOptions): ChromaticPalette;
/**
 * Convenience helper to get all shades for a single named color at a hue.
 *
 * @param hue Base hue in degrees.
 * Example: `220.25`.
 * @param name Optional temporary color key name. Defaults to `'color'`.
 * @param options Optional `{ model }`, see {@link ChromaticModel}.
 * @returns Shade map (`50..950`) for that color.
 *
 * @example
 * const shades = colorBy(220.25)
 * shades[500].toHex()
 */
declare function colorBy(hue: number, name?: string, options?: ChromaticModelOptions): ColorShades;
/**
 * Mix two colors in OKLCH space.
 *
 * @param color1 First color.
 * Example: `{ mode: 'oklch', l: 0.62, c: 0.16, h: 220 }`
 * @param color2 Second color.
 * Example: `{ mode: 'oklch', l: 1, c: 0, h: 0 }` (white)
 * @param ratio Mix ratio for `color2` in `[0,1]`.
 * `0` = only `color1`, `1` = only `color2`, `0.5` = midpoint.
 * @returns Mixed color object (culori `Color`).
 *
 * @example
 * const mixed = mixColors(
 *   { mode: 'oklch', l: 0.62, c: 0.16, h: 220 },
 *   { mode: 'oklch', l: 1, c: 0, h: 0 },
 *   0.25,
 * )
 */
declare function mixColors(color1: Color, color2: Color, ratio?: number): Color;
/**
 * Build a named color scheme from one base hue plus hue offsets.
 *
 * @param baseHue Base hue in degrees. Defaults to `200`.
 * @param colors Map of color name -> hue offset in degrees.
 * Example: `{ primary: 0, secondary: 60, accent: 180 }`
 * @param options Optional `{ model }`, see {@link ChromaticModel}.
 * @returns `ColorScheme` with named shade maps and helpers (`getColor`, `toHex`, `toCSS`).
 *
 * @example
 * const scheme = themeFrom(220.25, {
 *   primary: 0,
 *   secondary: 60,
 *   accent: 180,
 * })
 * scheme.toHex('primary', 500)
 */
declare function themeFrom(baseHue?: number, colors?: Record<string, number>, options?: ChromaticModelOptions): ColorScheme;
//#endregion
export { ChromaticColor, ChromaticColorFromOptions, ChromaticModel, ChromaticModelOptions, ChromaticPalette, type Color, ColorScheme, ColorShades, DynamicTheme, type FittedBlock, type FittedModel, type FittedOklch, MODEL_V2, type Oklch, Shade, ShadeConfig, ShadeConfigMap, baseChromaByHue, chromaticColorFrom, chromaticFrom, chromaticPaletteFrom, colorBy, evaluateFittedBlock, fittedOklch, fourierSeries, mixColors, symbolicShadeConfig, symbolicShadeValues, themeFrom };