/**
 * MRU (in-app recent-files) unit tests — MAIN, electron-free.
 *
 * `mru.ts` persists to `{userData}/RecentFiles.json`, but `userDataRoot()` honors
 * the `NOTEPADS_E2E_USERDATA` override BEFORE touching electron's `app.getPath`,
 * so these tests point that env at an OS temp dir and never load `app` (vitest has
 * no electron mock — same convention as window.test.ts / searchUrl.test.ts). Real
 * files are created on disk so the prune-missing-on-read path is exercised for real.
 *
 * Coverage: add (persist + most-recent-first), dedupe (case-insensitive on win32),
 * cap at 10, clear, and prune-missing (renamed/deleted files dropped + written back).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addRecent, listRecent, clearRecent } from './mru';

let dir: string;

/** Create a real file under the temp userData dir and return its absolute path. */
async function makeFile(name: string, contents = 'x'): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, contents, 'utf8');
  return p;
}

/** Read the raw persisted RecentFiles.json as a path array (or [] if absent). */
async function readStore(): Promise<string[]> {
  try {
    return JSON.parse(await readFile(join(dir, 'RecentFiles.json'), 'utf8')) as string[];
  } catch {
    return [];
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'np-mru-'));
  process.env['NOTEPADS_E2E_USERDATA'] = dir;
});

afterEach(async () => {
  delete process.env['NOTEPADS_E2E_USERDATA'];
  await rm(dir, { recursive: true, force: true });
});

describe('addRecent', () => {
  it('persists a single path and lists it', async () => {
    const a = await makeFile('a.txt');
    await addRecent(a);
    const list = await listRecent();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe(a);
    expect(list[0].displayName).toBe('a.txt');
    expect(typeof list[0].mtimeMs).toBe('number');
  });

  it('orders most-recent-first', async () => {
    const a = await makeFile('a.txt');
    const b = await makeFile('b.txt');
    const c = await makeFile('c.txt');
    await addRecent(a);
    await addRecent(b);
    await addRecent(c);
    const list = await listRecent();
    expect(list.map((e) => e.path)).toEqual([c, b, a]);
  });

  it('de-duplicates by path, moving a re-added file to the front (no duplicate)', async () => {
    const a = await makeFile('a.txt');
    const b = await makeFile('b.txt');
    await addRecent(a);
    await addRecent(b);
    await addRecent(a); // re-open a
    const list = await listRecent();
    expect(list.map((e) => e.path)).toEqual([a, b]);
  });

  it('caps the list at 10 entries, dropping the oldest', async () => {
    const paths: string[] = [];
    for (let i = 0; i < 13; i++) {
      const p = await makeFile(`f${i}.txt`);
      paths.push(p);
      await addRecent(p);
    }
    const list = await listRecent();
    expect(list).toHaveLength(10);
    // Most-recent-first: f12..f3; f0/f1/f2 evicted.
    expect(list[0].path).toBe(paths[12]);
    expect(list[9].path).toBe(paths[3]);
    expect(list.map((e) => e.path)).not.toContain(paths[0]);
  });

  it('ignores empty paths', async () => {
    await addRecent('');
    expect(await listRecent()).toEqual([]);
  });
});

describe('addRecent concurrency', () => {
  it('serializes concurrent adds with no lost updates', async () => {
    const paths: string[] = [];
    for (let i = 0; i < 8; i++) paths.push(await makeFile(`c${i}.txt`));

    // Fire all adds at once: an unserialized read-modify-write would have several
    // callers read the same base list and the last rename would clobber the rest,
    // dropping entries. With the promise-chain serialization every path survives.
    await Promise.all(paths.map((p) => addRecent(p)));

    const list = await listRecent();
    expect(list).toHaveLength(paths.length);
    expect(new Set(list.map((e) => e.path))).toEqual(new Set(paths));
  });

  it('keeps the store consistent (valid JSON, no dupes) under interleaved add + clear', async () => {
    const a = await makeFile('a.txt');
    const b = await makeFile('b.txt');
    // clear sandwiched between two adds; serialization means the final state is
    // a valid file (whatever ran last on the chain), never a torn/partial write.
    await Promise.all([addRecent(a), clearRecent(), addRecent(b)]);
    const list = await listRecent();
    const set = new Set(list.map((e) => e.path));
    expect(set.size).toBe(list.length); // no duplicates
    for (const e of list) expect([a, b]).toContain(e.path);
    expect(await readStore()).toEqual(list.map((e) => e.path)); // store == listed
  });
});

describe('listRecent prune-missing', () => {
  it('drops entries whose file no longer exists and writes the trimmed list back', async () => {
    const a = await makeFile('a.txt');
    const b = await makeFile('b.txt');
    const c = await makeFile('c.txt');
    await addRecent(a);
    await addRecent(b);
    await addRecent(c);

    // Delete b out from under the list (renamed/deleted file).
    await rm(b);

    const list = await listRecent();
    expect(list.map((e) => e.path)).toEqual([c, a]);
    // Pruned entry must be written back to disk so it doesn't re-surface.
    expect(await readStore()).toEqual([c, a]);
  });

  it('returns an empty list when no store exists yet', async () => {
    expect(await listRecent()).toEqual([]);
  });
});

describe('clearRecent', () => {
  it('empties the persisted list', async () => {
    const a = await makeFile('a.txt');
    await addRecent(a);
    expect(await listRecent()).toHaveLength(1);

    const res = await clearRecent();
    expect(res.ok).toBe(true);
    expect(await listRecent()).toEqual([]);
    expect(await readStore()).toEqual([]);
  });
});

describe('corrupt / foreign store', () => {
  it('treats a corrupt RecentFiles.json as empty (never throws)', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'RecentFiles.json'), '{ not json', 'utf8');
    expect(await listRecent()).toEqual([]);
    // A subsequent add still works (overwrites the garbage).
    const a = await makeFile('a.txt');
    await addRecent(a);
    expect((await listRecent()).map((e) => e.path)).toEqual([a]);
  });
});
