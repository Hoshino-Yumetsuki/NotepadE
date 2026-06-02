#!/usr/bin/env tsx
/**
 * PA-8 Security Gate — static scanner (build-breaking).
 *
 * Mandated by docs/plan/02-phase-1-walking-skeleton.md §"PA-8 Security mandate".
 * This script FAILS the build (exit code 1) when any of the following are found:
 *
 *   1. `nodeIntegration: true`        anywhere in scanned sources
 *   2. `contextIsolation: false`      anywhere in scanned sources
 *   3. `sandbox: false`               anywhere in scanned sources
 *   4. `require(...)` / `import` of `fs` | `child_process` | `path`
 *      inside RENDERER sources (src/renderer/**)
 *   5. any reference to `@electron/remote` anywhere in scanned sources
 *
 * The contextBridge surface must be the single typed `window.notepads` API; raw
 * `ipcRenderer` exposure in the renderer is also flagged (defense-in-depth).
 *
 * Zero runtime dependencies (Node built-ins only) so it runs in CI before any
 * `npm install` of app deps and cannot itself smuggle a forbidden import.
 *
 * Usage:
 *   tsx scripts/pa8-scan.ts                      # scan default roots
 *   tsx scripts/pa8-scan.ts --root <dir>         # add an extra scan root
 *   tsx scripts/pa8-scan.ts --renderer <dir>     # add an extra renderer root
 *   tsx scripts/pa8-scan.ts --expect-fail        # invert exit code (fixture mode)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';

interface Violation {
  rule: string;
  file: string;
  line: number;
  text: string;
}

const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  '.git',
  'coverage',
  'build',
  '.vite',
]);

const NODE_BUILTINS_FORBIDDEN_IN_RENDERER = ['fs', 'child_process', 'path'];

/** Comment-stripping is intentionally NOT done: a forbidden pattern in a comment
 * is still flagged. Security gates fail loud; suppress with code review, not regex. */

function collectFiles(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) {
        if (IGNORED_DIRS.has(entry)) continue;
        stack.push(join(current, entry));
      }
      continue;
    }
    const dot = current.lastIndexOf('.');
    const ext = dot === -1 ? '' : current.slice(dot);
    if (SCANNED_EXTENSIONS.has(ext)) out.push(current);
  }
  return out;
}

/** Normalize a path to posix-style relative to cwd for stable, OS-agnostic output. */
function toRel(file: string): string {
  return relative(process.cwd(), file).split(sep).join(posix.sep);
}

/** True if the file lives under any renderer root (renderer = no Node built-ins). */
function isRendererFile(file: string, rendererRoots: string[]): boolean {
  const rel = toRel(file);
  return rendererRoots.some((root) => {
    const normRoot = root.split(sep).join(posix.sep).replace(/\/$/, '');
    return rel === normRoot || rel.startsWith(`${normRoot}/`);
  });
}

// --- Rule matchers (line-level) ---------------------------------------------

const WEBPREF_RULES: { rule: string; re: RegExp }[] = [
  {
    rule: 'nodeIntegration:true',
    re: /\bnodeIntegration\s*:\s*true\b/,
  },
  {
    rule: 'contextIsolation:false',
    re: /\bcontextIsolation\s*:\s*false\b/,
  },
  {
    rule: 'sandbox:false',
    re: /\bsandbox\s*:\s*false\b/,
  },
];

const ELECTRON_REMOTE_RE = /@electron\/remote/;

/** Matches `require('fs')`, require("path"), import ... from 'child_process',
 * import 'fs', and bare `import('fs')` dynamic imports, including node: prefix. */
function buildRendererImportRule(mod: string): RegExp {
  const m = `(?:node:)?${mod}`;
  return new RegExp(
    String.raw`(?:` +
      // require('fs') / require("node:fs")
      String.raw`\brequire\s*\(\s*['"]${m}['"]\s*\)` +
      String.raw`|` +
      // import ... from 'fs'  /  import 'fs'  /  export ... from 'fs'
      String.raw`\b(?:import|export)\b[^;\n]*?['"]${m}['"]` +
      String.raw`|` +
      // dynamic import('fs')
      String.raw`\bimport\s*\(\s*['"]${m}['"]\s*\)` +
      String.raw`)`,
  );
}

