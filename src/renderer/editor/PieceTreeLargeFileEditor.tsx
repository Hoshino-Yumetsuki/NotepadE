import { useEffect, useRef, useState, forwardRef } from 'react';
import { MonacoEditor, type MonacoEditorProps, type MonacoHandle } from './MonacoEditor';
const STREAM_WINDOW = 4;
const STREAM_START_DELAY_MS = 500;

interface PieceTreeLargeFileEditorProps
  extends Omit<MonacoEditorProps, 'initialDoc' | 'readOnly'> {
  path: string;
  size: number;
  encodingId: string;
  streamId: string;
}

/**
 * Progressive large-file viewer.
 *
 * The editor mounts on an empty Monaco model immediately. Monaco stores that
 * model in its Piece Tree; decoded chunks then append directly to it through
 * the public edit API, so the first visible text does not wait for the full
 * file or a giant renderer string.
 */
export const PieceTreeLargeFileEditor = forwardRef<
  MonacoHandle,
  PieceTreeLargeFileEditorProps
>(function PieceTreeLargeFileEditor(
  { path, size, encodingId, streamId, ...editorProps },
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
    if (cancelTimerRef.current !== null) {
      window.clearTimeout(cancelTimerRef.current);
      cancelTimerRef.current = null;
    }
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
      const cancel = cancelStreamRef.current;
      cancelTimerRef.current = window.setTimeout(() => {
        cancel?.();
        cancelTimerRef.current = null;
      }, 0);
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
    void window.notepads.file
      .streamChunks(path, encodingId, streamId, (chunk) => {
        if (!activeRef.current || chunk.streamId !== streamId) return;
        if (
          chunk.offset !== offset ||
          chunk.nextOffset <= offset ||
          chunk.nextOffset > size
        ) {
          setError('Invalid streamed chunk boundary');
          cancelStreamRef.current?.();
          return;
        }
        handleRef.current?.appendText?.(chunk.text);
        offset = chunk.nextOffset;
        received += 1;
        if (offset === size) {
          const liveHandle = handleRef.current ?? handle;
          liveHandle.setLargeFileGuards?.();
          setComplete(true);
          cancelStreamRef.current = null;
          liveHandle.setReadOnly?.(false);
        }
        if (received % STREAM_WINDOW === 0) {
          void window.notepads.file
            .streamAck(streamId, STREAM_WINDOW)
            .catch(() => undefined);
        }
      })
      .then((result) => {
        if (!activeRef.current) return;
        if (!result.ok) {
          setError(result.error);
        }
      })
      .catch((cause: unknown) => {
        if (activeRef.current) setError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  const attachHandle = (handle: MonacoHandle | null): void => {
    if (!handle) {
      handleRef.current = null;
      return;
    }
    handleRef.current = handle;
    if (startedRef.current || !activeRef.current) return;
    // useImperativeHandle publishes before MonacoEditor's mount effect creates
    // its model. Do not drop the first chunks into that not-yet-live handle.
    if (!handle.getEditor()) {
      // The onReady callback below is the only start signal. The ref can be
      // published before Monaco's model exists, so merely cache this handle.
      return;
    }
    // React StrictMode replays the child mount effect. Defer the native stream
    // long enough for the first model to be disposed and the live model to be
    // attached before chunks can arrive.
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
      {/* VS Code disables wrapping for large files; wrapping would remeasure the growing document on every width/content change. */}
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
      {error ? (
        <section
          data-testid="large-file-editor-error"
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            padding: 12,
            background: 'var(--np-editor-error-background, transparent)',
          }}
        >
          {error}
        </section>
      ) : null}
    </div>
  );
});
