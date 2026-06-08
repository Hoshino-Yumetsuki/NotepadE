import { describe, it, expect, beforeEach } from 'vitest';
import { TabsStore } from './useTabsStore';
import { applyAdopt, type TransferTextSource } from './transferWiring';
import type { AdoptPayload } from '@shared/ipc-contract';

/**
 * Cross-window adopt (Task #20, R3) — the editorSeq is per-renderer, so two
 * windows both mint "editor-1". When window-1 transfers ITS editor-1 to window-2
 * (which already owns its own editor-1 blank tab), applyAdopt must NOT collide on
 * the id and activate w2's blank tab; it must mint a FRESH local id and seed the
 * adopted document. This regresses the "empty adopt doc" bug.
 */
describe('applyAdopt cross-window editorId collision', () => {
  let store: TabsStore;
  let seeded: Array<{ editorId: string; text: string }>;
  let source: TransferTextSource;

  beforeEach(() => {
    store = new TabsStore();
    seeded = [];
    source = {
      getLastSavedText: () => '',
      getPendingText: () => '',
      seedAdoptedDoc: (editorId, text) => seeded.push({ editorId, text })
    };
  });

  function adoptPayload(editorId: string, decodedText: string): AdoptPayload {
    return {
      editorId,
      file: {
        decodedText,
        encodingId: 'utf-8',
        eolId: 'lf',
        dateModifiedMs: 0,
        filePath: '/work/note.txt',
        hasBom: false
      },
      pendingText: null,
      isModified: false,
      dropIndex: 1,
      viewMode: { preview: false, diff: false }
    };
  }

  it('seeds the adopted doc even when the source editorId already exists locally', () => {
    // Target window already owns a tab whose id equals the source's (collision).
    store.newTab({ editorId: 'editor-1', untitledName: '' });
    expect(store.count()).toBe(1);

    const newId = applyAdopt(store, source, adoptPayload('editor-1', 'ADOPTED'));

    // A second, distinct tab landed — the blank tab was not just re-activated.
    expect(store.count()).toBe(2);
    expect(newId).not.toBe('editor-1');
    expect(store.activeEditorId).toBe(newId);
    // The adopted document was seeded under the fresh local id, not dropped.
    expect(seeded).toEqual([{ editorId: newId, text: 'ADOPTED' }]);
  });

  it('mints a fresh local id (does not reuse the source window namespace)', () => {
    const newId = applyAdopt(store, source, adoptPayload('editor-1', 'X'));
    expect(newId).toMatch(/^editor-\d+$/);
    expect(store.get(newId)?.filePath).toBe('/work/note.txt');
  });

  it('seeds pendingText when the adopted tab is modified', () => {
    const p = adoptPayload('editor-1', 'baseline');
    p.isModified = true;
    p.pendingText = 'dirty';
    const newId = applyAdopt(store, source, p);
    expect(seeded).toEqual([{ editorId: newId, text: 'dirty' }]);
  });
});