const RENDERER_IMPORT_RULES = NODE_BUILTINS_FORBIDDEN_IN_RENDERER.map((mod) => ({
  rule: `renderer-import:${mod}`,
  re: buildRendererImportRule(mod),
}));

// raw ipcRenderer leaking into renderer surface (defense-in-depth)
const RAW_IPCRENDERER_RE = /\bipcRenderer\b/;

function scanFile(
  file: string,
  isRenderer: boolean,
  violations: Violation[],
): void {
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const rel = toRel(file);

  lines.forEach((text, idx) => {
    const lineNo = idx + 1;

    for (const { rule, re } of WEBPREF_RULES) {
      if (re.test(text)) {
        violations.push({ rule, file: rel, line: lineNo, text: text.trim() });
      }
    }

    if (ELECTRON_REMOTE_RE.test(text)) {
      violations.push({
        rule: '@electron/remote',
        file: rel,
        line: lineNo,
        text: text.trim(),
      });
    }

    if (isRenderer) {
      for (const { rule, re } of RENDERER_IMPORT_RULES) {
        if (re.test(text)) {
          violations.push({ rule, file: rel, line: lineNo, text: text.trim() });
        }
      }
      if (RAW_IPCRENDERER_RE.test(text)) {
        violations.push({
          rule: 'renderer-raw-ipcRenderer',
          file: rel,
          line: lineNo,
          text: text.trim(),
        });
      }
    }
  });
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv: string[]): {
  roots: string[];
  rendererRoots: string[];
  expectFail: boolean;
} {
  const roots: string[] = [];
  const rendererRoots: string[] = [];
  let expectFail = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      roots.push(argv[++i]);
    } else if (arg === '--renderer') {
      rendererRoots.push(argv[++i]);
    } else if (arg === '--expect-fail') {
      expectFail = true;
    }
  }

  if (roots.length === 0) {
    // Default scan roots: every tier that can configure webPreferences or import
    // Node built-ins. Renderer is the strictest; main/preload still checked for
    // webPreferences + @electron/remote.
    roots.push('src');
  }
  if (rendererRoots.length === 0) {
    rendererRoots.push('src/renderer');
  }

  return { roots, rendererRoots, expectFail };
}

function main(): void {
  const { roots, rendererRoots, expectFail } = parseArgs(process.argv.slice(2));

  const files = new Set<string>();
  for (const root of roots) {
    for (const f of collectFiles(root)) files.add(f);
  }

  const violations: Violation[] = [];
  for (const file of files) {
    scanFile(file, isRendererFile(file, rendererRoots), violations);
  }

  const failed = violations.length > 0;

  if (failed) {
    console.error('\nPA-8 SECURITY GATE: FAIL');
    console.error(`Found ${violations.length} violation(s):\n`);
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}:${v.line}`);
      console.error(`      ${v.text}`);
    }
    console.error(
      '\nForbidden: nodeIntegration:true, contextIsolation:false, sandbox:false,\n' +
        'fs|child_process|path import in renderer, @electron/remote, raw ipcRenderer in renderer.\n',
    );
  } else {
    console.log('PA-8 SECURITY GATE: PASS — no violations found.');
    console.log(
      `Scanned ${files.size} file(s) under: ${roots.join(', ')} (renderer: ${rendererRoots.join(', ')}).`,
    );
  }

  if (expectFail) {
    // Fixture mode: the scan is EXPECTED to find violations. Invert exit code so
    // a passing scan over the bad fixture is itself a failure of the harness.
    if (failed) {
      console.log(
        '\n[--expect-fail] Violations detected as expected; fixture proves the gate bites.',
      );
      process.exit(0);
    } else {
      console.error(
        '\n[--expect-fail] No violations found, but the bad fixture MUST trip the gate. Harness broken.',
      );
      process.exit(1);
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
