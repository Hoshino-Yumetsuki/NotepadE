/**
 * port-resw.ts — convert the UWP Notepads .resw resources into renderer locale JSON.
 *
 * The UWP app ships 29 locales under
 *   <Notepads>/src/Notepads/Strings/<locale>/{Resources,Settings,Manifest}.resw
 * each a Microsoft ResX file: `<data name="Key" xml:space="preserve"><value>…</value></data>`.
 * This script flattens the three .resw per locale into ONE
 *   src/renderer/i18n/locales/<locale>.json
 * map of `{ "Key": "value" }`, plus an index of locale tags. The renderer's i18n
 * framework imports those JSON modules (tsconfig resolveJsonModule) and never
 * reads the filesystem at runtime — PA-8 stays clean.
 *
 * Key handling (UWP parity):
 *   - Keys that target a XAML property carry a `.Text` / `.Content` / `.Header`…
 *     suffix (e.g. `AboutPage_Disclaimer_Title.Text`). We keep the key VERBATIM,
 *     including the suffix, so wave-2 string-wrapping references the same name the
 *     UWP markup used. No transformation, no collision-merging.
 *   - `{0}`/`{1}` .NET positional placeholders are preserved as-is; the runtime
 *     formatter (format()) substitutes them. We do NOT rewrite to ICU.
 *   - Singular/Plural parity: UWP exposes explicit `*_SingularX` / `*_PluralX`
 *     key pairs that the app selects between by count. We preserve BOTH keys
 *     untouched; the runtime `plural()` helper picks the right one.
 *
 * Source-only template noise: the ResX schema embeds example rows (Name1, Color1,
 * Bitmap1, Icon1) WITHOUT `xml:space="preserve"` and typed/mimetyped. We accept a
 * `<data>` only when it is a plain string entry (no `type=`/`mimetype=` attr) AND
 * carries a `<value>`. That drops the schema examples while keeping every real key.
 *
 * Build-time ONLY. This file lives under scripts/ (NOT a renderer root), so its
 * node:fs/node:path imports are outside the PA-8 surface, exactly like pa8-scan.ts.
 *
 *   Usage: tsx scripts/port-resw.ts [--src <StringsDir>] [--out <localesDir>] [--check]
 *   Default src:  E:/Projects/Notepads/src/Notepads/Strings
 *   Default out:  src/renderer/i18n/locales
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

/** The .resw files that exist per locale; flattened in this order (later wins on collision — none expected). */
const RESW_FILES = ['Resources.resw', 'Settings.resw', 'Manifest.resw'] as const;

interface Args {
  src: string;
  out: string;
  check: boolean;
}

function parseArgs(argv: string[]): Args {
  // npm scripts run from the repo root; resolve outputs relative to cwd (ESM —
  // no __dirname). pa8-scan.ts uses the same process.cwd() convention.
  const repoRoot = process.cwd();
  let src = 'E:/Projects/Notepads/src/Notepads/Strings';
  let out = join(repoRoot, 'src/renderer/i18n/locales');
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') src = argv[++i] ?? src;
    else if (a === '--out') out = argv[++i] ?? out;
    else if (a === '--check') check = true;
  }
  return { src: resolve(src), out: resolve(out), check };
}

/** Minimal XML entity decode for the ResX value text we actually see. */
function decodeEntities(s: string): string {
  return (
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
      // & last so we don't double-decode the named entities above.
      .replace(/&amp;/g, '&')
  );
}

/**
 * Extract `{ key: value }` from one .resw. We match each `<data …>…</data>`
 * block, then require: a `name` attribute, NO `type=`/`mimetype=` attribute
 * (those are the schema's typed/binary example rows), and a `<value>` child.
 * `xml:space="preserve"` is NOT required for acceptance, but every real Notepads
 * key carries it, while the example rows are typed — so the type-attr exclusion is
 * what filters the schema noise. We also skip the four well-known example names.
 */
const SCHEMA_EXAMPLE_NAMES = new Set(['Name1', 'Color1', 'Bitmap1', 'Icon1']);

function parseResw(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const dataRe = /<data\b([^>]*)>([\s\S]*?)<\/data>/g;
  let m: RegExpExecArray | null;
  while ((m = dataRe.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const nameMatch = /\bname="([^"]+)"/.exec(attrs);
    if (!nameMatch) continue;
    const key = nameMatch[1];
    if (SCHEMA_EXAMPLE_NAMES.has(key)) continue;
    // Typed / serialized example rows are not localizable strings.
    if (/\btype=/.test(attrs) || /\bmimetype=/.test(attrs)) continue;
    const valMatch = /<value>([\s\S]*?)<\/value>/.exec(inner);
    if (!valMatch) continue;
    out[key] = decodeEntities(valMatch[1]);
  }
  return out;
}

