import { ChromaticModel } from "@lingbo/chromatic";
//#region ../../node_modules/.pnpm/magic-string@0.30.21/node_modules/magic-string/dist/magic-string.es.d.mts
interface SourceMapOptions {
  /**
   * Whether the mapping should be high-resolution.
   * Hi-res mappings map every single character, meaning (for example) your devtools will always
   * be able to pinpoint the exact location of function calls and so on.
   * With lo-res mappings, devtools may only be able to identify the correct
   * line - but they're quicker to generate and less bulky.
   * You can also set `"boundary"` to generate a semi-hi-res mappings segmented per word boundary
   * instead of per character, suitable for string semantics that are separated by words.
   * If sourcemap locations have been specified with s.addSourceMapLocation(), they will be used here.
   */
  hires?: boolean | 'boundary';
  /**
   * The filename where you plan to write the sourcemap.
   */
  file?: string;
  /**
   * The filename of the file containing the original source.
   */
  source?: string;
  /**
   * Whether to include the original content in the map's sourcesContent array.
   */
  includeContent?: boolean;
}
type SourceMapSegment = [number] | [number, number, number, number] | [number, number, number, number, number];
interface DecodedSourceMap {
  file: string;
  sources: string[];
  sourcesContent?: string[];
  names: string[];
  mappings: SourceMapSegment[][];
  x_google_ignoreList?: number[];
}
declare class SourceMap {
  constructor(properties: DecodedSourceMap);
  version: number;
  file: string;
  sources: string[];
  sourcesContent?: string[];
  names: string[];
  mappings: string;
  x_google_ignoreList?: number[];
  debugId?: string;
  /**
   * Returns the equivalent of `JSON.stringify(map)`
   */
  toString(): string;
  /**
   * Returns a DataURI containing the sourcemap. Useful for doing this sort of thing:
   * `generateMap(options?: SourceMapOptions): SourceMap;`
   */
  toUrl(): string;
}
type ExclusionRange = [number, number];
interface MagicStringOptions {
  filename?: string;
  indentExclusionRanges?: ExclusionRange | Array<ExclusionRange>;
  offset?: number;
}
interface IndentOptions {
  exclude?: ExclusionRange | Array<ExclusionRange>;
  indentStart?: boolean;
}
interface OverwriteOptions {
  storeName?: boolean;
  contentOnly?: boolean;
}
interface UpdateOptions {
  storeName?: boolean;
  overwrite?: boolean;
}
declare class MagicString {
  constructor(str: string, options?: MagicStringOptions);
  /**
   * Adds the specified character index (with respect to the original string) to sourcemap mappings, if `hires` is false.
   */
  addSourcemapLocation(char: number): void;
  /**
   * Appends the specified content to the end of the string.
   */
  append(content: string): this;
  /**
   * Appends the specified content at the index in the original string.
   * If a range *ending* with index is subsequently moved, the insert will be moved with it.
   * See also `s.prependLeft(...)`.
   */
  appendLeft(index: number, content: string): this;
  /**
   * Appends the specified content at the index in the original string.
   * If a range *starting* with index is subsequently moved, the insert will be moved with it.
   * See also `s.prependRight(...)`.
   */
  appendRight(index: number, content: string): this;
  /**
   * Does what you'd expect.
   */
  clone(): this;
  /**
   * Generates a version 3 sourcemap.
   */
  generateMap(options?: SourceMapOptions): SourceMap;
  /**
   * Generates a sourcemap object with raw mappings in array form, rather than encoded as a string.
   * Useful if you need to manipulate the sourcemap further, but most of the time you will use `generateMap` instead.
   */
  generateDecodedMap(options?: SourceMapOptions): DecodedSourceMap;
  getIndentString(): string;
  /**
   * Prefixes each line of the string with prefix.
   * If prefix is not supplied, the indentation will be guessed from the original content, falling back to a single tab character.
   */
  indent(options?: IndentOptions): this;
  /**
   * Prefixes each line of the string with prefix.
   * If prefix is not supplied, the indentation will be guessed from the original content, falling back to a single tab character.
   *
   * The options argument can have an exclude property, which is an array of [start, end] character ranges.
   * These ranges will be excluded from the indentation - useful for (e.g.) multiline strings.
   */
  indent(indentStr?: string, options?: IndentOptions): this;
  indentExclusionRanges: ExclusionRange | Array<ExclusionRange>;
  /**
   * Moves the characters from `start` and `end` to `index`.
   */
  move(start: number, end: number, index: number): this;
  /**
   * Replaces the characters from `start` to `end` with `content`, along with the appended/prepended content in
   * that range. The same restrictions as `s.remove()` apply.
   *
   * The fourth argument is optional. It can have a storeName property — if true, the original name will be stored
   * for later inclusion in a sourcemap's names array — and a contentOnly property which determines whether only
   * the content is overwritten, or anything that was appended/prepended to the range as well.
   *
   * It may be preferred to use `s.update(...)` instead if you wish to avoid overwriting the appended/prepended content.
   */
  overwrite(start: number, end: number, content: string, options?: boolean | OverwriteOptions): this;
  /**
   * Replaces the characters from `start` to `end` with `content`. The same restrictions as `s.remove()` apply.
   *
   * The fourth argument is optional. It can have a storeName property — if true, the original name will be stored
   * for later inclusion in a sourcemap's names array — and an overwrite property which determines whether only
   * the content is overwritten, or anything that was appended/prepended to the range as well.
   */
  update(start: number, end: number, content: string, options?: boolean | UpdateOptions): this;
  /**
   * Prepends the string with the specified content.
   */
  prepend(content: string): this;
  /**
   * Same as `s.appendLeft(...)`, except that the inserted content will go *before* any previous appends or prepends at index
   */
  prependLeft(index: number, content: string): this;
  /**
   * Same as `s.appendRight(...)`, except that the inserted content will go *before* any previous appends or prepends at `index`
   */
  prependRight(index: number, content: string): this;
  /**
   * Removes the characters from `start` to `end` (of the original string, **not** the generated string).
   * Removing the same content twice, or making removals that partially overlap, will cause an error.
   */
  remove(start: number, end: number): this;
  /**
   * Reset the modified characters from `start` to `end` (of the original string, **not** the generated string).
   */
  reset(start: number, end: number): this;
  /**
   * Returns the content of the generated string that corresponds to the slice between `start` and `end` of the original string.
   * Throws error if the indices are for characters that were already removed.
   */
  slice(start: number, end: number): string;
  /**
   * Returns a clone of `s`, with all content before the `start` and `end` characters of the original string removed.
   */
  snip(start: number, end: number): this;
  /**
   * Trims content matching `charType` (defaults to `\s`, i.e. whitespace) from the start and end.
   */
  trim(charType?: string): this;
  /**
   * Trims content matching `charType` (defaults to `\s`, i.e. whitespace) from the start.
   */
  trimStart(charType?: string): this;
  /**
   * Trims content matching `charType` (defaults to `\s`, i.e. whitespace) from the end.
   */
  trimEnd(charType?: string): this;
  /**
   * Removes empty lines from the start and end.
   */
  trimLines(): this;
  /**
   * String replacement with RegExp or string.
   */
  replace(regex: RegExp | string, replacement: string | ((substring: string, ...args: any[]) => string)): this;
  /**
   * Same as `s.replace`, but replace all matched strings instead of just one.
   */
  replaceAll(regex: RegExp | string, replacement: string | ((substring: string, ...args: any[]) => string)): this;
  lastChar(): string;
  lastLine(): string;
  /**
   * Returns true if the resulting source is empty (disregarding white space).
   */
  isEmpty(): boolean;
  length(): number;
  /**
   * Indicates if the string has been changed.
   */
  hasChanged(): boolean;
  original: string;
  /**
   * Returns the generated string.
   */
  toString(): string;
  offset: number;
}
//#endregion
//#region ../../node_modules/.pnpm/unconfig@7.5.0/node_modules/unconfig/dist/types-BP4WUQ7G.d.mts
interface LoadConfigResult<T> {
  config: T;
  sources: string[];
  dependencies?: string[];
}
//#endregion
//#region ../../node_modules/.pnpm/@unocss+core@66.7.5/node_modules/@unocss/core/dist/index.d.mts
//#endregion
//#region src/utils/countable-set.d.ts
declare class CountableSet<K> extends Set<K> {
  _map: Map<K, number>;
  constructor(values?: Iterable<K>);
  add(key: K): this;
  delete(key: K): boolean;
  clear(): void;
  getCount(key: K): number;
  setCount(key: K, count: number): this;
}
//#endregion
//#region src/utils/events.d.ts
type EventsMap = Record<string, any>;
interface DefaultEvents extends EventsMap {
  [event: string]: (...args: any) => void;
}
interface Unsubscribe {
  (): void;
}
declare class Emitter<Events extends EventsMap = DefaultEvents> {
  /**
   * Event names in keys and arrays with listeners in values.
   *
   * ```js
   * emitter1.events = emitter2.events
   * emitter2.events = { }
   * ```
   */
  events: Partial<{ [E in keyof Events]: Events[E][]; }>;
  /**
   * Add a listener for a given event.
   *
   * ```js
   * const unbind = ee.on('tick', (tickType, tickDuration) => {
   *   count += 1
   * })
   *
   * disable () {
   *   unbind()
   * }
   * ```
   *
   * @param event The event name.
   * @param cb The listener function.
   * @returns Unbind listener from event.
   */
  on<K extends keyof Events>(this: this, event: K, cb: Events[K]): Unsubscribe;
  /**
   * Calls each of the listeners registered for a given event.
   *
   * ```js
   * ee.emit('tick', tickType, tickDuration)
   * ```
   *
   * @param event The event name.
   * @param args The arguments for listeners.
   */
  emit<K extends keyof Events>(this: this, event: K, ...args: Parameters<Events[K]>): void;
}
declare class BetterMap<K, V> extends Map<K, V> {
  getFallback(key: K, fallback: V): V;
  map<R>(mapFn: (value: V, key: K) => R): R[];
  flatMap<R extends readonly unknown[]>(mapFn: (value: V, key: K) => R): R[number][];
}
declare class UnoGeneratorInternal<Theme extends object = object> {
  userConfig: UserConfig<Theme>;
  defaults: UserConfigDefaults<Theme>;
  readonly version: string;
  readonly events: Emitter<{
    config: (config: ResolvedConfig<Theme>) => void;
  }>;
  config: ResolvedConfig<Theme>;
  cache: Map<string, StringifiedUtil<Theme>[] | null>;
  blocked: Set<string>;
  parentOrders: Map<string, number>;
  activatedRules: Set<Rule<Theme>>;
  protected constructor(userConfig?: UserConfig<Theme>, defaults?: UserConfigDefaults<Theme>);
  static create<Theme extends object = object>(userConfig?: UserConfig<Theme>, defaults?: UserConfigDefaults<Theme>): Promise<UnoGeneratorInternal<Theme>>;
  setConfig(userConfig?: UserConfig<Theme>, defaults?: UserConfigDefaults<Theme>): Promise<void>;
  applyExtractors(code: string, id?: string, extracted?: Set<string>): Promise<Set<string>>;
  applyExtractors(code: string, id?: string, extracted?: CountableSet<string>): Promise<CountableSet<string>>;
  makeContext(raw: string, applied: VariantMatchedResult<Theme>): RuleContext<Theme>;
  parseToken(raw: string, alias?: string): Promise<StringifiedUtil<Theme>[] | undefined | null>;
  generate(input: string | Set<string> | CountableSet<string> | string[], options?: GenerateOptions<false>): Promise<GenerateResult<Set<string>>>;
  generate(input: string | Set<string> | CountableSet<string> | string[], options?: GenerateOptions<true>): Promise<GenerateResult<Map<string, ExtendedTokenInfo<Theme>>>>;
  matchVariants(raw: string, current?: string): Promise<readonly VariantMatchedResult<Theme>[]>;
  private applyVariants;
  constructCustomCSS(context: Readonly<RuleContext<Theme>>, body: CSSObject | CSSEntries, overrideSelector?: string): string;
  parseUtil(input: string | VariantMatchedResult<Theme>, context: RuleContext<Theme>, internal?: boolean, shortcutPrefix?: string | string[] | undefined): Promise<(ParsedUtil | RawUtil)[] | undefined>;
  private resolveCSSResult;
  stringifyUtil(parsed?: ParsedUtil | RawUtil, context?: RuleContext<Theme>): StringifiedUtil<Theme>[] | undefined;
  expandShortcut(input: string, context: RuleContext<Theme>, depth?: number, skipVariantMatch?: boolean): Promise<[(string | ShortcutInlineValue)[], RuleMeta | undefined] | undefined>;
  stringifyShortcuts(parent: VariantMatchedResult<Theme>, context: RuleContext<Theme>, expanded: (string | ShortcutInlineValue)[], meta?: RuleMeta): Promise<StringifiedUtil<Theme>[] | undefined>;
  isBlocked(raw: string): boolean;
  getBlocked(raw: string): [BlocklistValue, BlocklistMeta | undefined] | undefined;
}
declare class UnoGenerator<Theme extends object = object> extends UnoGeneratorInternal<Theme> {
  /**
   * @deprecated `new UnoGenerator` is deprecated, please use `createGenerator()` instead
   */
  constructor(userConfig?: UserConfig<Theme>, defaults?: UserConfigDefaults<Theme>);
}
//#endregion
//#region src/types.d.ts
type Awaitable<T> = T | Promise<T>;
type Arrayable<T> = T | T[];
type FlatObjectTuple<T> = { [K in keyof T]: T[K]; };
type RequiredByKey<T, K extends keyof T = keyof T> = FlatObjectTuple<Required<Pick<T, Extract<keyof T, K>>> & Omit<T, K>>;
type CSSObject = Record<string, string | number | undefined>;
/**
 * [property, value, operators?]
 *
 * - operators: Used to perform specific operations on value or property.
 */
