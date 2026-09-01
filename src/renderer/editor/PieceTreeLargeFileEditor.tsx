import { Spinner } from '@fluentui/react-components';
import { useEffect, useRef, useState, forwardRef } from 'react';
import type { Result, StreamedFileBaseline } from '@shared/ipc-contract';
import { MonacoEditor, type MonacoEditorProps, type MonacoHandle } from './MonacoEditor';

const STREAM_WINDOW = 4;
const STREAM_START_DELAY_MS = 500;

interface PieceTreeLargeFileEditorProps
  extends Omit<MonacoEditorProps, 'initialDoc' | 'readOnly'> {
  path: string;
  size: number;
  encodingId: string;
  streamId: string;
  onLoadComplete?: (baseline: StreamedFileBaseline) => void;
  onLoadError?: (message: string) => void;
}

/**
 * Large-file editor backed by a progressively filled Monaco Piece Tree.
 * The model stays hidden and read-only while the native stream runs, then
 * becomes visible and editable only after the stream reaches EOF.
 */
export const PieceTreeLargeFileEditor = forwardRef<
  MonacoHandle,
  PieceTreeLargeFileEditorProps
>(function PieceTreeLargeFileEditor(
  { path, size, encodingId, streamId, onLoadComplete, onLoadError, ...editorProps },
  ref
) {
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const startedRef = useRef(false);
  const activeRef = useRef(true);
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const cancelTimerRef = useRef<number | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const handleRef = useRef<MonacoHandle | null>(null);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
      cancelStreamRef.current?.();
      cancelStreamRef.current = null;
      if (cancelTimerRef.current !== null) {
        window.clearTimeout(cancelTimerRef.current);
        cancelTimerRef.current = null;
      }
    };
  }, [path, encodingId, streamId]);

  const startStream = (handle: MonacoHandle): void => {
    if (startedRef.current || !activeRef.current) return;
    startedRef.current = true;
    cancelStreamRef.current = () => {
      void window.notepads.file.streamCancel(streamId).catch(() => undefined);
    };
    let offset = 0;
    let received = 0;
    let sawEndChunk = false;
    let nativeResult: Result<StreamedFileBaseline> | null = null;
    let finished = false;
    const finishIfReady = (): void => {
      if (!activeRef.current || finished || !nativeResult) return;
      if (!nativeResult.ok) {
        finished = true;
        setError(nativeResult.error);
        onLoadError?.(nativeResult.error);
        return;
      }
      // Tauri Channel messages can be dispatched just after invoke resolves.
      // Publish EOF only after both the command result and the final chunk have
      // arrived; otherwise a complete file is reported as changed mid-load.
      if (!sawEndChunk) return;
      if (offset !== size) {
        finished = true;
        const message = 'Large file changed while loading';
        setError(message);
        onLoadError?.(message);
        return;
      }
      finished = true;
      const liveHandle = handleRef.current ?? handle;
      liveHandle.setLargeFileGuards?.();
      liveHandle.setReadOnly?.(false);
      setComplete(true);
      onLoadComplete?.(nativeResult.data);
      cancelStreamRef.current = null;
    };
    void window.notepads.file
      .streamChunks(path, encodingId, streamId, (chunk) => {
        if (!activeRef.current || finished || chunk.streamId !== streamId) return;
        if (
          chunk.offset !== offset ||
          chunk.nextOffset <= offset ||
          chunk.nextOffset > size
        ) {
          const message = 'Invalid streamed chunk boundary';
          finished = true;
          setError(message);
          onLoadError?.(message);
          cancelStreamRef.current?.();
          return;
        }
        handleRef.current?.appendText?.(chunk.text);
        offset = chunk.nextOffset;
        received += 1;
        sawEndChunk = chunk.nextOffset === size;
        if (received % STREAM_WINDOW === 0) {
          void window.notepads.file
            .streamAck(streamId, STREAM_WINDOW)
            .catch(() => undefined);
        }
        finishIfReady();
      })
      .then((result) => {
        nativeResult = result;
        finishIfReady();
      })
      .catch((cause: unknown) => {
        if (!activeRef.current || finished) return;
        finished = true;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        onLoadError?.(message);
      });
  };

  const attachHandle = (handle: MonacoHandle | null): void => {
    if (!handle) {
      handleRef.current = null;
      return;
    }
    handleRef.current = handle;
    if (startedRef.current || !activeRef.current || !handle.getEditor()) return;
    if (startTimerRef.current === null) {
      startTimerRef.current = window.setTimeout(() => {
        startTimerRef.current = null;
        if (activeRef.current) startStream(handle);
      }, STREAM_START_DELAY_MS);
    }
  };

  return (
    <div
      data-testid="large-file-editor"
      aria-busy={!complete && error === null}
      style={{ height: '100%', position: 'relative' }}
    >
      <div style={{ height: '100%', visibility: complete ? 'visible' : 'hidden' }}>
        <MonacoEditor
          ref={(handle) => {
            attachHandle(handle);
            if (typeof ref === 'function') ref(handle);
            else if (ref) ref.current = handle;
          }}
          {...editorProps}
          onReady={() => {
            window.setTimeout(() => {
              const liveHandle = handleRef.current;
              if (activeRef.current && liveHandle) attachHandle(liveHandle);
            }, 0);
          }}
          largeFileOptimizations
          wordWrap={false}
          initialDoc=""
          readOnly
        />
      </div>
      {!complete && !error ? (
        <div
          data-testid="editor-loading"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Spinner size="large" />
        </div>
      ) : null}
      {error ? (
        <section
          data-testid="large-file-editor-error"
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            padding: 12,
            background: 'var(--np-editor-error-background, transparent)'
          }}
        >
          {error}
        </section>
      ) : null}
    </div>
  );
});
