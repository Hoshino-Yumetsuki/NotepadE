/**
 * Monaco worker wiring (RENDERER, Lane B) — Vite `?worker` bundling.
 *
 * Monaco offloads model tokenization / basic edit services to a web worker. We
 * use Monaco as a PLAIN TEXT editor (no language services, no language workers —
 * see the migration plan), so the ONLY worker needed is the editor-core
 * (`editor.worker`) one; `MonacoEnvironment.getWorker` returns it for every
 * label.
 *
 * Vite bundles the worker when imported with the `?worker` suffix and hands back
 * a constructor that builds a same-origin Worker — under the production `file://`
 * load this resolves to a `blob:` worker, which is why the production CSP meta in
 * index.html grants `worker-src blob:` (see that file).
 *
 * Importing this module for its side effect (setting `self.MonacoEnvironment`)
 * MUST happen before the first `monaco.editor.create`; MonacoEditor.tsx imports
 * it at the top of its module so the assignment runs at import time.
 */
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// Assign once. A module is evaluated a single time, but guard anyway so a hot
// reload in dev never clobbers an in-flight environment. `self.MonacoEnvironment`
// is declared by monaco-editor's ambient types on the worker/global scope.
const scope = self as unknown as { MonacoEnvironment?: monaco.Environment };
if (!scope.MonacoEnvironment) {
  scope.MonacoEnvironment = {
    // Plain-text editor: every worker label maps to the editor-core worker.
    getWorker(): Worker {
      return new EditorWorker();
    }
  };
}
