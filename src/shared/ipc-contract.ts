/**
 * ============================================================================
 *  window.notepads — THE SOLE IPC CONTRACT (PA-8)
 * ============================================================================
 *
 * This file is the single shared type artifact between the three process tiers
 * (docs/plan/00-overview.md §1). It is the contract that:
 *   - the PRELOAD contextBridge implements verbatim,
 *   - the MAIN ipcMain.handle channels satisfy 1:1,
 *   - the RENDERER consumes (and NOTHING else — no raw ipcRenderer),
 *   - the PA-8 static scan and the Playwright suite assert against.
 *
 * Rules baked into these types:
 *   - Every renderer-callable method is `async` and returns a discriminated
 *     union `Result<T>` = `{ ok: true; data: T } | { ok: false; error: string }`.
 *   - Push events (main -> renderer) are exposed as `onX(cb)` subscriptions that
 *     return an `Unsubscribe` function.
 *   - Bytes never cross IPC into the renderer; only decoded strings + opaque
 *     encoding/EOL labels do. The renderer NEVER re-derives encoding or EOL.
 *
 * Ownership: Lane A (lane-a-main). Do not edit without coordinating via lead.
 *
 * Implementation status for Phase 1 (walking skeleton):
 *   - `file.open` / `file.save` are IMPLEMENTED.
 *   - All other namespaces are TYPE STUBS (stable signatures, no runtime yet)
 *     so Lanes B/C/D can build against a frozen surface without collisions.
 */

// ---------------------------------------------------------------------------
//  Result envelope + shared primitives
// ---------------------------------------------------------------------------

/** Discriminated-union result returned by every renderer-callable method. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Unsubscribe handle returned by every push-event subscription. */
export type Unsubscribe = () => void;

/**
 * Opaque encoding label, e.g. "UTF-8", "UTF-8-BOM", "UTF-16 LE BOM", "ANSI",
 * or an ANSI table label like "Western (windows-1252)". The renderer treats
 * this as opaque — it is produced and consumed only by MAIN's encoding engine.
 */
export type EncodingId = string;

/** End-of-line style label. Mirrors UWP's LineEnding enum {Crlf, Cr, Lf}. */
export type EolId = 'crlf' | 'cr' | 'lf';

// ---------------------------------------------------------------------------
//  file — open / save / saveAs / reload / revalidate
// ---------------------------------------------------------------------------

/** Authoritative file descriptor produced by MAIN after reading + decoding. */
export interface OpenedFile {
  /** Decoded text. May contain CRLF; renderer normalizes to '\n' for its shadow buffer. */
  decodedText: string;
  /** Opaque encoding label (see EncodingId). */
  encodingId: EncodingId;
  /** Detected EOL style (detected ONCE on read; never re-derived). */
  eolId: EolId;
  /** Last-modified time in epoch ms (for external-modification detection). */
  dateModifiedMs: number;
  /** Absolute path on disk, or null for an untitled buffer. */
  filePath: string | null;
  /** True when a BOM was present/written for the detected encoding. */
  hasBom: boolean;
}

/** Arguments for `file.save`. shadowText is the renderer's '\n'-normalized doc. */
export interface SaveArgs {
  /** Target absolute path. For untitled buffers, omit and use saveAs. */
  filePath: string;
  /** '\n'-normalized buffer text. If omitted, MAIN re-writes last-known content. */
  shadowText?: string;
  /** Encoding to write with. If omitted, MAIN reuses the file's current encoding. */
  encodingId?: EncodingId;
  /** EOL to re-apply on write. If omitted, MAIN reuses the file's current EOL. */
  eolId?: EolId;
}

export interface SaveAsArgs extends Omit<SaveArgs, 'filePath'> {
  /** Suggested file name / starting directory for the dialog. */
  suggestedName?: string;
  defaultDir?: string;
}

export interface SaveResult {
  filePath: string;
  dateModifiedMs: number;
  encodingId: EncodingId;
  eolId: EolId;
}

export interface FileApi {
  /** Read bytes from `path`, detect encoding+EOL, return decoded descriptor. */
  open(path: string): Promise<Result<OpenedFile>>;
  /** Re-apply EOL + encode `shadowText`, write bytes to `filePath`. */
  save(args: SaveArgs): Promise<Result<SaveResult>>;
  /** Prompt for a path, then save. */
  saveAs(args: SaveAsArgs): Promise<Result<SaveResult>>;
  /** Re-read the file from disk (used for external-modification reload). */
  reloadFromDisk(path: string): Promise<Result<OpenedFile>>;
  /** Re-validate a stored absolute path via fs.stat (session/FAL substitute). */
  revalidatePath(path: string): Promise<Result<{ exists: boolean; dateModifiedMs: number }>>;
}

// ---------------------------------------------------------------------------
//  encoding — ANSI list / decode-with / convert-EOL
// ---------------------------------------------------------------------------

export interface AnsiEncodingEntry {
  codePage: number;
  label: string;
}

export interface EncodingApi {
  /** List the supported ANSI encodings (the verbatim UWP 40-entry table). */
  listAnsi(): Promise<Result<AnsiEncodingEntry[]>>;
  /** Re-decode the file at `path` using an explicit encoding (reopen-with). */
  decodeWith(path: string, encodingId: EncodingId): Promise<Result<OpenedFile>>;
  /** Convert EOL of a '\n'-normalized text to the target style (preview only). */
  convertEol(text: string, eolId: EolId): Promise<Result<string>>;
}

// ---------------------------------------------------------------------------
//  session — snapshot / loadLast / clearRecovered  (Phase 4)
// ---------------------------------------------------------------------------