type CSSEntry = [string, string | number | undefined, Arrayable<string>?];
type CSSEntries = CSSEntry[];
type CSSObjectInput = CSSObject | Partial<ControlSymbolsValue>;
type CSSEntriesInput = (CSSEntry | ControlSymbolsEntry)[];
type CSSValueInput = CSSObjectInput | CSSEntriesInput | CSSValue;
type PresetOptions = Record<string, any>;
interface RuleContext<Theme extends object = object> {
  /**
   * Unprocessed selector from user input.
   * Useful for generating CSS rule.
   */
  rawSelector: string;
  /**
   * Current selector for rule matching
   */
  currentSelector: string;
  /**
   * UnoCSS generator instance
   */
  generator: UnoGenerator<Theme>;
  /**
   * Symbols for special handling
   */
  symbols: ControlSymbols;
  /**
   * The theme object
   */
  theme: Theme;
  /**
   * Matched variants handlers for this rule.
   */
  variantHandlers: VariantHandler[];
  /**
   * The result of variant matching.
   */
  variantMatch: VariantMatchedResult<Theme>;
  /**
   * Construct a custom CSS rule.
   * Variants and selector escaping will be handled automatically.
   */
  constructCSS: (body: CSSEntries | CSSObject, overrideSelector?: string) => string;
  /**
   * Available only when `details` option is enabled.
   */
  rules?: Rule<Theme>[];
  /**
   * Available only when `details` option is enabled.
   */
  shortcuts?: Shortcut<Theme>[];
  /**
   * Available only when `details` option is enabled.
   */
  variants?: Variant<Theme>[];
}
declare const SymbolShortcutsNoMerge: unique symbol;
declare const SymbolNoMerge: unique symbol;
declare const SymbolNoScope: unique symbol;
declare const SymbolVariants: unique symbol;
declare const SymbolParent: unique symbol;
declare const SymbolSelector: unique symbol;
declare const SymbolLayer: unique symbol;
declare const SymbolSort: unique symbol;
declare const SymbolBody: unique symbol;
interface ControlSymbols {
  /**
   * Prevent merging in shortcuts
   */
  shortcutsNoMerge: typeof SymbolShortcutsNoMerge;
  /**
   * Prevent merging in rules
   */
  noMerge: typeof SymbolNoMerge;
  /**
   * Prevent applying the `scope` option to this rule/selector
   */
  noScope: typeof SymbolNoScope;
  /**
   * Additional variants applied to this rule
   */
  variants: typeof SymbolVariants;
  /**
   * Parent selector (`@media`, `@supports`, etc.)
   */
  parent: typeof SymbolParent;
  /**
   * Selector modifier
   */
  selector: typeof SymbolSelector;
  /**
   * Layer modifier
   */
  layer: typeof SymbolLayer;
  /**
   * Sort modifier
   */
  sort: typeof SymbolSort;
  /**
   * Custom css body modifier
   */
  body: typeof SymbolBody;
}
interface ControlSymbolsValue {
  [SymbolShortcutsNoMerge]: true;
  [SymbolNoMerge]: true;
  [SymbolNoScope]: true;
  [SymbolVariants]: VariantHandler[] | ((handlers: VariantHandler[]) => VariantHandler[]);
  [SymbolParent]: string;
  [SymbolSelector]: (selector: string) => string;
  [SymbolLayer]: string;
  [SymbolSort]: number;
  [SymbolBody]: string;
}
type ObjectToEntry<T> = { [K in keyof T]: [K, T[K]]; }[keyof T];
type ControlSymbolsEntry = ObjectToEntry<ControlSymbolsValue>;
interface VariantContext<Theme extends object = object> {
  /**
   * Unprocessed selector from user input.
   */
  rawSelector: string;
  /**
   * UnoCSS generator instance
   */
  generator: UnoGenerator<Theme>;
  /**
   * The theme object
   */
  theme: Theme;
}
interface ExtractorContext {
  readonly original: string;
  code: string;
  id?: string;
  extracted: Set<string> | CountableSet<string>;
  envMode?: 'dev' | 'build';
}
interface BaseContext<Theme extends object = object> {
  /**
   * UnoCSS generator instance
   */
  generator: UnoGenerator<Theme>;
  /**
   * The theme object
   */
  theme: Theme;
}
interface PreflightContext<Theme extends object = object> extends BaseContext<Theme> {}
interface SafeListContext<Theme extends object = object> extends BaseContext<Theme> {}
interface Extractor {
  name: string;
  order?: number;
  /**
   * Extract the code and return a list of selectors.
   *
   * Return `undefined` to skip this extractor.
   */
  extract?: (ctx: ExtractorContext) => Awaitable<Set<string> | CountableSet<string> | string[] | undefined | void>;
}
interface RuleMeta {
  /**
   * The layer name of this rule.
   * @default 'default'
   */
  layer?: string;
  /**
   * Option to not merge this selector even if the body are the same.
   * @default false
   */
  noMerge?: boolean;
  /**
   * Option to not apply scope to this selector.
   * @default false
   */
  noScope?: boolean;
  /**
   * Fine tune sort
   */
  sort?: number;
  /**
   * Templates to provide autocomplete suggestions
   */
  autocomplete?: Arrayable<AutoCompleteTemplate>;
  /**
   * Matching prefix before this util
   */
  prefix?: string | string[];
  /**
   * Internal rules will only be matched for shortcuts but not the user code.
   * @default false
   */
  internal?: boolean;
  /**
   * Store the hash of the rule boy
   *
   * @internal
   * @private
   */
  __hash?: string;
  /**
   * Internal index of the rulelist
   * @internal
   * @private
   */
  __index?: number;
  /**
   * Custom metadata
   */
  custom?: Record<string, any>;
}
type CSSValue = CSSObject | CSSEntries;
type DynamicMatcher<Theme extends object = object> = (match: RegExpMatchArray, context: Readonly<RuleContext<Theme>>) => Awaitable<CSSValueInput | string | (CSSValueInput | string)[] | undefined> | Generator<CSSValueInput | string | undefined> | AsyncGenerator<CSSValueInput | string | undefined>;
type DynamicRule<Theme extends object = object> = [RegExp, DynamicMatcher<Theme>, RuleMeta?];
type StaticRule = [string, CSSObject | CSSEntries | (CSSValueInput | string)[], RuleMeta?];
type Rule<Theme extends object = object> = DynamicRule<Theme> | StaticRule;
type DynamicShortcutMatcher<Theme extends object = object> = ((match: RegExpMatchArray, context: Readonly<RuleContext<Theme>>) => (string | ShortcutValue[] | undefined));
type StaticShortcut = [string, string | ShortcutValue[], RuleMeta?];
type StaticShortcutMap = Record<string, string | ShortcutValue[]>;
type DynamicShortcut<Theme extends object = object> = [RegExp, DynamicShortcutMatcher<Theme>, RuleMeta?];
type UserShortcuts<Theme extends object = object> = StaticShortcutMap | (StaticShortcut | DynamicShortcut<Theme> | StaticShortcutMap)[];
type Shortcut<Theme extends object = object> = StaticShortcut | DynamicShortcut<Theme>;
interface ShortcutInlineValue {
  handles: VariantHandler[];
  value: ShortcutValue;
}
type ShortcutValue = string | CSSValue;
type FilterPattern = ReadonlyArray<string | RegExp> | string | RegExp | null;
interface Preflight<Theme extends object = object> {
  getCSS: (context: PreflightContext<Theme>) => Promise<string | undefined> | string | undefined;
  layer?: string;
}
interface BlocklistMeta {
  /**
   * Custom message to show why this selector is blocked.
   */
  message?: string | ((selector: string) => string);
}
type BlocklistValue = string | RegExp | ((selector: string) => boolean | null | undefined);
type BlocklistRule = BlocklistValue | [BlocklistValue, BlocklistMeta];
interface VariantHandlerContext {
  /**
   * Rewrite the output selector. Often be used to append parents.
   */
  prefix: string;
  /**
   * Rewrite the output selector. Often be used to append pseudo classes.
   */
  selector: string;
  /**
   * Rewrite the output selector. Often be used to append pseudo elements.
   */
  pseudo: string;
  /**
   * Rewrite the output css body. The input come in [key,value][] pairs.
   */
  entries: CSSEntries;
  /**
   * Provide a parent selector(e.g. media query) to the output css.
   */
  parent?: string;
  /**
   * Provide order to the `parent` parent selector within layer.
   */
  parentOrder?: number;
  /**
   * Override layer to the output css.
   */
  layer?: string;
  /**
   * Order in which the variant is sorted within single rule.
   */
  sort?: number;
  /**
   * Option to not merge the resulting entries even if the body are the same.
   * @default false
   */
  noMerge?: boolean;
}
interface VariantHandler {
  /**
   * Callback to process the handler.
   */
  handle?: (input: VariantHandlerContext, next: (input: VariantHandlerContext) => VariantHandlerContext) => VariantHandlerContext;
  /**
   * The result rewritten selector for the next round of matching
   */
  matcher?: string;
  /**
   * Order in which the variant is applied to selector.
   */
  order?: number;
  /**
   * Rewrite the output selector. Often be used to append pseudo classes or parents.
   */
  selector?: (input: string, body: CSSEntries) => string | undefined;
  /**
   * Rewrite the output css body. The input come in [key,value][] pairs.
   */
  body?: (body: CSSEntries) => CSSEntries | undefined;
  /**
   * Provide a parent selector(e.g. media query) to the output css.
   */
  parent?: string | [string, number] | undefined;
  /**
   * Order in which the variant is sorted within single rule.
   */
  sort?: number;
  /**
   * Override layer to the output css.
   */
  layer?: string | undefined;
}
type VariantFunction<Theme extends object = object> = (matcher: string, context: Readonly<VariantContext<Theme>>) => Awaitable<string | VariantHandler | VariantHandler[] | undefined>;
interface VariantObject<Theme extends object = object> {
  /**
   * The name of the variant.
   */
  name?: string;
  /**
   * The entry function to match and rewrite the selector for further processing.
   */
  match: VariantFunction<Theme>;
  /**
   * Sort for when the match is applied.
   */
  order?: number;
  /**
   * Allows this variant to be used more than once in matching a single rule
   *
   * @default false
   */
  multiPass?: boolean;
  /**
   * Custom function for auto complete
   */
  autocomplete?: Arrayable<AutoCompleteFunction | AutoCompleteTemplate>;
}
type Variant<Theme extends object = object> = VariantFunction<Theme> | VariantObject<Theme>;
type Preprocessor = (matcher: string) => string | undefined;
type Postprocessor = (util: UtilObject) => void | UtilObject | (UtilObject | null | undefined)[];
type ThemeExtender<Theme extends object = object> = (theme: Theme, config: Readonly<ResolvedConfig<Theme>>) => Theme | void;
interface ConfigBase<Theme extends object = object> {
  /**
   * Rules to generate CSS utilities.
   *
   * Later entries have higher priority.
   */
  rules?: Rule<Theme>[];
  /**
   * Variant separator
   *
   * @default [':', '-']
   */
  separators?: Arrayable<string>;
  /**
   * Variants that preprocess the selectors,
   * having the ability to rewrite the CSS object.
   */
  variants?: Variant<Theme>[];
  /**
   * Similar to Windi CSS's shortcuts,
   * allows you have create new utilities by combining existing ones.
   *
   * Later entries have higher priority.
   */
  shortcuts?: UserShortcuts<Theme>;
  /**
   * Rules to exclude the selectors for your design system (to narrow down the possibilities).
   * Combining `warnExcluded` options it can also help you identify wrong usages.
   */
  blocklist?: BlocklistRule[];
  /**
   * Utilities that always been included
   */
  safelist?: (string | ((context: SafeListContext<Theme>) => Arrayable<string>))[];
  /**
   * Extractors to handle the source file and outputs possible classes/selectors
   * Can be language-aware.
   */
  extractors?: Extractor[];
  /**
   * Default extractor that are always applied.
   * By default it split the source code by whitespace and quotes.
   *
   * It maybe be replaced by preset or user config,
   * only one default extractor can be presented,
   * later one will override the previous one.
   *
   * Pass `null` or `false` to disable the default extractor.
   *
   * @see https://github.com/unocss/unocss/blob/main/packages-engine/core/src/extractors/split.ts
   * @default import('@unocss/core').defaultExtractor
   */
  extractorDefault?: Extractor | null | false;
  /**
   * Raw CSS injections.
   */
  preflights?: Preflight<Theme>[];
  /**
   * Theme object for shared configuration between rules
   */
  theme?: Theme;
  /**
   * Layer orders. Default to 0.
   */
  layers?: Record<string, number>;
  /**
   * Output the internal layers as CSS Cascade Layers.
   */
  outputToCssLayers?: boolean | OutputCssLayersOptions;
  /**
   * Custom function to sort layers.
   */
  sortLayers?: (layers: string[]) => string[];
  /**
   * Preprocess the incoming utilities, return falsy value to exclude
   */
  preprocess?: Arrayable<Preprocessor>;
  /**
   * Postprocess the generate utils object
   */
  postprocess?: Arrayable<Postprocessor>;
  /**
   * Custom functions mutate the theme object.
   *
   * It's also possible to return a new theme object to completely replace the original one.
   */
  extendTheme?: Arrayable<ThemeExtender<Theme>>;
  /**
   * Presets
   */
  presets?: (PresetOrFactoryAwaitable<Theme> | PresetOrFactoryAwaitable<Theme>[])[];
  /**
   * Additional options for auto complete
   */
  autocomplete?: {
    /**
     * Custom functions / templates to provide autocomplete suggestions
     */
    templates?: Arrayable<AutoCompleteFunction | AutoCompleteTemplate>;
    /**
     * Custom extractors to pickup possible classes and
     * transform class-name style suggestions to the correct format
     */
    extractors?: Arrayable<AutoCompleteExtractor>;
    /**
     * Custom shorthands to provide autocomplete suggestions.
     * if values is an array, it will be joined with `|` and wrapped with `()`
     */
    shorthands?: Record<string, string | string[]>;
  };
  /**
   * Hook to modify the resolved config.
   *
   * First presets runs first and the user config
   */
  configResolved?: (config: ResolvedConfig<Theme>) => void;
  /**
   * Expose internal details for debugging / inspecting
   *
   * Added `rules`, `shortcuts`, `variants` to the context and expose the context object in `StringifiedUtil`
   *
   * You don't usually need to set this.
   *
   * @default `true` when `envMode` is `dev`, otherwise `false`
   */
  details?: boolean;
  /**
   * Options for sources to be extracted as utilities usages.
   *
   */
  content?: ContentOptions;
  /**
   * Custom transformers to the source code.
   */
  transformers?: SourceCodeTransformer[];
}
interface OutputCssLayersOptions {
  /**
   * Specify the css layer that the internal layer should be output to.
   *
   * Return `null` to specify that the layer should not be output to any css layer.
   */
  cssLayerName?: (internalLayer: string) => string | undefined | null;
  /**
   * Force output all css layers, even if they are not used.
   *
   * @example `@layer theme, preflights, [unused-layer], default;`
   */
  allLayers?: boolean;
}
type AutoCompleteTemplate = string;
type AutoCompleteFunction = (input: string) => Awaitable<string[]>;
interface AutoCompleteExtractorContext {
  content: string;
  cursor: number;
}
interface Replacement {
  /**
   * The range of the original text
   */
  start: number;
  end: number;
  /**
   * The text used to replace
   */
  replacement: string;
}
interface AutoCompleteExtractorResult {
  /**
   * The extracted string
   */
  extracted: string;
  /**
   * The function to convert the selected suggestion back
   */
  resolveReplacement: (suggestion: string) => Replacement;
  /**
   * The function to format suggestions
   */
  transformSuggestions?: (suggestions: string[]) => string[];
}
interface AutoCompleteExtractor {
  name: string;
  extract: (context: AutoCompleteExtractorContext) => Awaitable<AutoCompleteExtractorResult | null>;
  order?: number;
}
interface Preset<Theme extends object = object> extends ConfigBase<Theme> {
  name: string;
  /**
   * Enforce the preset to be applied before or after other presets
   */
  enforce?: 'pre' | 'post';
  /**
   * Preset options for other tools like IDE to consume
   */
  options?: PresetOptions;
  /**
   * Apply prefix to all utilities and shortcuts
   */
  prefix?: string | string[];
  /**
   * Apply layer to all utilities and shortcuts
   */
  layer?: string;
  /**
   * Custom API endpoint for cross-preset communication
   */
  api?: any;
  /**
   * Custom metadata for the preset
   */
  meta?: Record<string, any>;
}
type PresetFactory<Theme extends object = object, PresetOptions extends object | undefined = undefined> = (options?: PresetOptions) => Preset<Theme>;
type PresetFactoryAwaitable<Theme extends object = object, PresetOptions extends object | undefined = undefined> = (options?: PresetOptions) => Awaitable<Preset<Theme>>;
type PresetOrFactory<Theme extends object = object> = Preset<Theme> | PresetFactory<Theme, any>;
type PresetOrFactoryAwaitable<Theme extends object = object> = PresetOrFactory<Theme> | Promise<Preset<Theme>> | PresetFactoryAwaitable<Theme>;
interface GeneratorOptions {
  /**
   * Merge utilities with the exact same body to save the file size
   *
   * @default true
   */
  mergeSelectors?: boolean;
  /**
   * Emit warning when matched selectors are presented in blocklist
   *
   * @default true
   */
  warn?: boolean;
}
interface UserOnlyOptions<Theme extends object = object> {
  /**
   * The theme object, will be merged with the theme provides by presets
   */
  theme?: Theme;
  /**
   * Layout name of shortcuts
   *
   * @default 'shortcuts'
   */
  shortcutsLayer?: string;
  /**
   * Environment mode
   *
   * @default 'build'
   */
  envMode?: 'dev' | 'build';
  /**
   * legacy.renderModernChunks need to be consistent with @vitejs/plugin-legacy
   */
  legacy?: {
    renderModernChunks: boolean;
  };
  /**
   * Custom prefix for virtual modules
   *
   * @default '__uno'
   */
  virtualModulePrefix?: string;
}
/**
 * For unocss-cli config
 */
