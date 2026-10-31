import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { OpenedFile, Result, SaveArgs, SaveAsArgs, SaveResult } from "@shared/ipc-contract"
import type { MonacoHandle } from "../editor/MonacoEditor"
import { useDirtyState } from "../editor/useDirtyState"
import { TabsStore } from "../tabs/useTabsStore"
import { useFilePipeline } from "./useFilePipeline"

const hash = (text: string): number => {
  let value = 0
  for (let i = 0; i < text.length; i++) value = value * 31 + text.charCodeAt(i)
  return value
}
const baseline = (text: string) => ({ hash: hash(text), length: text.length, eolId: "lf" as const })
const opened = (text: string, encodingId = "UTF-8"): OpenedFile => ({
  decodedText: text,
  encodingId,
  eolId: "lf",
  dateModifiedMs: 42,
  filePath: "/a.txt",
  hasBom: false,
  baselineHash: hash(text),
  baselineLength: text.length
})

function setup() {
  const store = new TabsStore()
  const handles = { current: new Map<string, MonacoHandle | null>() }
  const disk = new Map<string, { text: string; encodingId: string }>()
  const save = async (args: SaveArgs): Promise<Result<SaveResult>> => {
    const text = args.shadowText ?? ""
    const encodingId = args.encodingId ?? "UTF-8"
    const separator = args.eolId === "crlf" ? "\r\n" : args.eolId === "cr" ? "\r" : "\n"
    disk.set(args.filePath, { text: text.replace(/\n/g, separator), encodingId })
    return {
      ok: true,
      data: {
        filePath: args.filePath,
        dateModifiedMs: 42,
        encodingId,
        eolId: args.eolId ?? "lf",
        baselineHash: hash(text),
        baselineLength: text.length
      }
    }
  }
  const bridge = {
    file: {
      save: vi.fn(save),
      saveAs: vi.fn((args: SaveAsArgs) => save({ ...args, filePath: "/new.txt" })),
      reloadFromDisk: vi.fn(async (): Promise<Result<OpenedFile>> => ({
        ok: true,
        data: opened("disk text")
      }))
    },
    encoding: {
      decodeWith: vi.fn(async (): Promise<Result<OpenedFile>> => ({
        ok: true,
        data: opened("decoded text", "UTF-16 LE BOM")
      }))
    },
    hash: { compute: vi.fn(async (text: string) => ({ ok: true as const, data: hash(text) })) }
  }
  const testWindow = window as unknown as { notepads: unknown }
  testWindow.notepads = bridge
  const hook = renderHook(() => {
    const dirty = useDirtyState(store, handles)
    return {
      ...dirty,
      ...useFilePipeline({
        store,
        editorHandles: handles,
        lastSavedTextRef: dirty.lastSavedTextRef,
        baselineRef: dirty.baselineRef
      })
    }
  })
  function add(text: string, filePath: string | null = "/a.txt") {
    const id = store.newTab({ filePath, encodingId: "UTF-8", eolId: "lf" })
    let value = text
    let version = 1
    const model = {
      getValueLength: () => value.length,
      getVersionId: () => version,
      isDisposed: () => false
    }
    const handle = {
      setDoc: (next: string) => {
        value = next
        version += 1
      },
      getShadowText: () => value,
      getEditor: () => ({ getModel: () => model })
    } as unknown as MonacoHandle
    handles.current.set(id, handle)
    hook.result.current.lastSavedTextRef.current.set(id, text)
    hook.result.current.baselineRef.current.set(id, baseline(text))
    return {
      id,
      handle,
      edit: (next: string) => {
        handle.setDoc(next)
        hook.result.current.recomputeDirty(id)
      }
    }
  }
  return { store, handles, disk, bridge, hook, add }
}

afterEach(() => {
  const testWindow = window as unknown as { notepads?: unknown }
  delete testWindow.notepads
})

