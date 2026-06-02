import { describe, it, expect, beforeEach } from 'vitest';
import { TabsStore } from './useTabsStore';

/**
 * Tab lifecycle semantics (Phase 2, stream B) — docs/plan/03 tasks #4/#5 and the
 * UWP NotepadsCore / TabContextFlyout close rules. A fresh TabsStore per test so
 * the module singleton's id counters don't leak between cases.
 */
describe('TabsStore lifecycle', () => {
  let store: TabsStore;
  beforeEach(() => {
    store = new TabsStore();
  });

  it('starts empty with no active tab', () => {
    expect(store.count()).toBe(0);
    expect(store.activeEditorId).toBeNull();
  });

  it('newTab inserts and activates by default', () => {
    const id = store.newTab();
    expect(store.count()).toBe(1);
    expect(store.activeEditorId).toBe(id);
    expect(store.get(id)?.filePath).toBeNull();
  });

  it('untitled tabs get sequential "Untitled N" names', () => {
    const a = store.newTab();
    const b = store.newTab();
    expect(store.get(a)?.untitledName).toMatch(/^Untitled \d+$/);
    expect(store.get(b)?.untitledName).toMatch(/^Untitled \d+$/);
    expect(store.get(a)?.untitledName).not.toBe(store.get(b)?.untitledName);
  });

  it('newTab with activate:false keeps current selection', () => {
    const a = store.newTab();
    const b = store.newTab({ activate: false });
    expect(store.activeEditorId).toBe(a);
    expect(store.indexOf(b)).toBe(1);
  });

  it('newTab honors an explicit index', () => {
    const a = store.newTab();
    const b = store.newTab();
    const c = store.newTab({ index: 1, activate: false });
    expect(store.tabs.map((t) => t.editorId)).toEqual([a, c, b]);
  });

  it('activate switches the active tab', () => {
    const a = store.newTab();
    const b = store.newTab();
    expect(store.activeEditorId).toBe(b);
    store.activate(a);
    expect(store.activeEditorId).toBe(a);
  });

  it('activate is a no-op for an unknown id', () => {
    const a = store.newTab();
    store.activate('nope');
    expect(store.activeEditorId).toBe(a);
  });
});

describe('TabsStore.close', () => {
  let store: TabsStore;
  let a: string;
  let b: string;
  let c: string;
  beforeEach(() => {
    store = new TabsStore();
    a = store.newTab();
    b = store.newTab();
    c = store.newTab();
  });

  it('closing the active tab selects the right neighbour', () => {
    store.activate(b);
    store.close(b);
    expect(store.activeEditorId).toBe(c);
    expect(store.tabs.map((t) => t.editorId)).toEqual([a, c]);
  });

  it('closing the active LAST tab selects the new last tab', () => {
    store.activate(c);
    store.close(c);
    expect(store.activeEditorId).toBe(b);
  });

  it('closing a non-active tab keeps the current selection', () => {
    store.activate(c);
    store.close(a);
    expect(store.activeEditorId).toBe(c);
    expect(store.tabs.map((t) => t.editorId)).toEqual([b, c]);
  });

  it('closing the only tab leaves no active tab', () => {
    const solo = new TabsStore();
    const x = solo.newTab();
    solo.close(x);
    expect(solo.count()).toBe(0);
    expect(solo.activeEditorId).toBeNull();
  });
});

describe('TabsStore context-menu closes', () => {
  let store: TabsStore;
  let a: string;
  let b: string;
  let c: string;
  let d: string;
  beforeEach(() => {
    store = new TabsStore();
    a = store.newTab();
    b = store.newTab();
    c = store.newTab();
    d = store.newTab();
  });

  it('closeOthers keeps only the target and activates it', () => {
    store.closeOthers(b);
    expect(store.tabs.map((t) => t.editorId)).toEqual([b]);
    expect(store.activeEditorId).toBe(b);
  });

  it('closeToRight removes everything after the anchor', () => {
    store.activate(d);
    store.closeToRight(b);
    expect(store.tabs.map((t) => t.editorId)).toEqual([a, b]);
    // Active fell back to the anchor since d was removed.
    expect(store.activeEditorId).toBe(b);
  });

  it('closeToRight keeps active when it survives', () => {
    store.activate(a);
    store.closeToRight(b);
    expect(store.activeEditorId).toBe(a);
  });

  it('closeSaved removes only unmodified tabs', () => {
    store.setModified(b, true);
    store.setModified(d, true);
    store.activate(a); // a is saved → will be removed
    store.closeSaved();
    expect(store.tabs.map((t) => t.editorId)).toEqual([b, d]);
    // a was active & removed → fall back to the new last tab.
    expect(store.activeEditorId).toBe(d);
  });

  it('closeSaved keeps active when it is modified', () => {
    store.setModified(c, true);
    store.activate(c);
    store.closeSaved();
    expect(store.tabs.map((t) => t.editorId)).toEqual([c]);
    expect(store.activeEditorId).toBe(c);
  });
});

