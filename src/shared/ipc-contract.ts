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
  /** xxh3_64 hash of the LF-normalized text (for dirty detection). */
  baselineHash: number;
  /** Byte length of the LF-normalized text. */
  baselineLength: number;
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
  /** xxh3_64 hash of the saved LF-normalized text (for dirty detection reset). */
  baselineHash: number;
  /** Byte length of the saved LF-normalized text. */
  baselineLength: number;
}

export interface FileApi {
  /** Read bytes from `path`, detect encoding+EOL, return decoded descriptor. */
  open(path: string): Promise<Result<OpenedFile>>;
  /**
   * Prompt for files to open via MAIN's native open dialog (multi-select, .txt +
   * All Files). Returns the chosen ABSOLUTE paths, or `[]` when the user cancels
   * (cancel is a normal success, NOT an error). The renderer then opens each path
   * via `file.open`. PA-8: the dialog lives in MAIN; the renderer never touches it.
   */
  openDialog(): Promise<Result<string[]>>;
  /** Re-apply EOL + encode `shadowText`, write bytes to `filePath`. */
  save(args: SaveArgs): Promise<Result<SaveResult>>;
  /** Prompt for a path, then save. */
  saveAs(args: SaveAsArgs): Promise<Result<SaveResult>>;
  /** Re-read the file from disk (used for external-modification reload). */
  reloadFromDisk(path: string): Promise<Result<OpenedFile>>;
  /** Re-validate a stored absolute path via fs.stat (session/FAL substitute). */
  revalidatePath(path: string): Promise<Result<{ exists: boolean; dateModifiedMs: number }>>;
  /** Get file size in bytes (used to decide streaming vs direct load). */
  getSize(path: string): Promise<Result<number>>;
  /** Open a large file via streaming: returns header, then emits chunk events. */
  openStreamed(path: string): Promise<Result<StreamedFileHeader>>;
  /** Subscribe to file chunk events (streaming load). Returns unsubscribe function. */
  onChunk(cb: (chunk: FileChunk) => void): Promise<Unsubscribe>;
}

/** Header returned by file.openStreamed before chunk events begin. */
export interface StreamedFileHeader {
  encodingId: EncodingId;
  eolId: EolId;
  dateModifiedMs: number;
  filePath: string;
  hasBom: boolean;
  baselineHash: number;
  baselineLength: number;
  chunkCount: number;
  totalBytes: number;
}

/** A single chunk emitted via the `notepads:evt:file:chunk` event. */
export interface FileChunk {
  index: number;
  text: string;
  isLast: boolean;
}

// ---------------------------------------------------------------------------
//  recent — in-app most-recently-used file list  (UWP MRUService)
// ---------------------------------------------------------------------------
//
// MAIN owns a persisted recent-files list (JSON under userData), the in-app
// substitute for UWP's StorageApplicationPermissions.MostRecentlyUsedList — this
// is SEPARATE from the OS jump list (app.addRecentDocument, fed in shell.ts). The
// list is capped, de-duplicated by path (most-recent-first), and entries whose
// file no longer exists are pruned on read (mirrors UWP's GetItemAsync skip).

/** A single in-app recent-files entry (most-recent-first ordering). */
export interface RecentEntry {
  /** Absolute path on disk. */
  path: string;
  /** Basename for display (derived in MAIN; the renderer never touches path). */
  displayName: string;
  /** Last-modified time in epoch ms, when stat succeeded on read. */
  mtimeMs?: number;
}

