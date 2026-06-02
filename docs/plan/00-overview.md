# Notepads → Electron Rewrite: Implementation Plan

> **Target:** Rewrite the existing **Notepads** app (UWP, C#/XAML, RichEditBox core, source at `E:\Projects\Notepads`) into **Electron + Fluent UI (React v9) + React + TypeScript**, with **1:1 replication of the frontend and behavior**.

> **Provenance:** Produced via hyperplan — a 5-member adversarial planning team (`scope-realist`, `platform-architect`, `editor-core`, `ui-fidelity`, `migration-sequencer`) ran 3 rounds (independent analysis → cross-attack → defend/concede) over the real source. The lead distilled defensible findings; the `plan` agent authored the sequencing and verification gates.

## Plan document index

| File | Contents |
|---|---|
| `00-overview.md` | This file: architecture statement, commit strategy, execution model |
| `01-phase-0-blockers-spikes.md` | Phase 0 — blockers & de-risking spikes |
| `02-phase-1-walking-skeleton.md` | Phase 1 — walking skeleton + PA-8 security gate |
| `03-phase-2-tabs-setsview.md` | Phase 2 — tabs / SetsView |
| `04-phase-3-editor-core.md` | Phase 3 — editor core: commands, find/replace, encoding/EOL |
| `05-phase-4-fileio-session-statusbar.md` | Phase 4 — file IO, session, crash recovery, status bar |
| `06-phase-5-settings-theme.md` | Phase 5 — settings panes + live theme/accent |
| `07-phase-6-integrations.md` | Phase 6 — broker, activation, cross-window transfer, markdown, diff, print, share, i18n |
| `08-phase-7-visual-polish.md` | Phase 7 — visual polish |
| `09-phase-8-nonfunctional-release.md` | Phase 8 — non-functional acceptance & release |
| `10-appendix-keyboard-commands.md` | Keyboard / command acceptance checklist |
| `11-signoff-and-risk-register.md` | Items requiring user sign-off + risk register |

---

## 1. Architecture Statement

**Process model (3 tiers, hard boundaries):**

- **MAIN** (Node/Electron): owns ALL `fs`, `dialog`, `path`, `protocol`, encoding engines, the multi-instance broker, session persistence, and the cross-window transfer registry. Bytes are read and decoded here; only decoded strings + labels cross IPC.
- **PRELOAD**: exposes exactly one frozen, typed `window.notepads` object via `contextBridge`. This is the *sole* IPC contract. No raw `ipcRenderer`, no `@electron/remote`.
- **RENDERER** (React 18 + Fluent UI v9 + TypeScript + CodeMirror 6): UI only. No Node built-ins. Holds a `'\r'`-normalized shadow buffer for editing; never re-derives encoding/EOL.

**IPC contract shape** — `window.notepads` is namespaced, all methods `async` returning discriminated-union results `{ok:true,data} | {ok:false,error}`, plus typed event subscriptions:

```ts
window.notepads = {
  file:    { open, save, saveAs, reloadFromDisk, revalidatePath },
  encoding:{ listAnsi, decodeWith, convertEol },
  session: { snapshot, loadLast, clearRecovered },
  window:  { broker request/redirect, fullscreen, compactOverlay },
  dragOut: { begin, complete },              // cross-window transfer
  editor:  { onAdopt, onRelease },           // main→renderer push
  theme:   { get, onOsThemeChanged, onAccentChanged },
  app:     { argv/cwd activation events, protocol events },
  shell:   { openContainingFolder, copyPath, webSearch, print, share }
}
```

Each renderer-callable method maps 1:1 to an `ipcMain.handle` channel; each push event maps to a `webContents.send`. The `.d.ts` for this object is the single shared type artifact between tiers and is the contract that the PA-8 scan and Playwright suite assert against.

**Editor model:** CM6 `EditorState`/`EditorView`. MAIN sends authoritative `{decodedText, encodingId, eolId, dateModifiedMs, filePath|null}`. Renderer normalizes `decodedText` to `\n` into the CM6 doc (the shadow buffer) and keeps `encodingId`/`eolId` as opaque labels in tab state. On save, renderer sends `{shadowText (\n), encodingId, eolId}`; MAIN re-applies EOL and encodes. Undo grouping via CM6 transaction annotations: paste = 1 step (single `transaction`), replace-all = 1 step, iterative-replace = N steps, smart-trim = 0 steps (selection change only, `userEvent` excluded from history via `Transaction.addToHistory(false)`).

---

## 2. Atomic Commit Strategy (applies to every phase)

- **One conceptual change per commit.** A commit either adds a failing test, makes a test pass, or refactors with green tests — never mixes the three.
- **Conventional Commits** with a phase scope: `feat(editor): Ctrl+D duplicate-line via CM6 transaction`, `test(encoding): GB18030 round-trip corpus row`, `chore(ci): PA-8 static scan gate`.
- **TDD commit pairing:** `test(...)` commit (red) immediately precedes its `feat(...)` commit (green). The red commit is allowed to fail CI's test job *only on its own new test* — enforced by committing red tests `.skip`-free but on a feature branch that gates merge on green.
- **Gate commits are tagged:** each phase's verification gate passing is a signed tag `gate/phase-N-pass` referencing the commit where the full harness subset went green. No phase branch merges to `main` without its `gate/*` tag.
- **Workstream branches:** `ws/<phase>-<stream>` (e.g. `ws/p4-statusbar`). Parallel streams rebase onto the phase integration branch daily; the phase integration branch merges to `main` only at the gate.
- **Never** commit secrets, reference UWP golden PNGs as LFS-untracked blobs (use Git LFS), or `node_modules`.
- Every commit must leave the build green for already-completed phases (PA-8 + prior gates re-run in CI on every push).

---

## 3. Ultrawork Execution Model

Small team, 2–4 parallel workstreams. Each phase names the streams that can run concurrently and the **join point** (the gate). Default lane assignment:

- **Lane A** — MAIN/process (fs, encoding, broker, session).
- **Lane B** — Renderer/editor (CM6, commands, find/replace).
- **Lane C** — Chrome/custom components (tabs, title bar, status bar, visual effects).
- **Lane D** — Harness/CI (Playwright matrix, golden images, corpora, PA-8 scan).

Lane D runs continuously from Phase 0 and is never idle; it authors the test for each feature *before* A/B/C implement it (TDD), so the spec fixtures are the contract handed across lanes.