describe('TabsStore reorder', () => {
  let store: TabsStore;
  let a: string;
  let b: string;
  let c: string;
  beforeEach(() => {
    store = new TabsStore();
    a = store.newTab();
    b = store.newTab();
    c = store.newTab();
  });

  it('moves a tab from one index to another', () => {
    store.reorder(0, 2);
    expect(store.tabs.map((t) => t.editorId)).toEqual([b, c, a]);
  });

  it('reorderById maps ids to indices', () => {
    store.reorderById(c, a);
    expect(store.tabs.map((t) => t.editorId)).toEqual([c, a, b]);
  });

  it('preserves the active selection across reorder', () => {
    store.activate(b);
    store.reorder(0, 2);
    expect(store.activeEditorId).toBe(b);
  });

  it('is a no-op for out-of-range or equal indices', () => {
    store.reorder(0, 0);
    store.reorder(-1, 2);
    store.reorder(0, 99);
    expect(store.tabs.map((t) => t.editorId)).toEqual([a, b, c]);
  });
});

describe('TabsStore keyboard navigation', () => {
  let store: TabsStore;
  let a: string;
  let b: string;
  let c: string;
  beforeEach(() => {
    store = new TabsStore();
    a = store.newTab();
    b = store.newTab();
    c = store.newTab();
  });

  it('next wraps from last to first', () => {
    store.activate(c);
    store.next();
    expect(store.activeEditorId).toBe(a);
  });

  it('next advances one tab', () => {
    store.activate(a);
    store.next();
    expect(store.activeEditorId).toBe(b);
  });

  it('prev wraps from first to last', () => {
    store.activate(a);
    store.prev();
    expect(store.activeEditorId).toBe(c);
  });

  it('jumpTo is 1-based', () => {
    store.jumpTo(1);
    expect(store.activeEditorId).toBe(a);
    store.jumpTo(2);
    expect(store.activeEditorId).toBe(b);
  });

  it('Ctrl+9 always jumps to the LAST tab', () => {
    store.jumpTo(9);
    expect(store.activeEditorId).toBe(c);
  });

  it('jumpTo out of range is a no-op', () => {
    store.activate(b);
    store.jumpTo(8);
    expect(store.activeEditorId).toBe(b);
  });
});

describe('TabsStore field mutations', () => {
  let store: TabsStore;
  let a: string;
  beforeEach(() => {
    store = new TabsStore();
    a = store.newTab();
  });

  it('setModified toggles the dirty flag', () => {
    expect(store.get(a)?.isModified).toBe(false);
    store.setModified(a, true);
    expect(store.get(a)?.isModified).toBe(true);
  });

  it('setFilePath assigns an absolute path', () => {
    store.setFilePath(a, 'C:/x/y.txt');
    expect(store.get(a)?.filePath).toBe('C:/x/y.txt');
  });

  it('setLabels updates opaque encoding/EOL', () => {
    store.setLabels(a, 'UTF-16 LE BOM', 'lf');
    expect(store.get(a)?.encodingId).toBe('UTF-16 LE BOM');
    expect(store.get(a)?.eolId).toBe('lf');
  });

  it('snapshot reference is stable until a mutation occurs', () => {
    const s1 = store.getSnapshot();
    const s2 = store.getSnapshot();
    expect(s1).toBe(s2);
    store.setModified(a, true);
    expect(store.getSnapshot()).not.toBe(s1);
  });

  it('setModified to the same value does not churn the snapshot', () => {
    const s1 = store.getSnapshot();
    store.setModified(a, false);
    expect(store.getSnapshot()).toBe(s1);
  });
});
