/** Callback bridge for the Alt+P preview and Alt+D diff commands. */

/** Callbacks the Alt+P / Alt+D view-mode handler calls into. */
export interface ViewModeCallbacks {
  isPreviewEligible: () => boolean;
  togglePreview: () => void;
  toggleDiff: () => void;
}

/** Mutable ref bridging React state into the editor's keydown handler. */
export const viewModeCallbacksRef: { current: ViewModeCallbacks | null } = { current: null };
