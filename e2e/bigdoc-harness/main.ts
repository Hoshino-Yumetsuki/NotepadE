/**
 * Real-browser reproduction harness for the big-document scroll anchor fix
 * (src/renderer/editor/bigDocScroll.ts). jsdom has no layout, so the BigScaler
 * regime can only be exercised in a real browser.
 *
 * Mounts an EditorView with the same scroll-relevant extension stack as
 * CodeMirrorEditor.tsx (command bundle incl. zoom, scrollPastEnd, line-number
 * gutter, '\n' line separator, matching line-height/padding theme) over a
 * generated huge document, with `bigDocDispatchTransactions` wired exactly as
 * in the app.
 *
 * Query params:
 *   ?lines=N   document line count (default 920478 — the reported file)
 *   ?fix=0     mount WITHOUT the dispatch wrapper (reproduces the bug)
 *   ?wrap=1    enable EditorView.lineWrapping (app word-wrap mode)
 *   ?zoom=N    zoom percent (default 100) applied via the app zoom command
 *
 * Exposes `window.view` for the Playwright driver.
 */
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, scrollPastEnd } from '@codemirror/view';
import { history, defaultKeymap } from '@codemirror/commands';
import { editorCommandExtensions } from '../../src/renderer/editor/commands/keymap';
import { initZoomVar, setZoom } from '../../src/renderer/editor/commands/zoom';
import { lineNumberColumn } from '../../src/renderer/editor/lineNumberColumn';
import { bigDocDispatchTransactions, bigDocDebug } from '../../src/renderer/editor/bigDocScroll';
import { SHADOW_EOL } from '../../src/renderer/editor/eol';

const params = new URLSearchParams(location.search);
const LINES = Number(params.get('lines') ?? 920_478);
const FIX = params.get('fix') !== '0';
const WRAP = params.get('wrap') === '1';
const ZOOM = Number(params.get('zoom') ?? 100);
const VARIED = params.get('varied') === '1';

function makeDoc(lines: number): string {
  const parts = new Array<string>(lines);
  for (let i = 0; i < lines; i++) {
    if (VARIED) {
      // Deterministic pseudo-random line lengths (0..~300 chars) so line heights
      // vary under wrap and CM6's height estimates need post-render refinement —
      // closer to a real text file than uniform lines.
      const r = ((i * 2654435761) >>> 0) % 100;
      const reps = r < 60 ? 1 : r < 85 ? 4 : 12;
      parts[i] = `line ${i + 1} `.concat('lorem ipsum dolor sit amet '.repeat(reps));
    } else {
      parts[i] = `line ${i + 1} of the harness document`;
    }
  }
  return parts.join('\n');
}

const extensions = [
  history(),
  editorCommandExtensions({}),
  keymap.of(
    defaultKeymap.filter((b) => b.key !== 'Mod-z' && b.key !== 'Mod-y' && b.mac !== 'Mod-z')
  ),
  highlightActiveLine(),
  scrollPastEnd(),
  EditorState.lineSeparator.of(SHADOW_EOL),
  // Match the app's editor metrics (CodeMirrorEditor.tsx buildEditorTheme).
  EditorView.theme({
    '&': { height: '100%' },
    '.cm-content': {
      fontFamily: 'Consolas, "Cascadia Code", "Cascadia Mono", monospace',
      lineHeight: '1.2',
      padding: '6px 0 10px 0'
    },
    '.cm-line': { padding: '0 6px' },
    '.cm-scroller': { overflow: 'auto', lineHeight: '1.2' }
  }),
  lineNumberColumn({ themeMode: 'light', fontFamily: 'monospace', lineHighlighter: true }),
  WRAP ? EditorView.lineWrapping : []
];

const view = new EditorView({
  state: EditorState.create({ doc: makeDoc(LINES), extensions }),
  parent: document.getElementById('editor')!,
  ...(FIX ? { dispatchTransactions: bigDocDispatchTransactions } : {})
});
initZoomVar(view);
if (ZOOM !== 100) view.dispatch({ effects: setZoom.of(ZOOM) });

declare global {
  interface Window {
    view: EditorView;
    harnessReady: boolean;
    bigDocDebug: typeof bigDocDebug;
  }
}
window.view = view;
window.bigDocDebug = bigDocDebug;
window.harnessReady = true;