interface CliOptions {
  cli?: {
    entry?: Arrayable<CliEntryItem>;
  };
}
interface UnocssPluginContext<Config extends UserConfig = UserConfig> {
  /**
   * Singleton promise for config loading
   */
  ready: Promise<LoadConfigResult<Config>>;
  /**
   * The UnoCSS generator instance. Should be used after `ready` resolved.
   */
  uno: UnoGenerator;
  /**
   * All tokens scanned
   */
  tokens: Set<string>;
  /**
   * Map for all module's raw content
   */
  modules: BetterMap<string, string>;
  /**
   * Module IDs that been affected by UnoCSS
   */
  affectedModules: Set<string>;
  /**
   *  Pending promises
   */
  tasks: Promise<any>[];
  /**
   * Await all pending tasks
   */
  flushTasks: () => Promise<any>;
  filter: (code: string, id: string) => boolean;
  extract: (code: string, id?: string) => Promise<void>;
  reloadConfig: () => Promise<LoadConfigResult<Config>>;
  getConfig: () => Promise<Config>;
  onReload: (fn: () => void) => void;
  invalidate: () => void;
  onInvalidate: (fn: () => void) => void;
  root: string;
  updateRoot: (root: string) => Promise<LoadConfigResult<Config>>;
  getConfigFileList: () => string[];
  /**
   * Get regexes to match virtual module ids
   */
  getVMPRegexes: () => Promise<{
    prefix: string;
    RESOLVED_ID_WITH_QUERY_RE: RegExp;
    RESOLVED_ID_RE: RegExp;
  }>;
}
interface HighlightAnnotation {
  offset: number;
  length: number;
  className: string;
}
type SourceCodeTransformerEnforce = 'pre' | 'post' | 'default';
interface SourceCodeTransformer {
  name: string;
  /**
   * The order of transformer
   */
  enforce?: SourceCodeTransformerEnforce;
  /**
   * Custom id filter, if not provided, the extraction filter will be applied
   */
  idFilter?: (id: string) => boolean;
  /**
   * Cheap source filter evaluated before creating a MagicString instance.
   *
   * It must return true for every source the transformer may modify.
   */
  codeFilter?: (code: string, id: string) => boolean;
  /**
   * The transform function
   */
  transform: (code: MagicString, id: string, ctx: UnocssPluginContext) => Awaitable<{
    highlightAnnotations?: HighlightAnnotation[];
  } | void>;
}
interface ContentOptions {
  /**
   * Glob patterns to extract from the file system, in addition to other content sources.
   *
   * In dev mode, the files will be watched and trigger HMR.
   *
   * @default []
   */
  filesystem?: string[];
  /**
   * Inline text to be extracted
   */
  inline?: (string | {
    code: string;
    id?: string;
  } | (() => Awaitable<string | {
    code: string;
    id?: string;
  }>))[];
  /**
   * Filters to determine whether to extract certain modules from the build tools' transformation pipeline.
   *
   * Currently only works for Vite and Webpack integration.
   *
   * Set `false` to disable.
   */
  pipeline?: false | {
    /**
     * Patterns that filter the files being extracted.
     * Supports regular expressions and `picomatch` glob patterns.
     *
     * By default, `.ts` and `.js` files are NOT extracted.
     *
     * @see https://www.npmjs.com/package/picomatch
     * @default [/\.(vue|svelte|[jt]sx|vine.ts|mdx?|astro|elm|php|phtml|marko|html)($|\?)/]
     */
    include?: FilterPattern;
    /**
     * Patterns that filter the files NOT being extracted.
     * Supports regular expressions and `picomatch` glob patterns.
     *
     * By default, `node_modules` and `dist` are also extracted.
     *
     * @see https://www.npmjs.com/package/picomatch
     * @default [/\.(css|postcss|sass|scss|less|stylus|styl)($|\?)/]
     */
    exclude?: FilterPattern;
  };
}
/**
 * For other modules to aggregate the options
 */
