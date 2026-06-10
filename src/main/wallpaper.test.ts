/**
 * Wallpaper lifecycle unit tests — MAIN, electron-free.
 *
 * Covers the PURE seams of wallpaper.ts (per the mru.test.ts / window-bounds
 * convention — the electron-touching dialog/net/settings wiring stays e2e):
 *   - extension/content-type/mime validation (the security gates),
 *   - managed file-name generation + the persisted-name safety check
 *     (no traversal, no foreign extensions),
 *   - the managed-folder fs primitives against a REAL temp dir: write creates
 *     the folder on demand, delete removes the previous file (the
 *     no-orphan-accumulation rule) and refuses unsafe names.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_WALLPAPER_BYTES,
  buildWallpaperFileName,
  deleteManagedWallpaper,
  enqueueWallpaperMutation,
  extensionForContentType,
  imageExtensionOf,
  isAllowedImageExtension,
  isSafeWallpaperFileName,
  mimeForExtension,
  writeManagedWallpaper
} from './wallpaper';

describe('image extension / content-type validation', () => {
  it('extracts the lower-cased extension from a path', () => {
    expect(imageExtensionOf('C:/pics/photo.PNG')).toBe('png');
    expect(imageExtensionOf('/home/u/a.jpeg')).toBe('jpeg');
    expect(imageExtensionOf('noext')).toBe('');
  });

  it('allows the raster set and rejects everything else (incl. svg)', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'PNG']) {
      expect(isAllowedImageExtension(ext)).toBe(true);
    }
    // svg is EXCLUDED on purpose (scriptable format); exe/html are obviously out.
    for (const ext of ['svg', 'exe', 'html', 'js', '']) {
      expect(isAllowedImageExtension(ext)).toBe(false);
    }
  });

  it('maps allowed content-types to the canonical extension', () => {
    expect(extensionForContentType('image/png')).toBe('png');
    expect(extensionForContentType('image/jpeg')).toBe('jpg');
    expect(extensionForContentType('IMAGE/WebP')).toBe('webp');
    // charset suffix is tolerated (some CDNs append it).
    expect(extensionForContentType('image/png; charset=binary')).toBe('png');
  });

  it('REJECTS non-image content-types (the download gate)', () => {
    expect(extensionForContentType('text/html')).toBeNull();
    expect(extensionForContentType('image/svg+xml')).toBeNull();
    expect(extensionForContentType('application/octet-stream')).toBeNull();
    expect(extensionForContentType(null)).toBeNull();
    expect(extensionForContentType('')).toBeNull();
  });

  it('resolves the data-URL mime for a managed extension', () => {
    expect(mimeForExtension('png')).toBe('image/png');
    expect(mimeForExtension('jpg')).toBe('image/jpeg');
    expect(mimeForExtension('svg')).toBeNull();
  });

  it('caps wallpapers at 20MB', () => {
    expect(MAX_WALLPAPER_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('managed file naming', () => {
  it('builds a timestamped name that round-trips the safety check', () => {
    const name = buildWallpaperFileName('PNG', 1234567890);
    expect(name).toBe('wallpaper-1234567890.png');
    expect(isSafeWallpaperFileName(name)).toBe(true);
  });

  it('successive names differ (replace never overwrites in place)', () => {
    expect(buildWallpaperFileName('png', 1)).not.toBe(buildWallpaperFileName('png', 2));
  });

  it('rejects traversal / separators / foreign extensions in persisted names', () => {
    // Settings.json is hand-editable; only names this module generated resolve.
    expect(isSafeWallpaperFileName('../Settings.json')).toBe(false);
    expect(isSafeWallpaperFileName('wallpaper-1/..\\x.png')).toBe(false);
    expect(isSafeWallpaperFileName('wallpaper-1.svg')).toBe(false);
    expect(isSafeWallpaperFileName('wallpaper-1.exe')).toBe(false);
    expect(isSafeWallpaperFileName('other-1.png')).toBe(false);
    expect(isSafeWallpaperFileName('')).toBe(false);
  });
});

describe('managed-folder fs primitives', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'np-wallpaper-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a managed file, creating the folder on demand', async () => {
    const nested = join(dir, 'wallpaper'); // not yet existing
    const target = await writeManagedWallpaper(nested, 'wallpaper-1.png', Buffer.from('img'));
    expect(target).toBe(join(nested, 'wallpaper-1.png'));
    expect((await readFile(target)).toString()).toBe('img');
  });

  it('deletes the previous managed file on replace (no orphan accumulation)', async () => {
    const oldName = 'wallpaper-1.png';
    await writeManagedWallpaper(dir, oldName, Buffer.from('old'));
    await writeManagedWallpaper(dir, 'wallpaper-2.jpg', Buffer.from('new'));
    await deleteManagedWallpaper(dir, oldName);
    await expect(stat(join(dir, oldName))).rejects.toMatchObject({ code: 'ENOENT' });
    // The replacement survives.
    expect((await readFile(join(dir, 'wallpaper-2.jpg'))).toString()).toBe('new');
  });

  it('delete is a silent no-op for a missing file (replace must not fail)', async () => {
    await expect(deleteManagedWallpaper(dir, 'wallpaper-9.png')).resolves.toBeUndefined();
  });

  it('delete REFUSES unsafe names (defense in depth)', async () => {
    // A hand-edited Settings.json must not be able to aim the delete at
    // arbitrary files: plant a non-managed file and try to delete it by name.
    const victim = join(dir, 'Settings.json');
    await writeFile(victim, '{}', 'utf8');
    await deleteManagedWallpaper(dir, 'Settings.json');
    expect((await readFile(victim)).toString()).toBe('{}'); // untouched
  });
});

describe('enqueueWallpaperMutation (orphan-race serializer)', () => {
  it('runs queued mutations strictly in order, never interleaved', async () => {
    // Reproduce the review's race shape: op A is slow (URL set), op B is fast
    // (Browse pick). Un-serialized, B's critical section would run INSIDE A's;
    // the queue must instead complete A fully before B starts.
    const events: string[] = [];
    const a = enqueueWallpaperMutation(async () => {
      events.push('A:start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('A:end');
      return 'a';
    });
    const b = enqueueWallpaperMutation(async () => {
      events.push('B:start');
      events.push('B:end');
      return 'b';
    });
    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b']);
    expect(events).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
  });

  it('a REJECTED mutation does not wedge the chain (next op still runs)', async () => {
    const failing = enqueueWallpaperMutation(async () => {
      throw new Error('boom');
    });
    const next = enqueueWallpaperMutation(async () => 'recovered');
    // The caller still observes the real failure...
    await expect(failing).rejects.toThrow('boom');
    // ...but the chain keeps serving subsequent mutations.
    await expect(next).resolves.toBe('recovered');
  });
});