export interface RecentApi {
  /** List recent files, most-recent-first, missing paths pruned (UWP top=10). */
  list(): Promise<Result<RecentEntry[]>>;
  /** Clear the entire in-app recent list (UWP MRUService.ClearAll). */
  clear(): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
//  paths — drag-drop File -> absolute path  (webUtils, PRELOAD-only)
// ---------------------------------------------------------------------------
//
// Under the sandbox the renderer can't read `File.path`. The drop handler hands
// the dropped `File` to this preload helper, which resolves the absolute path via
// electron `webUtils.getPathForFile`. PA-8: the `webUtils` import lives ONLY in
// preload; the renderer just calls `window.notepads.paths.forFile(file)`.

export interface PathsApi {
  /**
   * Resolve a dropped `File` to its absolute on-disk path via preload's
   * `webUtils.getPathForFile`. Returns `''` for a File with no backing path (e.g.
   * synthetic / in-memory File). Synchronous: webUtils.getPathForFile is sync and
   * needs no IPC round-trip (it is NOT a `Result<T>` channel).
   */
  forFile(file: File): string;
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
//  hash — content hash for dirty detection
// ---------------------------------------------------------------------------

export interface HashApi {
  /** Compute xxh3_64 hash of the given text (for dirty detection comparison). */
  compute(text: string): Promise<Result<number>>;
}

// ---------------------------------------------------------------------------
//  diff — Rust-side diff computation
// ---------------------------------------------------------------------------

export interface DiffPieceDto {
  text: string;
  kind: 'unchanged' | 'inserted' | 'deleted';
}

export interface DiffRowDto {
  kind: 'unchanged' | 'inserted' | 'deleted' | 'modified' | 'imaginary';
  text: string;
  pieces?: DiffPieceDto[];
}

export interface DiffModelDto {
  left: DiffRowDto[];
  right: DiffRowDto[];
}

export interface DiffApi {
  /** Compute a line-level + char-level two-column diff model in Rust. */
  compute(original: string, modified: string): Promise<Result<DiffModelDto>>;
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
//  settings — persisted app settings  (Phase 5)
// ---------------------------------------------------------------------------
//
// MAIN owns the persisted settings store (replaces UWP ApplicationSettingsStore /
// AppSettingsService + ThemeSettingsService). The renderer NEVER touches the
// store directly — it reads the whole bag via `settings.get()`, patches fields
// via `settings.set(patch)`, and reacts to `settings.onChanged`. Every field +
// default below is grounded 1:1 in the UWP source (AppSettingsService.cs /
// ThemeSettingsService.cs); see DEFAULT_SETTINGS for the verbatim defaults.

/** Editor font slant. Mirrors UWP Windows.UI.Text.FontStyle. */
export type FontStyleId = 'normal' | 'italic' | 'oblique';

/** Text-wrap mode. Mirrors the UWP TextWrapping values the app actually uses. */
export type TextWrapMode = 'noWrap' | 'wrap';

/**
 * Default decoding preference (UWP EditorDefaultDecoding):
 *   'auto'  → guess encoding at read time (UWP null sentinel / codePage -1),
 *   'utf-8' → force UTF-8 (no BOM),
 *   'ansi'  → force the system/current-culture ANSI code page.
 */
export type DefaultDecoding = 'auto' | 'utf-8' | 'ansi';

/** Web-search engine selection. Mirrors UWP SearchEngine enum. */
export type SearchEngineId = 'bing' | 'google' | 'duckDuckGo' | 'custom';

/** Theme mode (UWP UseWindowsTheme=true → 'system', else the requested theme). */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Wallpaper presentation effect while a wallpaper is active (web-port-only):
 * the SAME `tintOpacity` slider drives either the layer's BLUR intensity
 * ('blur' — the image stays opaque and frosts toward the acrylic look) or the
 * layer's CSS OPACITY ('opacity' — 1 = fully visible, 0 = invisible over the
 * opaque theme base). See renderer theme/wallpaper.ts.
 */
export type WallpaperEffect = 'blur' | 'opacity';

/** Tab-as-spaces width (UWP EditorDefaultTabIndents): -1 = real tab. */
export type TabIndents = -1 | 2 | 4 | 8;

/**
 * The full persisted settings bag (MAIN-owned). Field names mirror the UWP
 * AppSettingsService / ThemeSettingsService properties; grouped by settings pane.
 */
export interface Settings {
  // --- Text & Editor ---
  editorFontFamily: string;
  editorFontSize: number;
  editorFontStyle: FontStyleId;
  /** OpenType weight (UWP FontWeight.Weight ushort); 400 = Normal. */
  editorFontWeight: number;
  textWrapping: TextWrapMode;
  displayLineHighlighter: boolean;
  displayLineNumbers: boolean;
  /** Spellcheck red-underline highlight (UWP IsHighlightMisspelledWordsEnabled). */
  highlightMisspelledWords: boolean;
  defaultLineEnding: EolId;
  /** Default write encoding as an opaque EncodingId (UWP EditorDefaultEncoding). */
  defaultEncoding: EncodingId;
  defaultDecoding: DefaultDecoding;
  tabIndents: TabIndents;
  searchEngine: SearchEngineId;
  customSearchUrl: string;
  // --- Personalization ---
  themeMode: ThemeMode;
  /** Background tint opacity 0..1 (UWP AppBackgroundPanelTintOpacity). */
  tintOpacity: number;
  useWindowsAccentColor: boolean;
  /** Custom accent as #RRGGBB; empty string = follow the resolved app accent. */
  customAccentColor: string;
  // --- Advanced ---
  showStatusBar: boolean;
  smartCopy: boolean;
  sessionSnapshot: boolean;
  alwaysOpenNewWindow: boolean;
  exitWhenLastTabClosed: boolean;
  /** BCP-47 language tag, or '' = follow the OS UI language (29-locale set, Phase 6). */
  appLanguage: string;
  /**
   * Whether the "Open with NotepadE" entry appears in the Explorer right-click
   * menu (Windows only). Writes/removes HKCU\Software\Classes\*\shell\NotepadE.
   * No-op on non-Windows platforms.
   */
  openWithContextMenu: boolean;
  /**
   * Custom background wallpaper — the FILE NAME of the image inside
   * `{userData}/wallpaper/`, or '' when no wallpaper is set. ONLY the name is
   * persisted (never the user's original path or a URL): MAIN copies/downloads
   * the picked image into that folder and owns its lifecycle (the previous file
   * is deleted on replace/clear — see main/wallpaper.ts). When non-empty, the
   * renderer paints the image as a full-window layer UNDER all UI surfaces,
   * replacing the desktop see-through backdrop (acrylic/vibrancy), and
   * `tintOpacity` then drives the WALLPAPER layer's effect (blur intensity or
   * opacity, per `wallpaperEffect`) instead of the background tint alpha. No
   * UWP equivalent (web-port-only personalization).
   */
  wallpaperFileName: string;
  /**
   * Which wallpaper effect the tint-opacity slider drives while a wallpaper is
   * active: 'blur' (frost intensity, image opaque) or 'opacity' (layer CSS
   * opacity). Ignored when no wallpaper is set. No UWP equivalent.
   */
  wallpaperEffect: WallpaperEffect;
  /** Whether to automatically check for updates on app startup. */
  autoCheckUpdates: boolean;
}

/**
 * Verbatim UWP defaults (AppSettingsService.cs Initialize* + ThemeSettingsService.cs
 * Initialize*). MAIN applies these when a key is absent; both tiers import this so
 * there is a single source of truth (pure data — PA-8 clean, no fs).
 */
export const DEFAULT_SETTINGS: Settings = {
  editorFontFamily: 'Consolas',
  editorFontSize: 14,
  editorFontStyle: 'normal',
  editorFontWeight: 400,
  textWrapping: 'noWrap',
  displayLineHighlighter: true,
  displayLineNumbers: true,
  highlightMisspelledWords: false,
  defaultLineEnding: 'crlf',
  defaultEncoding: 'UTF-8',
  defaultDecoding: 'auto',
  tabIndents: -1,
  searchEngine: 'bing',
  customSearchUrl: '',
  themeMode: 'system',
  // 0.5 (not UWP's 0.75): this rgba tint layers OVER Electron's own acrylic
  // material, so a high value compounds to a near-solid window. 0.5 keeps the
  // frosted wallpaper visible. See theme/tokens.ts appBackgroundTint.
  tintOpacity: 0.5,
  useWindowsAccentColor: true,
  customAccentColor: '',
  showStatusBar: true,
  smartCopy: false,
  sessionSnapshot: false,
  alwaysOpenNewWindow: false,
  exitWhenLastTabClosed: false,
  appLanguage: '',
  openWithContextMenu: false,
  // No wallpaper by default — the acrylic/vibrancy desktop see-through backdrop
  // is the out-of-box look; the wallpaper is an explicit opt-in personalization.
  wallpaperFileName: '',
  // 'blur' preserves the pre-existing wallpaper behavior (slider = frost
  // intensity), so users upgrading from before the switch see no change.
  wallpaperEffect: 'blur',
  autoCheckUpdates: true
};

export interface SettingsApi {
  /** Read the full persisted settings (MAIN-owned, DEFAULT_SETTINGS applied). */
  get(): Promise<Result<Settings>>;
  /**
   * Patch one or more settings. MAIN merges, persists, then broadcasts
   * `EvtSettingsChanged` to ALL windows. Returns the merged settings.
   */
  set(patch: Partial<Settings>): Promise<Result<Settings>>;
  /**
   * Restore EVERY setting to its verbatim default (the recovery hatch for a
   * misconfigured app — broken font / transparency / wallpaper). Also deletes
   * the managed wallpaper file via the wallpaper lifecycle (main/wallpaper.ts
   * clear — never a duplicated delete). Persists + broadcasts through the
   * normal set path, so all windows reflect defaults live (no restart; the
   * appLanguage restart convention is unchanged). Returns the defaults bag.
   */
  resetAll(): Promise<Result<Settings>>;
  /** Subscribe to settings changes (this or any other window / external write). */
  onChanged(cb: (settings: Settings) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
//  window — broker request/redirect / fullscreen / compact overlay  (Phase 6)
// ---------------------------------------------------------------------------

export interface WindowApi {
  /** Ask the broker to open paths (redirect-vs-spawn per AlwaysOpenNewWindow). */
  brokerRequest(args: { paths: string[]; forceNewWindow?: boolean }): Promise<Result<void>>;
  setFullScreen(enabled: boolean): Promise<Result<{ isFullScreen: boolean }>>;
  setCompactOverlay(enabled: boolean): Promise<Result<{ isCompactOverlay: boolean }>>;
  /**
   * Custom caption controls (replace the OS titleBarOverlay so the buttons are
   * transparent and the window acrylic shows through them — 1:1 with the UWP
   * ApplyThemeForTitleBarButtons transparent-button scheme). MAIN owns the
   * BrowserWindow (PA-8); the renderer's in-chrome buttons drive these.
   */
  minimize(): Promise<Result<void>>;
  /** Toggle maximize/restore; resolves with the resulting maximized flag. */
  toggleMaximize(): Promise<Result<{ isMaximized: boolean }>>;
  close(): Promise<Result<void>>;
  /** Current maximized flag (used to seed the restore glyph on mount). */
  isMaximized(): Promise<Result<{ isMaximized: boolean }>>;
  /**
   * Subscribe to maximized-state changes (MAIN pushes on the window's
   * maximize/unmaximize events) so the max/restore glyph stays in sync when the
   * user double-clicks the drag region, snaps, or uses Win+Up. Returns an
   * unsubscribe fn.
   */
  onMaximizeChanged(cb: (isMaximized: boolean) => void): () => void;
  /**
   * Quit the whole application (UWP ExitApp / ExitWhenLastTabClosed). Used when the
   * last tab is closed and `settings.exitWhenLastTabClosed` is on. MAIN owns the
   * app lifecycle — the renderer never calls `app.quit` directly (PA-8).
   */
  quit(): Promise<Result<void>>;
  /**
   * Confirm that the close-reminder flow is resolved and the owning window may now
   * actually close. MAIN marks the window as confirmed and calls `win.close()`,
   * which passes the 'close' guard installed in the window factory. 1:1 with the
   * UWP `deferral.Complete()` after the AppCloseSaveReminderDialog resolves.
   */
  confirmClose(): Promise<Result<void>>;
  /**
   * Subscribe to "the user tried to close this window" pushes. MAIN fires this
   * when the window's native close is intercepted (X button, Alt+F4, OS close).
   * The renderer runs the unsaved-changes flow then calls `confirmClose()` to let
   * the real close proceed. Returns an unsubscribe fn.
   */
  onCloseRequested(cb: () => void): Unsubscribe;
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
//  wallpaper — custom background image (web-port-only personalization)
// ---------------------------------------------------------------------------
//
// MAIN owns the wallpaper file lifecycle (PA-8: fs/net/dialogs in MAIN only):
// the picked image is COPIED (local path) or DOWNLOADED (URL, content-type +
// size validated) into `{userData}/wallpaper/`, the previous file is DELETED on
// replace/clear, and only the managed FILE NAME is persisted in Settings
// (`wallpaperFileName`). The renderer receives the image as a `data:` URL — the
// page CSP already allows `img-src data:`, wallpapers are size-capped (20MB),
// and no custom protocol / webSecurity weakening is needed. Pushes ride the
// existing `EvtSettingsChanged` broadcast (setting changes on set/clear), so
// every window re-fetches via `wallpaper.get()` on its settings subscription.

/** Snapshot of the active wallpaper, as served to the renderer. */
export interface WallpaperState {
  /** Managed file name inside `{userData}/wallpaper/`; '' when none is set. */
  fileName: string;
  /** The image as a `data:<mime>;base64,...` URL, or null when none is set. */
  dataUrl: string | null;
}

export interface WallpaperApi {
  /** Current wallpaper (file read + data-URL encode happen in MAIN). */
  get(): Promise<Result<WallpaperState>>;
  /**
   * Copy a local image into the managed folder and activate it. Validates the
   * extension against the allowed image set and enforces the size cap. The
   * user's original file is never referenced after the copy.
   */
  setFromPath(path: string): Promise<Result<WallpaperState>>;
  /**
   * Download an http(s) image into the managed folder and activate it. MAIN
   * validates the response content-type is an allowed image type and enforces
   * the size cap while streaming — remote content is stored, never executed.
   */
  setFromUrl(url: string): Promise<Result<WallpaperState>>;
  /**
   * Prompt for a local image via MAIN's native open dialog, then setFromPath.
   * Resolves `null` when the user cancels (cancel is a normal success, NOT an
   * error — same convention as file.openDialog). PA-8: dialog lives in MAIN.
   */
  pick(): Promise<Result<WallpaperState | null>>;
  /** Remove the active wallpaper and DELETE its file from the managed folder. */
  clear(): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
//  updater — GitHub Releases update checker
// ---------------------------------------------------------------------------

export interface UpdateInfo {
  available: boolean;
  version: string;
  notes: string;
  htmlUrl: string;
  /** Platform-specific installer asset download URL (empty on macOS/Linux). */
  assetUrl: string;
  assetName: string;
}

export interface UpdatesApi {
  check(): Promise<Result<UpdateInfo>>;
  install(assetUrl: string, assetName: string, htmlUrl: string): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
//  The frozen window.notepads object
// ---------------------------------------------------------------------------

export interface NotepadsApi {
  file: FileApi;
  recent: RecentApi;
  paths: PathsApi;
  encoding: EncodingApi;
  hash: HashApi;
  diff: DiffApi;
  session: SessionApi;
  settings: SettingsApi;
  window: WindowApi;
  dragOut: DragOutApi;
  editor: EditorApi;
  theme: ThemeApi;
  app: AppApi;
  shell: ShellApi;
  wallpaper: WallpaperApi;
  updates: UpdatesApi;
}

declare global {
  interface Window {
    notepads: NotepadsApi;
  }
}
