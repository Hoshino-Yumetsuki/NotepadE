/**
 * Path utilities for the renderer.
 * These helpers perform path manipulation in a platform-agnostic way (supporting both \ and / separators)
 * without requiring the Node 'path' module (PA-8).
 */

/**
 * Extracts the trailing name component of a path.
 */
export function getBasename(path: string): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Extracts the trailing name component of a folder path, ignoring trailing slashes.
 */
export function getFolderBasename(path: string): string {
  if (!path) return '';
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Returns the display title for a tab.
 */
export interface TabLike {
  filePath: string | null;
  untitledName?: string;
}

export function getTabTitle(tab: TabLike): string {
  if (tab.filePath === null) {
    return tab.untitledName || 'Untitled';
  }
  return getBasename(tab.filePath);
}