/** Per-tab session record. Stores ABSOLUTE PATHS (PA-4 FAL substitute). */
export interface SessionTab {
  editorId: string;
  filePath: string | null;
  encodingId: EncodingId;
  eolId: EolId;
  isModified: boolean;
  /** Caret position as a '\n'-doc offset. */
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  viewMode: { preview: boolean; diff: boolean };
  /**
   * PA-4 FAL substitute (Phase 4): true when this tab's `filePath` was set but
   * the file was missing/renamed at loadLast re-validation (fs.stat failed).
   * The path is PRESERVED (not nulled) so the UI can show "X is unavailable" and
   * offer relocate/save-as, mirroring UWP's GetItemAsync silent-skip — distinct
   * from a genuine untitled buffer (filePath:null, unavailable falsy). Optional
   * and defaults falsy, so it is purely additive to the contract.
   */
  unavailable?: boolean;
}

export interface SessionSnapshot {
  version: 1;
  tabs: SessionTab[];
  activeEditorId: string | null;
}

export interface SessionApi {
  /** Persist a session snapshot (dirty-checked against last JSON in MAIN). */
  snapshot(data: SessionSnapshot): Promise<Result<{ written: boolean }>>;
  /** Load the last persisted session (and any recovered backups). */
  loadLast(): Promise<Result<SessionSnapshot | null>>;
  /** Clear recovered backup files after the user discards recovery. */
  clearRecovered(): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
//  window — broker request/redirect / fullscreen / compact overlay  (Phase 6)
// ---------------------------------------------------------------------------

export interface WindowApi {
  /** Ask the broker to open paths (redirect-vs-spawn per AlwaysOpenNewWindow). */
  brokerRequest(args: { paths: string[]; forceNewWindow?: boolean }): Promise<Result<void>>;
  setFullScreen(enabled: boolean): Promise<Result<{ isFullScreen: boolean }>>;
  setCompactOverlay(enabled: boolean): Promise<Result<{ isCompactOverlay: boolean }>>;
}

// ---------------------------------------------------------------------------
//  dragOut — cross-window transfer  (Phase 6)
// ---------------------------------------------------------------------------

/** JSON envelope serialized for a cross-window tab transfer (undo stack excluded). */
export interface DragEnvelope {
  sourceWindowId: number;
  editorId: string;
  filePath: string | null;
  lastSavedText: string;
  /** Only present when the tab is dirty. */
  pendingText: string | null;
  encodingId: EncodingId;
  eolId: EolId;
  isModified: boolean;
  fileNamePlaceholder: string;
  dateModifiedMs: number;
  viewMode: { preview: boolean; diff: boolean };
}

export interface DragOutApi {
  /** Source renderer hands MAIN the envelope; returns a drag token. */
  begin(envelope: DragEnvelope): Promise<Result<{ token: string }>>;
  /** Target renderer completes the transfer for a token at a drop index. */
  complete(token: string, dropIndex: number): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
//  editor — MAIN -> renderer push (adopt / release)  (Phase 6)
// ---------------------------------------------------------------------------

export interface AdoptPayload {
  editorId: string;
  file: OpenedFile;
  pendingText: string | null;
  isModified: boolean;
  dropIndex: number;
  viewMode: { preview: boolean; diff: boolean };
}

export interface EditorApi {
  /** Subscribe to "adopt this editor" pushes from MAIN (transfer target). */
  onAdopt(cb: (payload: AdoptPayload) => void): Unsubscribe;
  /** Subscribe to "release this editor" pushes from MAIN (transfer source). */
  onRelease(cb: (payload: { editorId: string }) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
//  theme — OS theme + accent  (Phase 5)
// ---------------------------------------------------------------------------

export interface ThemeState {
  /** 'light' | 'dark' resolved from nativeTheme. */
  osTheme: 'light' | 'dark';
  /** Accent color as #RRGGBB from systemPreferences.getAccentColor(). */
  accentColor: string;
  highContrast: boolean;
}

export interface ThemeApi {
  get(): Promise<Result<ThemeState>>;
  onOsThemeChanged(cb: (theme: 'light' | 'dark') => void): Unsubscribe;
  onAccentChanged(cb: (accentColor: string) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
//  app — activation (argv/cwd) + protocol events  (Phase 6)
// ---------------------------------------------------------------------------

export interface ActivationEvent {
  /** Parsed file paths from process.argv (resolved against cwd). */
  paths: string[];
  /** Working directory captured at launch / second-instance. */
  cwd: string;
  /** notepads:// protocol payload, if activation came via protocol. */
  protocolUrl: string | null;
}

export interface AppApi {
  onActivation(cb: (event: ActivationEvent) => void): Unsubscribe;
  onProtocol(cb: (url: string) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
//  shell — OS integrations  (Phase 6)
// ---------------------------------------------------------------------------

export interface ShellApi {
  openContainingFolder(path: string): Promise<Result<void>>;
  copyPath(path: string): Promise<Result<void>>;
  webSearch(query: string): Promise<Result<void>>;
  print(): Promise<Result<void>>;
  share(args: { title: string; text: string }): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
//  The frozen window.notepads object
// ---------------------------------------------------------------------------

export interface NotepadsApi {
  file: FileApi;
  encoding: EncodingApi;
  session: SessionApi;
  window: WindowApi;
  dragOut: DragOutApi;
  editor: EditorApi;
  theme: ThemeApi;
  app: AppApi;
  shell: ShellApi;
}

declare global {
  interface Window {
    notepads: NotepadsApi;
  }
}