describe("file pipeline", () => {
  it.each([
    ["specified encoding", "UTF-16 LE BOM", "decoded text"],
    ["disk reload", undefined, "disk text"]
  ])("replaces the document and clean baseline on %s", async (_name, encoding, expected) => {
    const { hook, store, add } = setup()
    const tab = add("original")
    tab.edit("unsaved changes")
    expect(store.get(tab.id)?.isModified).toBe(true)
    await act(async () => {
      expect(await hook.result.current.doReload(tab.id, encoding)).toBe(true)
    })
    expect(tab.handle.getShadowText()).toBe(expected)
    expect(hook.result.current.lastSavedTextRef.current.get(tab.id)).toBe(expected)
    expect(hook.result.current.baselineRef.current.get(tab.id)).toMatchObject(baseline(expected))
    expect(store.get(tab.id)).toMatchObject({
      isModified: false,
      encodingId: encoding ?? "UTF-8",
      eolId: "lf"
    })
    tab.edit(expected + "!")
    expect(store.get(tab.id)?.isModified).toBe(true)
  })

  it("reverts an untitled buffer to an empty clean document", async () => {
    const { hook, store, add } = setup()
    const tab = add("", null)
    tab.edit("unsaved text")
    await act(async () => {
      expect(await hook.result.current.doReload(tab.id)).toBe(true)
    })
    expect(tab.handle.getShadowText()).toBe("")
    expect(store.get(tab.id)).toMatchObject({ filePath: null, isModified: false })
    expect(hook.result.current.lastSavedTextRef.current.has(tab.id)).toBe(false)
    expect(hook.result.current.baselineRef.current.has(tab.id)).toBe(false)
  })

  it.each([
    ["modified file", "/a.txt", true],
    ["clean file", "/a.txt", false],
    ["untitled", null, true]
  ] as const)(
    "saves current text with the selected encoding for a %s",
    async (_name, path, modified) => {
      const { hook, store, disk, add } = setup()
      const tab = add("original", path)
      if (modified) tab.edit("current edited text")
      const expected = modified ? "current edited text" : "original"
      await act(async () => {
        expect(await hook.result.current.doSave(tab.id, { encodingId: "UTF-16 LE BOM" })).toBe(true)
      })
      const savedPath = path ?? "/new.txt"
      expect(disk.get(savedPath)).toEqual({ text: expected, encodingId: "UTF-16 LE BOM" })
      expect(tab.handle.getShadowText()).toBe(expected)
      expect(store.get(tab.id)).toMatchObject({
        filePath: savedPath,
        encodingId: "UTF-16 LE BOM",
        isModified: false
      })
      expect(hook.result.current.lastSavedTextRef.current.get(tab.id)).toBe(expected)
      expect(hook.result.current.baselineRef.current.get(tab.id)).toMatchObject(baseline(expected))
    }
  )

  it("preserves newer edits while an encoding save is in flight", async () => {
    const { hook, store, bridge, disk, add } = setup()
    const tab = add("original")
    tab.edit("saved text")
    const save = bridge.file.save.getMockImplementation()!
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    bridge.file.save.mockImplementationOnce(async (args) => {
      await gate
      return save(args)
    })
    const pending = hook.result.current.doSave(tab.id, { encodingId: "UTF-16 LE BOM" })
    tab.edit("newer text")
    await act(async () => {
      finish()
      expect(await pending).toBe(true)
    })
    expect(disk.get("/a.txt")).toEqual({ text: "saved text", encodingId: "UTF-16 LE BOM" })
    expect(tab.handle.getShadowText()).toBe("newer text")
    expect(store.get(tab.id)).toMatchObject({ isModified: true, encodingId: "UTF-16 LE BOM" })
    expect(hook.result.current.lastSavedTextRef.current.get(tab.id)).toBe("saved text")
    expect(hook.result.current.baselineRef.current.get(tab.id)).toMatchObject(
      baseline("saved text")
    )
  })

  it("keeps an EOL change dirty when text is restored and saves the selected EOL", async () => {
    const { hook, store, disk, add } = setup()
    const tab = add("first\nsecond")
    hook.result.current.baselineRef.current.set(tab.id, {
      ...baseline("first\nsecond"),
      eolId: "lf"
    })
    store.setLabels(tab.id, "UTF-8", "crlf")
    store.setModified(tab.id, true)
    await act(async () => {
      tab.edit("changed")
      tab.edit("first\nsecond")
      await Promise.resolve()
    })
    expect(store.get(tab.id)?.isModified).toBe(true)
    await act(async () => {
      expect(await hook.result.current.doSave(tab.id)).toBe(true)
    })
    expect(disk.get("/a.txt")).toEqual({ text: "first\r\nsecond", encodingId: "UTF-8" })
    expect(store.get(tab.id)).toMatchObject({ eolId: "crlf", isModified: false })
    expect(hook.result.current.baselineRef.current.get(tab.id)).toMatchObject({
      ...baseline("first\nsecond"),
      eolId: "crlf"
    })
  })

  it("keeps edited content, labels and baseline when reload or save fails", async () => {
    const { hook, store, bridge, add } = setup()
    const tab = add("original")
    tab.edit("unsaved changes")
    bridge.encoding.decodeWith.mockResolvedValueOnce({ ok: false, error: "read failed" })
    bridge.file.save.mockResolvedValueOnce({ ok: false, error: "write failed" })
    await act(async () => {
      expect(await hook.result.current.doReload(tab.id, "UTF-16 LE BOM")).toBe(false)
      expect(await hook.result.current.doSave(tab.id, { encodingId: "UTF-16 LE BOM" })).toBe(false)
    })
    expect(tab.handle.getShadowText()).toBe("unsaved changes")
    expect(store.get(tab.id)).toMatchObject({ encodingId: "UTF-8", isModified: true })
    expect(hook.result.current.lastSavedTextRef.current.get(tab.id)).toBe("original")
    expect(hook.result.current.baselineRef.current.get(tab.id)).toMatchObject(baseline("original"))
  })

  it("applies an asynchronous reload to its original tab, not the newly active tab", async () => {
    const { hook, store, bridge, add } = setup()
    const first = add("first")
    const second = add("second", "/b.txt")
    store.activate(first.id)
    let finish!: (result: Result<OpenedFile>) => void
    bridge.file.reloadFromDisk.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = hook.result.current.doReload(first.id)
    store.activate(second.id)
    await act(async () => {
      finish({ ok: true, data: opened("new first") })
      await pending
    })
    expect(first.handle.getShadowText()).toBe("new first")
    expect(second.handle.getShadowText()).toBe("second")
    expect(hook.result.current.lastSavedTextRef.current.get(second.id)).toBe("second")
    expect(store.activeEditorId).toBe(second.id)
  })

  it("does not write to a closed tab or its old editor after reload completes", async () => {
    const { hook, store, bridge, handles, add } = setup()
    const tab = add("original")
    let finish!: (result: Result<OpenedFile>) => void
    bridge.file.reloadFromDisk.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = hook.result.current.doReload(tab.id)
    store.close(tab.id)
    handles.current.delete(tab.id)
    hook.result.current.lastSavedTextRef.current.delete(tab.id)
    hook.result.current.baselineRef.current.delete(tab.id)
    await act(async () => {
      finish({ ok: true, data: opened("new text") })
      await pending
    })
    expect(tab.handle.getShadowText()).toBe("original")
    expect(hook.result.current.lastSavedTextRef.current.has(tab.id)).toBe(false)
    expect(hook.result.current.baselineRef.current.has(tab.id)).toBe(false)
  })
})
