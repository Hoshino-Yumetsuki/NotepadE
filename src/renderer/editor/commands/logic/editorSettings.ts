/**
 * Plain (non-Facet) editor settings module — zero @codemirror imports.
 *
 * Re-exports the pure interface, defaults, and helpers from editorSettings.ts
 * so Monaco command wiring (T3) can import them without pulling in CM6.
 */

export type { TabAsSpaces, SearchEngineId, EditorSettings } from '../../editorSettings';
export { DEFAULT_EDITOR_SETTINGS, normalizeTabAsSpaces, indentString } from '../../editorSettings';
