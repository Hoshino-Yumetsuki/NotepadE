/** Mutable callback bridge for the editor's app-wide word-wrap command. */
export const wordWrapToggleRef: { current: (() => void) | null } = { current: null };
