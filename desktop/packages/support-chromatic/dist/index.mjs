import { converter, formatCss, formatHex, oklch } from "culori";
//#region src/model-v2.ts
const MODEL_V2 = {
	chroma: {
		curves: [
			[
				.018792,
				-.003816,
				.004058,
				-.00165,
				-.003122,
				.00155,
				-.002375,
				509e-6,
				.001784,
				-.001427,
				-8e-4,
				-1e-5,
				-.001118,
				909e-6,
				236e-6,
				-92e-5,
				693e-6,
				-449e-6,
				-469e-6,
				385e-6,
				-293e-6,
				159e-6,
				744e-6,
				-487e-6,
				3e-6
			],
			[
				.044041,
				-.010453,
				.013916,
				-.004756,
				-.009983,
				.005245,
				-.007603,
				.001865,
				.006095,
				-.005145,
				-.002204,
				767e-6,
				-.003654,
				.00278,
				.001417,
				-.00319,
				.002017,
				-963e-6,
				-.002183,
				.001719,
				-284e-6,
				-117e-6,
				.002389,
				-.001663,
				-677e-6
			],
			[
				.084459,
				-.016722,
				.025152,
				-.007122,
				-.018177,
				.010353,
				-.01277,
				866e-6,
				.009446,
				-.006294,
				-.006737,
				.002105,
				-.002712,
				.001054,
				.001301,
				-.003655,
				557e-6,
				245e-6,
				-926e-6,
				-641e-6,
				223e-6,
				493e-6,
				.001026,
				-565e-6,
				486e-6
			],
			[
				.136426,
				-.013483,
				.021287,
				.003689,
				-.022556,
				.005544,
				-.005305,
				-.005682,
				-.004047,
				.004934,
				-.003207,
				-.00789,
				323e-6,
				75e-5,
				-.004597,
				-163e-6,
				.00297,
				-.003745,
				606e-6,
				.001268,
				116e-6,
				-.001549,
				.001541,
				.001448,
				-165e-6
			],
			[
				.185617,
				.016961,
				.004368,
				.009844,
				-.02426,
				41e-5,
				.006683,
				-.011614,
				-.012106,
				.002125,
				-.004135,
				-.007714,
				.002332,
				-.002262,
				-.004802,
				-.001065,
				.005421,
				-.003139,
				963e-6,
				.002351,
				.001319,
				-.001143,
				.002956,
				.001772,
				-.001008
			],
			[
				.204808,
				.044351,
				-.012947,
				.003638,
				-.030678,
				.001629,
				.016838,
				-.009823,
				-.005015,
				-.001744,
				-.003902,
				-.01054,
				.006931,
				-.001074,
				-.002439,
				.001689,
				.00205,
				-.002534,
				-424e-6,
				.004236,
				-302e-6,
				542e-6,
				533e-6,
				-513e-6,
				-.002297
			],
			[
				.200381,
				.06378,
				-.026933,
				27e-6,
				-.025459,
				-.002877,
				.027674,
				-.006956,
				.004762,
				.001075,
				-.003502,
				-.007406,
				.005387,
				506e-6,
				-.002777,
				.003412,
				-.002269,
				-.004092,
				-.00273,
				.001393,
				278e-6,
				.002001,
				.002208,
				428e-6,
				-.002005
			],
			[
				.177073,
				.063158,
				-.033851,
				-.00622,
				-.020278,
				-.006185,
				.030741,
				-.002016,
				.003898,
				.001835,
				-.00955,
				-.008601,
				.001561,
				429e-6,
				417e-6,
				.006174,
				-64e-5,
				-.002175,
				-.002681,
				-152e-6,
				976e-6,
				.001525,
				.003163,
				99e-6,
				-.001976
			],
			[
				.146899,
				.054344,
				-.027694,
				-.004772,
				-.017516,
				-.005159,
				.023668,
				-.001838,
				.001642,
				952e-6,
				-.008952,
				-.006986,
				.001674,
				.001501,
				.001082,
				.005856,
				-878e-6,
				-.002488,
				-.002321,
				-834e-6,
				.001704,
				.001666,
				.002962,
				194e-6,
				-.00247
			],
			[
				.119686,
				.044038,
				-.019371,
				-.002806,
				-.015516,
				-.003355,
				.0162,
				-.002495,
				306e-6,
				567e-6,
				-.007174,
				-.004932,
				.001728,
				.001489,
				662e-6,
				.004565,
				-762e-6,
				-.002217,
				-.001438,
				-538e-6,
				.001433,
				.001356,
				.002131,
				-165e-6,
				-.002089
			],
			[
				.084842,
				.031339,
				-.016582,
				-599e-6,
				-.014601,
				-.003141,
				.008876,
				-.002841,
				-588e-6,
				177e-6,
				-.00455,
				-.002388,
				.001807,
				.00147,
				169e-6,
				.00277,
				-78e-5,
				-.001884,
				-266e-6,
				-94e-6,
				.001028,
				.001031,
				894e-6,
				-693e-6,
				-.001474
			]
		],
		curvesHaveConst: true,
		intercepts: [
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0
		],
		weights: [
			[
				1,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0
			],
			[
				0,
				1,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0
			],
			[
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0
			],
			[
				0,
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				0,
				0,
				0
			],
			[
				0,
				0,
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				0,
				0
			],
			[
				0,
				0,
				0,
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				0
			],
			[
				0,
				0,
				0,
				0,
				0,
				0,
				1,
				0,
				0,
				0,
				0
			],
			[
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				1,
				0,
				0,
				0
			],
			[
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				1,
				0,
				0
			],
			[
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				1,
				0
			],
			[
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				1
			]
		]
	},
	hueDrift: {
		curves: [[
			.792238,
			2.617254,
			-1.709469,
			.832654,
			-2.469054,
			.531278
		]],
		curvesHaveConst: false,
		intercepts: [
			-.595322,
			-.297455,
			-.566309,
			-.403802,
			-.174071,
			0,
			.348675,
			.124462,
			-.085623,
			.019517,
			.714828
		],
		weights: [
			[2.989717],
			[3.010635],
			[2.950181],
			[2.436762],
			[1.431808],
			[0],
			[-1.40972],
			[-2.347456],
			[-2.623736],
			[-2.758168],
			[-3.104475]
		]
	},
	lightness: {
		curves: [[
			-.458123,
			.18906,
			-.149799,
			-.157009,
			.021186,
			-.147974
		], [
			5.799194,
			-2.020729,
			1.905469,
			2.032688,
			-.239059,
			1.701378
		]],
		curvesHaveConst: false,
		intercepts: [
			.977967,
			.952294,
			.909201,
			.846658,
			.763273,
			.692807,
			.605046,
			.51816,
			.448356,
			.396948,
			.277692
		],
		weights: [
			[.166643, .012454],
			[.306601, .022974],
			[.489184, .036225],
			[.840901, .062177],
			[1.393735, .103787],
			[1.796533, .136375],
			[1.592201, .123767],
			[.926265, .073292],
			[.717127, .057418],
			[.610052, .048813],
			[.023085, .001605]
		]
	},
	shades: [
		50,
		100,
		200,
		300,
		400,
		500,
		600,
		700,
		800,
		900,
		950
	]
};
//#endregion
//#region src/fitted.ts
const DEG = Math.PI / 180;
/**
* Evaluate one fitted block for a shade row.
*
* @param block The fitted block.
* @param shadeIndex Row index into the model's `shades`.
* @param hue Hue in degrees.
*/
function evaluateFittedBlock(block, shadeIndex, hue) {
	let sum = block.intercepts[shadeIndex];
	for (let k = 0; k < block.curves.length; k++) sum += block.weights[shadeIndex][k] * fourierSeries(block.curves[k], hue, block.curvesHaveConst);
	return sum;
}
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
function fittedOklch(shade, hue, model = MODEL_V2) {
	const s = model.shades.indexOf(shade);
	const l = evaluateFittedBlock(model.lightness, s, hue);
	const c = evaluateFittedBlock(model.chroma, s, hue);
	const drift = model.hueDrift ? evaluateFittedBlock(model.hueDrift, s, hue) : 0;
	return {
		c: Math.max(0, c),
		h: ((hue + drift) % 360 + 360) % 360,
		l: Math.min(1, Math.max(0, l))
	};
}
/**
* Evaluate a Fourier series in hue.
*
* @param coeffs `[const?, a1, b1, a2, b2, …]`.
* @param hue Hue in degrees.
* @param withConst Whether `coeffs` starts with a constant term.
*/
function fourierSeries(coeffs, hue, withConst) {
	let i = 0;
	let sum = withConst ? coeffs[i++] : 0;
	for (let k = 1; i < coeffs.length; k++) {
		sum += coeffs[i++] * Math.cos(k * hue * DEG);
		sum += coeffs[i++] * Math.sin(k * hue * DEG);
	}
	return sum;
}
//#endregion
//#region src/index.ts
const toRgb = converter("rgb");
const symbolicShadeValues = [
	50,
	100,
	200,
	300,
	400,
	500,
	600,
	700,
	800,
	900,
	950
];
const symbolicShadeConfig = {
	50: {
		chromaMultiplier: .3,
		lightness: .95,
		mixWithWhite: .3
	},
	100: {
		chromaMultiplier: .5,
		lightness: .95,
		mixWithWhite: .8
	},
	200: {
		chromaMultiplier: .6,
		lightness: .9
	},
	300: {
		chromaMultiplier: .75,
		lightness: .85
	},
	400: {
		chromaMultiplier: .85,
		lightness: .74
	},
	500: {
		chromaMultiplier: 1,
		lightness: .62
	},
	600: {
		chromaMultiplier: 1.15,
		lightness: .54
	},
	700: {
		chromaMultiplier: 1.1,
		lightness: .49
	},
	800: {
		chromaMultiplier: .85,
		lightness: .42
	},
	900: {
		chromaMultiplier: .7,
		lightness: .37
	},
	950: {
		chromaMultiplier: .5,
		lightness: .29
	}
};
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
function baseChromaByHue(baseHue) {
	return .18 + Math.cos(baseHue * Math.PI / 180) * .04;
}
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
function chromaticColorFrom(baseHue = 200, options = {}) {
	const { alpha = 1, baseChroma = baseChromaByHue(baseHue), brightness = 100, hueOffset = 0, model = "v2", saturation = 100, shade = 500 } = options;
	if (model === "v2") {
		const fitted = fittedOklch(shade, wrapHue(baseHue + hueOffset));
		return colorToChromaticColor(oklch({
			alpha,
			c: Math.max(0, fitted.c * clampPercentToRatio(saturation)),
			h: fitted.h,
			l: Math.min(1, Math.max(0, fitted.l * clampPercentToRatio(brightness))),
			mode: "oklch"
		}));
	}
	const config = symbolicShadeConfig[shade];
	const lightness = Math.min(1, Math.max(0, config.lightness * clampPercentToRatio(brightness)));
	const color = oklch({
		alpha,
		c: Math.max(0, baseChroma * config.chromaMultiplier * clampPercentToRatio(saturation)),
		h: wrapHue(baseHue + hueOffset),
		l: lightness,
		mode: "oklch"
	});
	if (config.mixWithWhite != null) return colorToChromaticColor(mixSrgbWithWhite(color, config.mixWithWhite));
	return colorToChromaticColor(color);
}
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
function chromaticFrom(baseHue = 200, options = {}) {
	let currentHue = baseHue;
	const currentColors = {
		accent: 180,
		neutral: 0,
		primary: 0,
		secondary: 60
	};
	return {
		animateHue: (targetHue, steps = 10, duration = 1e3) => {
			const startHue = currentHue;
			const stepSize = (targetHue - startHue) / steps;
			const stepDuration = duration / steps;
			return new Promise((resolve) => {
				let step = 0;
				const interval = setInterval(() => {
					currentHue = startHue + stepSize * step;
					step++;
					if (step > steps) {
						clearInterval(interval);
						currentHue = targetHue;
						resolve(themeFrom(currentHue, currentColors, options));
					}
				}, stepDuration);
			});
		},
		getScheme: () => themeFrom(currentHue, currentColors, options),
		seasonal: {
			autumn: () => themeFrom(30, currentColors, options),
			spring: () => themeFrom(120, currentColors, options),
			summer: () => themeFrom(45, currentColors, options),
			winter: () => themeFrom(240, currentColors, options)
		},
		setHue: (newHue) => {
			currentHue = newHue;
			return themeFrom(currentHue, currentColors, options);
		}
	};
}
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
function chromaticPaletteFrom(baseHue = 200, baseChroma, options = {}) {
	const { model = "v2" } = options;
	const chroma = model === "v2" ? fittedOklch(500, wrapHue(baseHue)).c : baseChroma ?? baseChromaByHue(baseHue);
	const shadeBy = (shade, alpha = 1, hueOffset = 0) => chromaticColorFrom(baseHue, {
		alpha,
		baseChroma: model === "v2" ? void 0 : chroma,
		hueOffset,
		model,
		shade
	});
	return {
		baseHue,
		chroma,
		getAllShades: (hueOffset = 0, alpha = 1) => {
			const shades = {};
			for (const shadeKey of Object.keys(symbolicShadeConfig)) {
				const shade = Number.parseInt(shadeKey);
				shades[shade] = shadeBy(shade, alpha, hueOffset);
			}
			return shades;
		},
		model,
		shadeBy
	};
}
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
function colorBy(hue, name = "color", options = {}) {
	return themeFrom(hue, { [name]: 0 }, options)[name];
}
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
function mixColors(color1, color2, ratio = .5) {
	const c1 = oklch(color1);
	const c2 = oklch(color2);
	if (!c1 || !c2) throw new Error("Invalid colors provided for mixing");
	return oklch({
		c: c1.c * (1 - ratio) + c2.c * ratio,
		h: mixHues(c1.h ?? 0, c2.h ?? 0, ratio),
		l: c1.l * (1 - ratio) + c2.l * ratio,
		mode: "oklch"
	});
}
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
function themeFrom(baseHue = 200, colors = {}, options = {}) {
	const palette = chromaticPaletteFrom(baseHue, void 0, options);
	const scheme = {};
	for (const [name, hueOffset] of Object.entries(colors)) scheme[name] = palette.getAllShades(hueOffset);
	return {
		...scheme,
		addColor: (name, hueOffset) => themeFrom(baseHue, {
			...colors,
			[name]: hueOffset
		}, options),
		adjustHue: (newBaseHue) => themeFrom(newBaseHue, colors, options),
		getColor: (colorName, shade = 500) => scheme[colorName]?.[shade],
		toCSS: (colorName, shade = 500) => {
			const color = scheme[colorName]?.[shade];
			return color ? formatCss(color.color) : void 0;
		},
		toHex: (colorName, shade = 500) => {
			const color = scheme[colorName]?.[shade];
			return color ? formatHex(color.color) : void 0;
		}
	};
}
function clampChannel(channel) {
	return Math.min(1, Math.max(0, channel));
}
function clampPercentToRatio(value) {
	return Math.min(200, Math.max(0, Number.isFinite(value) ? value : 100)) / 100;
}
function colorToChromaticColor(color) {
	return {
		color,
		toCSS: () => formatCss(color),
		toHex: () => formatHex(color),
		withAlpha: (alpha) => {
			const rgba = oklch(color);
			if (!rgba) throw new Error("Invalid color provided for alpha adjustment");
			return colorToChromaticColor(oklch({
				alpha,
				c: rgba.c,
				h: rgba.h,
				l: rgba.l,
				mode: "oklch"
			}));
		}
	};
}
function mixHues(h1, h2, ratio) {
	let diff = h2 - h1;
	if (diff > 180) diff -= 360;
	if (diff < -180) diff += 360;
	return (h1 + diff * ratio + 360) % 360;
}
function mixSrgbWithWhite(color, baseRatio) {
	const rgb = toRgb(color);
	if (!rgb) throw new Error("Invalid color provided for rgb conversion");
	const whiteRatio = 1 - baseRatio;
	return {
		alpha: rgb.alpha,
		b: clampChannel(rgb.b * baseRatio + whiteRatio),
		g: clampChannel(rgb.g * baseRatio + whiteRatio),
		mode: "rgb",
		r: clampChannel(rgb.r * baseRatio + whiteRatio)
	};
}
function wrapHue(hue) {
	return (hue % 360 + 360) % 360;
}
//#endregion
export { MODEL_V2, baseChromaByHue, chromaticColorFrom, chromaticFrom, chromaticPaletteFrom, colorBy, evaluateFittedBlock, fittedOklch, fourierSeries, mixColors, symbolicShadeConfig, symbolicShadeValues, themeFrom };
