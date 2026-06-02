import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EncodingId, EolId, OpenedFile } from '@shared/ipc-contract';
import { CodeMirrorEditor, type CodeMirrorHandle } from './editor/CodeMirrorEditor';
import { installTestHook, type OpenLabels } from './editor/test-hook';

/**
 * Walking-skeleton shell (Lane B, task #3). Mounts FluentProvider with the
 * hardcoded base theme (Dark #2E2E2E / Light #F0F0F0, docs/plan/02-phase-1 §5)
 * and one CodeMirror 6 editor over a '\n'-normalized shadow buffer.
 *
 * Authority contract (docs/plan/04 §3.A): MAIN sends authoritative
 * {decodedText, encodingId, eolId}; the renderer normalizes decodedText to a
 * '\n' shadow buffer for editing ONLY and holds encodingId/eolId as OPAQUE
 * labels in state — it NEVER re-derives them.
 *
 * Open/save wiring: the Gate-1 e2e drives the REAL renderer flow via the
 * `window.__notepadsTest` hook (PA-8 clean — composes only window.notepads).
 * openFileIntoEditor → file.open → load CM6; saveEditorToPath → read CM6 doc →
 * file.save({shadowText, encodingId, eolId}).
 */
export function App(): JSX.Element {
  const [isDark, setIsDark] = useState<boolean>(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );

  const editorRef = useRef<CodeMirrorHandle | null>(null);
  // Opaque, authoritative labels — set from MAIN, never re-derived here. Held in
  // a ref so the test hook always reads the latest values without re-installing.
  const labelsRef = useRef<OpenLabels>({ encodingId: null, eolId: null });
  // Mirror into state too, for future status-bar consumers (Phase 4).
  const [, setEncodingId] = useState<EncodingId | null>(null);
  const [, setEolId] = useState<EolId | null>(null);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent): void => setIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const onFileOpened = useCallback((file: OpenedFile): void => {
    // Load the authoritative decoded text into the '\n' shadow buffer.
    editorRef.current?.setDoc(file.decodedText);
    // Retain encoding/EOL as opaque labels (carried back to MAIN on save).
    labelsRef.current = { encodingId: file.encodingId, eolId: file.eolId };
    setEncodingId(file.encodingId);
    setEolId(file.eolId);
  }, []);

  useEffect(() => {
    const uninstall = installTestHook(
      () => editorRef.current,
      () => labelsRef.current,
      onFileOpened,
    );
    return uninstall;
  }, [onFileOpened]);

  return (
    <FluentProvider
      theme={isDark ? webDarkTheme : webLightTheme}
      style={{ height: '100vh', backgroundColor: isDark ? '#2E2E2E' : '#F0F0F0' }}
    >
      <div id="app-shell" style={{ height: '100%' }}>
        <CodeMirrorEditor ref={editorRef} />
      </div>
    </FluentProvider>
  );
}