function listLocales(srcDir: string): string[] {
  return readdirSync(srcDir)
    .filter((name) => {
      const p = join(srcDir, name);
      return statSync(p).isDirectory();
    })
    .sort((a, b) => a.localeCompare(b));
}

function portLocale(srcDir: string, locale: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of RESW_FILES) {
    const p = join(srcDir, locale, file);
    if (!existsSync(p)) continue;
    const part = parseResw(readFileSync(p, 'utf8'));
    Object.assign(merged, part);
  }
  return merged;
}

/** Stable-key table emitted as a typed TS module (kept inside the renderer i18n
 * surface so no shared tsconfig `include` change is needed for JSON resolution). */
function stableModule(locale: string, map: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(map).sort((a, b) => a.localeCompare(b))) sorted[k] = map[k];
  return `/* AUTO-GENERATED by scripts/port-resw.ts from UWP ${locale}/*.resw — DO NOT EDIT. */
import type { LocaleTable } from './types';

const table: LocaleTable = ${JSON.stringify(sorted, null, 2)};

export default table;
`;
}

function main(): void {
  const { src, out, check } = parseArgs(process.argv.slice(2));
  if (!existsSync(src)) {
    console.error(`[port-resw] source Strings dir not found: ${src}`);
    process.exit(2);
  }
  const locales = listLocales(src);
  if (!check) mkdirSync(out, { recursive: true });

  let totalKeys = 0;
  const summary: Array<{ locale: string; keys: number }> = [];
  for (const locale of locales) {
    const map = portLocale(src, locale);
    const count = Object.keys(map).length;
    totalKeys += count;
    summary.push({ locale, keys: count });
    const target = join(out, `${locale}.ts`);
    const code = stableModule(locale, map);
    if (check) {
      const prev = existsSync(target) ? readFileSync(target, 'utf8') : '';
      if (prev !== code) {
        console.error(`[port-resw] OUT OF DATE: ${basename(target)} differs from source .resw`);
        process.exit(1);
      }
    } else {
      writeFileSync(target, code, 'utf8');
    }
  }

  // Emit a typed index module listing every ported locale tag (single source of
  // truth for the framework's SUPPORTED_LOCALES) plus the shared LocaleTable type
  // module the per-locale tables import. Both are TS so the union type is exact
  // and the bundler tree-shakes (no runtime fs — PA-8 clean).
  const typesTs = renderTypes();
  const typesTarget = join(out, 'types.ts');
  const indexTs = renderIndex(locales);
  const indexTarget = join(out, 'index.ts');
  for (const [tgt, body] of [
    [typesTarget, typesTs],
    [indexTarget, indexTs],
  ] as const) {
    if (check) {
      const prev = existsSync(tgt) ? readFileSync(tgt, 'utf8') : '';
      if (prev !== body) {
        console.error(`[port-resw] OUT OF DATE: ${basename(tgt)} differs from source .resw`);
        process.exit(1);
      }
    } else {
      writeFileSync(tgt, body, 'utf8');
    }
  }

  console.log(
    `[port-resw] ${check ? 'verified' : 'ported'} ${locales.length} locales, ${totalKeys} total keys`,
  );
  for (const s of summary) console.log(`  ${s.locale.padEnd(10)} ${s.keys}`);
}

/** Generate locales/types.ts: the shared LocaleTable type the tables import. */
function renderTypes(): string {
  return `/* AUTO-GENERATED by scripts/port-resw.ts — DO NOT EDIT BY HAND. */

/** A flattened { key: value } string table for one locale. */
export type LocaleTable = Record<string, string>;
`;
}

/** Generate locales/index.ts: a static import map (PA-8-safe, bundler-friendly). */
function renderIndex(locales: string[]): string {
  const importLines = locales.map((l, i) => `import l${i} from './${l}';`).join('\n');
  const entryLines = locales.map((l, i) => `  '${l}': l${i},`).join('\n');
  const tagList = locales.map((l) => `  '${l}',`).join('\n');
  return `/**
 * AUTO-GENERATED by scripts/port-resw.ts — DO NOT EDIT BY HAND.
 *
 * Static map of every ported UWP locale to its flattened string table. Imported
 * statically so the bundler can resolve + tree-shake; no runtime fs (PA-8 clean).
 * Regenerate with: tsx scripts/port-resw.ts   (verify with --check).
 */

${importLines}

export type { LocaleTable } from './types';

/** Every locale tag ported from the UWP Strings/ dir (BCP-47, source casing). */
export const SUPPORTED_LOCALES = [
${tagList}
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** locale tag -> flattened { key: value } table. */
export const LOCALE_TABLES: Record<SupportedLocale, import('./types').LocaleTable> = {
${entryLines}
};

/** The base locale every other table falls back to for missing keys. */
export const BASE_LOCALE: SupportedLocale = 'en-US';
`;
}

main();
