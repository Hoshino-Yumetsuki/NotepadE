import { Spinner } from '@fluentui/react-components';
import { useEffect, useRef, useState, forwardRef } from 'react';
// Monaco ships these internals alongside its public API. They are intentionally
// used here because the public createModel(value: string) path cannot consume a
// streamed text-buffer factory.
// @ts-expect-error monaco-editor does not publish declarations for internal modules.
import { PieceTreeTextBufferBuilder } from 'monaco-editor/esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js';
import { MonacoEditor, type MonacoEditorProps, type MonacoHandle } from './MonacoEditor';

type TextBufferFactory = {
  create(defaultEOL: number): unknown;
};

interface PieceTreeLargeFileEditorProps
  extends Omit<MonacoEditorProps, 'initialDoc' | 'initialTextBufferFactory'> {
  path: string;
  size: number;
  encodingId: string;
}

/**
 * VS Code-style streamed model construction for large plain-text files.
 *
 * Chunks are fed into Monaco's own PieceTreeTextBufferBuilder instead of being
 * joined into one JavaScript string. The resulting factory is consumed by the
 * internal model-service path used by standalone Monaco's createModel.
 */
export const PieceTreeLargeFileEditor = forwardRef<
  MonacoHandle,
  PieceTreeLargeFileEditorProps
>(function PieceTreeLargeFileEditor({ path, size, encodingId, ...editorProps }, ref) {
  const [factory, setFactory] = useState<TextBufferFactory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    let active = true;
    setFactory(null);
    setError(null);

    void (async () => {
      try {
        const builder = new PieceTreeTextBufferBuilder();
        let offset = 0;
        while (offset < sizeRef.current) {
          const result = await window.notepads.file.readChunk(path, offset, encodingId);
          if (!active) return;
          if (!result.ok) throw new Error(result.error);
          if (
            result.data.offset !== offset ||
            result.data.nextOffset <= offset ||
            result.data.nextOffset > sizeRef.current
          ) {
            throw new Error('Invalid streamed chunk boundary');
          }
          builder.acceptChunk(result.data.text);
          offset = result.data.nextOffset;
        }
        // file_read_chunk already normalizes EOL to LF; skip the builder's
        // second whole-buffer EOL normalization pass.
        if (active) setFactory(builder.finish(false));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      active = false;
    };
  }, [path, encodingId]);

  if (error) {
    return (
      <section
        data-testid="large-file-editor-error"
        role="alert"
        style={{ height: '100%', padding: 12, color: 'inherit' }}
      >
        {error}
      </section>
    );
  }

  if (!factory) {
    return (
      <div
        data-testid="large-file-editor-loading"
        style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Spinner size="large" />
      </div>
    );
  }

  return (
    <MonacoEditor
      ref={ref}
      {...editorProps}
      initialTextBufferFactory={factory}
    />
  );
});