interface PluginOptions {
  /**
   * Load from configs files
   *
   * set `false` to disable
   */
  configFile?: string | false;
  /**
   * List of files that will also trigger config reloads
   */
  configDeps?: string[];
  /**
   * Custom transformers to the source code
   */
  transformers?: SourceCodeTransformer[];
  /**
   * Options for sources to be extracted as utilities usages
   *
   * Supported sources:
   * - `filesystem` - extract from file system
   * - `inline` - extract from plain inline text
   * - `pipeline` - extract from build tools' transformation pipeline, such as Vite and Webpack
   *
   * The usage extracted from each source will be **merged** together.
   */
  content?: ContentOptions;
}
interface UserConfig<Theme extends object = object> extends ConfigBase<Theme>, UserOnlyOptions<Theme>, GeneratorOptions, PluginOptions, CliOptions {}
interface UserConfigDefaults<Theme extends object = object> extends ConfigBase<Theme>, UserOnlyOptions<Theme> {}
interface ResolvedConfig<Theme extends object = object> extends Omit<RequiredByKey<UserConfig<Theme>, 'mergeSelectors' | 'theme' | 'rules' | 'variants' | 'layers' | 'extractors' | 'blocklist' | 'safelist' | 'preflights' | 'sortLayers'>, 'rules' | 'shortcuts' | 'autocomplete' | 'presets'> {
  presets: Preset<Theme>[];
  shortcuts: Shortcut<Theme>[];
  variants: VariantObject<Theme>[];
  preprocess: Preprocessor[];
  postprocess: Postprocessor[];
  rulesSize: number;
  rules: readonly Rule<Theme>[];
  rulesDynamic: readonly DynamicRule<Theme>[];
  /**
   * Prefilter for dynamic rules.
   * @internal
   */
  rulesDynamicFilter?: {
    fallback: readonly DynamicRule<Theme>[];
    filters: readonly RegExp[];
  };
  rulesStaticMap: Record<string, StaticRule | undefined>;
  autocomplete: {
    templates: (AutoCompleteFunction | AutoCompleteTemplate)[];
    extractors: AutoCompleteExtractor[];
    shorthands: Record<string, string>;
  };
  separators: string[];
}
interface GenerateResult<T = Set<string>> {
  css: string;
  layers: string[];
  getLayer: (name?: string) => string | undefined;
  getLayers: (includes?: string[], excludes?: string[]) => string;
  setLayer: (layer: string, callback: (content: string) => Promise<string>) => Promise<string>;
  matched: T;
}
type VariantMatchedResult<Theme extends object = object> = [raw: string, current: string, variantHandlers: VariantHandler[], variants: Set<Variant<Theme>>];
type ParsedUtil = readonly [index: number, raw: string, entries: CSSEntries, meta: RuleMeta | undefined, variantHandlers: VariantHandler[]];
type RawUtil = readonly [index: number, rawCSS: string, meta: RuleMeta | undefined];
type StringifiedUtil<Theme extends object = object> = readonly [index: number, selector: string | undefined, body: string, parent: string | undefined, meta: RuleMeta | undefined, context: RuleContext<Theme> | undefined, noMerge: boolean | undefined];
interface CliEntryItem {
  patterns: string[];
  outFile: string;
  /**
   * Whether to rewrite the transformed utilities.
   *
   * - For css: if rewrite is true, it will not generate a new file, but directly modify the original file content.
   * - For other files: if rewrite is true, it replaces the original file with the transformed content.
   *
   * @default false
   */
  rewrite?: boolean;
  /**
   * Whether to output CSS files scanned from patterns to outFile
   *
   * - false: Do not output CSS files
   * - true: Transform and output scanned CSS file contents to outFile
   * - 'multi': Output each CSS file separately with filename format `${originFile}-[hash]`
   * - 'single': Merge multiple CSS files into one output file named `outFile-merged.css`
   *
   * @default true
   */
  splitCss?: boolean | 'multi' | 'single';
}
interface UtilObject {
  selector: string;
  entries: CSSEntries;
  parent: string | undefined;
  layer: string | undefined;
  sort: number | undefined;
  noMerge: boolean | undefined;
}
/**
 * Returned from `uno.generate()` when `extendedInfo` option is enabled.
 */
