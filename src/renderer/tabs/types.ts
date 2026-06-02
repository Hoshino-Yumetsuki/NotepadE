import type { EncodingId, EolId } from '@shared/ipc-contract';

/**
 * ============================================================================
 *  Tab state model (Phase 2, stream B) — docs/plan/03-phase-2-tabs-setsview.md
 * ============================================================================
 *
 * Each tab owns exactly the fields the plan mandates:
 *   {editorId, filePath|null, encodingId, eolId, isModified, viewMode, caret, scroll}
 *
 * Mirrors the UWP SetsView/TextEditor pairing: one tab == one editor surface.
 * `encodingId`/`eolId` are OPAQUE labels carried from MAIN (docs/plan/00 §1,
 * 04 §3.A); the renderer NEVER re-derives them. They line up 1:1 with
 * SessionTab in the IPC contract so a tab can be snapshotted/restored verbatim.
 */

/** Caret / selection as offsets into the '\n'-normalized shadow buffer. */
export interface CaretState {
  /** Selection anchor offset (start). */
  start: number;
  /** Selection head offset (end). For a collapsed caret, end === start. */
  end: number;
}

/** Scroll position of the editor surface for this tab. */
export interface ScrollState {
  top: number;
  left: number;
}

/** Which alternate render mode the editor is in (markdown preview / diff). */
export interface ViewMode {
  preview: boolean;
  diff: boolean;
}

/**
 * One tab == one editor. `filePath` is null for an untitled buffer; the strip
 * then shows the UWP `FileNamePlaceholder` (e.g. "Untitled 1").
 */
export interface TabState {
  /** Stable identity for the editor surface this tab owns. */
  editorId: string;
  /** Absolute path on disk, or null for an untitled buffer. */
  filePath: string | null;
  /** Opaque encoding label from MAIN (never re-derived). */
  encodingId: EncodingId;
  /** Opaque EOL label from MAIN (never re-derived). */
  eolId: EolId;
  /** Dirty flag — drives the F127 accent dot in the tab header. */
  isModified: boolean;
  /** Alternate render mode (markdown preview / diff). */
  viewMode: ViewMode;
  /** Caret / selection offsets in the '\n' shadow buffer. */
  caret: CaretState;
  /** Editor scroll position. */
  scroll: ScrollState;
  /**
   * Display name shown when `filePath` is null (UWP FileNamePlaceholder, e.g.
   * "Untitled 1"). Ignored when filePath is set — the basename is shown then.
   */
  untitledName: string;
}

/** Snapshot of the whole tab set the strip renders. */
export interface TabsSnapshot {
  tabs: TabState[];
  activeEditorId: string | null;
}

/** Default opaque labels for a fresh untitled buffer (UWP defaults: UTF-8 / CRLF). */
export const DEFAULT_ENCODING_ID: EncodingId = 'UTF-8';
export const DEFAULT_EOL_ID: EolId = 'crlf';

/** A zeroed caret/scroll for a brand-new buffer. */
export const ZERO_CARET: CaretState = { start: 0, end: 0 };
export const ZERO_SCROLL: ScrollState = { top: 0, left: 0 };
export const DEFAULT_VIEW_MODE: ViewMode = { preview: false, diff: false };