interface ExtendedTokenInfo<Theme extends object = object> {
  /**
   * Stringified util data
   */
  data: StringifiedUtil<Theme>[];
  /**
   * Return -1 if the data structure is not countable
   */
  count: number;
}
interface GenerateOptions<T extends boolean> {
  /**
   * Filepath of the file being processed.
   */
  id?: string;
  /**
   * Generate preflights (if defined)
   *
   * @default true
   */
  preflights?: boolean;
  /**
   * Includes safelist
   */
  safelist?: boolean;
  /**
   * Generate minified CSS
   * @default false
   */
  minify?: boolean;
  /**
   * @experimental
   */
  scope?: string;
  /**
   * If return extended "matched" with payload and count
   */
  extendedInfo?: T;
}
//#endregion
//#region src/shared.d.ts
declare const VAR_HUE = "--chromatic-hue";
interface PresetChromaticOptions {
  bakeColors?: boolean;
  baseHue: number;
  colors: Record<string, number>;
  /**
   * Colour model, `v2` by default: lightness, chroma and a small hue drift vary with hue (fitted to Tailwind CSS v4,
   * see `fittedOklch` of `@lingbo/chromatic`). `v1` restores the fixed per-shade lightness and the
   * `0.18 + 0.04 · cos(hue)` chroma of chromatic 1.x.
   *
   * NOTICE: with `v2`, lightness / chroma / drift are computed from `--chromatic-hue` on `:root`. Overriding
   * `--chromatic-hue` on a subtree still rotates the hue there, but keeps the root's lightness and chroma, which is the
   * same as `v1` does for chroma.
   */
  model?: ChromaticModel;
  modifierUtilityPrefixes?: string[];
  modifierVariantName?: string;
}
//#endregion
export { VAR_HUE as n, PresetFactory as r, PresetChromaticOptions as t };