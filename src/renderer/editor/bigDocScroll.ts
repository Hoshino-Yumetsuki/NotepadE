/**
 * ============================================================================
 *  Big-document scroll stabilizer — pixel-exact anchoring on huge-file edits
 * ============================================================================
 *
 * THE BUG. In a very large document (~920k lines) CodeMirror 6 swaps its height
 * model to the BigScaler: the DOM can't be taller than ~7,000,000px, so CM6
 * keeps the current viewport at 1:1 and COMPRESSES everything outside it with a
 * global `scale = (7e6 − vpHeight) / (heightMap.height − vpHeight)`. Every edit
 * that adds/removes a line changes `heightMap.height`, so `scale` changes on
 * EVERY such edit and the viewport region's scaled DOM top moves (~4px per
 * inserted line at 920k lines). On screen: content above the caret drifts up,
 * content below drifts down — both "move away" from the insertion line.
 *
 * WHY CM6'S OWN ANCHORING DOESN'T SAVE US. CM6 compensates in its measure phase
 * by re-pinning the top-of-screen line: `scrollTop += (newAnchorTop −
 * oldAnchorTop) / scaleY`. But that anchor-diff branch only runs when
 * `viewState.scrollTarget == null` — and every real typing transaction carries
 * `scrollIntoView: true` (applyDOMChange; Enter and most editing commands too),
 * which EditorView.update converts into a `ScrollTarget(head, "nearest")`.
 * The measure loop then takes the scrollTarget branch, DISCARDS the anchor
 * (`scrollAnchorHeight = -1`), and `y:"nearest"` scrolls by ZERO while the
 * caret is still visible. Net: no correction at all; the BigScaler
 * redistribution lands on screen verbatim. (The previous fix here appended yet
 * another `y:"nearest"` target via a transactionFilter — same defeated
 * mechanism, so it changed nothing.)
 *
 * THE FIX. `EditorView.scrollSnapshot()` captures a ScrollTarget with
 * `isSnapshot: true`: the top-of-screen line block plus its exact pixel offset
 * from `scrollTop`. The measure phase resolves a snapshot DETERMINISTICALLY:
 * `scrollDOM.scrollTop = lineBlockAt(ref).top − yMargin` — i.e. it re-pins the
 * reference line at its previous exact screen y AT THE NEW SCALE, before paint
 * (measure runs in the same rAF, so there is no wrong-position frame). Because
 * the whole visible region lives inside the 1:1 viewport, pinning the top line
 * pins the caret line and everything above it exactly; only content below the
 * insertion shifts, by exactly the inserted height. That is Notepad behavior.
 *
 * A snapshot must be captured with pre-edit view/DOM access, which a
 * transactionFilter does not have — so this is a `dispatchTransactions`
 * wrapper (mounted in CodeMirrorEditor.tsx), not an Extension:
 *   1. capture `view.scrollSnapshot()` BEFORE applying the transactions;
 *   2. apply the transactions;
 *   3. append one effects-only transaction carrying the snapshot mapped
 *      through the edits. Processed last, it overrides the typing
 *      transaction's own `"nearest"` target in viewState.scrollTarget.
 *
 * SCOPED TIGHTLY:
 *   - only docs past a line threshold safely below the BigScaler onset —
 *     normal documents keep CM6's native behavior verbatim;
 *   - only USER input/delete/move doc edits — programmatic setDoc /
 *     reconfigure / undo-redo / find-replace keep their own scroll semantics
 *     (undo may jump the caret far away and SHOULD scroll there);
 *   - only while the caret line sits comfortably INSIDE the visible window.
 *     Near the top/bottom edge (or off-screen) the pin is forfeited so the
 *     transaction's natural `"nearest"` target keeps the caret visible — at an
 *     edge the view must scroll anyway, so pixel-pinning is moot there.
 *
 * PA-8: pure renderer + CM6 view plumbing. No fs/path/child_process, no IPC.
 */

import type { EditorView } from '@codemirror/view';
import type { StateEffect, Transaction } from '@codemirror/state';

/**
 * Line count past which we pixel-anchor user edits. BigScaler engages when the
 * document height exceeds ~7,000,000px; at the editor's ~17px default line
 * height that is ~410k lines. We gate well above a normal large file but
 * comfortably below the BigScaler onset so the stabilizer covers the whole
 * scaled regime (and a margin of approach to it) without touching ordinary docs.
 */
export const BIG_DOC_LINE_THRESHOLD = 200_000;

/**
 * How close (in line-heights) the caret line may come to the visible window's
 * top/bottom edge before we forfeit the pixel pin and let the transaction's
 * own `"nearest"` scroll keep the caret visible. Two lines covers Enter
 * pushing the caret onto a new line below, and backspace joining onto the
 * line above.
 */
const CARET_EDGE_LINES = 2;

/**
 * Should this batch of transactions get a pixel anchor? True only for a
 * user-driven doc edit (input/delete/move) on a big document.
 */
export function isBigDocUserEdit(trs: readonly Transaction[]): boolean {
  return trs.some(
    (tr) =>
      tr.docChanged &&
      tr.startState.doc.lines >= BIG_DOC_LINE_THRESHOLD &&
      (tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move'))
  );
}

/**
 * Capture a pre-edit scroll snapshot for `trs`, or null when the batch should
 * keep CM6's native scroll behavior (small doc, non-user edit, or caret too
 * close to a window edge / off-screen — see CARET_EDGE_LINES).
 */
export function captureBigDocAnchor(
  view: EditorView,
  trs: readonly Transaction[]
): StateEffect<unknown> | null {
  if (trs.length === 0 || !isBigDocUserEdit(trs)) return null;
  const scroller = view.scrollDOM;
  const { scrollTop, clientHeight } = scroller;
  if (clientHeight <= 0) return null; // hidden editor — nothing to pin
  // Pre-edit caret. The pin only makes sense while the caret line is fully and
  // comfortably on screen; at an edge the view must scroll, so let "nearest" run.
  const head = trs[0].startState.selection.main.head;
  const block = view.lineBlockAt(head); // scaled doc-relative coords, like scrollTop
  const margin = CARET_EDGE_LINES * view.defaultLineHeight;
  if (block.top < scrollTop + margin) return null;
  if (block.bottom > scrollTop + clientHeight - margin) return null;
  return view.scrollSnapshot();
}

/**
 * `dispatchTransactions` wrapper (EditorView config) implementing the
 * pixel-exact big-document anchor. For anchored batches, applies the
 * transactions plus one trailing effects-only transaction carrying the
 * pre-edit scroll snapshot mapped through the edits; otherwise applies the
 * batch verbatim (native CM6 behavior).
 *
 * STICKY RESIDUAL FOLDING. The snapshot pin is pixel-perfect for a single
 * edit (measured: 0px over 30 frames), but each edit RE-BASES it at whatever
 * position the view currently has, and scrollTop quantization plus CM6's ±1px
 * anchor-compensation dead zone leave a sub-pixel same-direction residue per
 * edit — over hundreds of keystrokes that random-walks/ratchets into a visible
 * whole-view drift. (A naive per-edit measure-and-correct pass makes it WORSE:
 * it also re-bases per edit and was measured to double the drift; correcting
 * scrollTop a few frames AFTER the keystroke is also visible as jitter.)
 *
 * The fix is a STICKY anchor whose correction rides the NEXT keystroke's own
 * snapshot: the first edit of a typing session records the top-of-screen
 * line's exact screen y; on every subsequent edit the current residue
 * (current y − session y) is FOLDED INTO the snapshot's yMargin — per CM6's
 * ScrollTarget contract, a snapshot's yMargin IS the restored distance between
 * the reference line and the editor top, so adjusting it lands the pin exactly
 * on the session y, pre-paint, with no between-keystroke scroll writes (no
 * jitter) and no error accumulation (every pin targets the SAME absolute y).
 * The session resets when:
 *   - a non-anchored doc change or selection move goes through (undo, find,
 *     programmatic edits, caret jumps),
 *   - the residue exceeds one line height (the user scrolled away),
 *   - the typing session goes idle (> SESSION_IDLE_MS between edits).
 */

interface StickyAnchor {
  /** Doc position of the anchor (top-of-screen) line, remapped through edits. */
  pos: number;
  /** The anchor's screen y at session start — the y every pin restores. */
  top: number;
  /** Timestamp of the last anchored edit (session idle detection). */
  lastEdit: number;
}

const stickyAnchors = new WeakMap<EditorView, StickyAnchor>();

/** Gap between edits past which the typing session (and its anchor) resets. */
const SESSION_IDLE_MS = 1000;

/** Diagnostics for the harness/tests: how often the residual pass acted. */
export const bigDocDebug = {
  captures: 0,
  folds: 0,
  invalidated: 0,
  lastResidue: 0
};

function remapAnchor(view: EditorView, trs: readonly Transaction[]): void {
  const anchor = stickyAnchors.get(view);
  if (!anchor) return;
  for (const tr of trs) {
    if (tr.docChanged) anchor.pos = tr.changes.mapPos(anchor.pos, -1);
  }
}

export function bigDocDispatchTransactions(
  trs: readonly Transaction[],
  view: EditorView
): void {
  const anchor = captureBigDocAnchor(view, trs);
  if (!anchor) {
    // Any non-anchored doc change or caret move ends the typing session: the
    // sticky target would otherwise pull the view back after an intentional
    // jump (undo, find, programmatic load).
    if (trs.some((tr) => tr.docChanged || tr.selection)) {
      if (stickyAnchors.delete(view)) bigDocDebug.invalidated++;
    }
    view.update(trs);
    return;
  }
  const now = Date.now();
  let sticky = stickyAnchors.get(view);
  let residue = 0;
  if (sticky) {
    const currentTop =
      now - sticky.lastEdit > SESSION_IDLE_MS
        ? null
        : view.coordsAtPos(Math.min(sticky.pos, view.state.doc.length))?.top;
    const r = currentTop != null ? currentTop - sticky.top : null;
    if (r == null || Math.abs(r) > view.defaultLineHeight) {
      // Idle session, anchor off-screen, or an intentional move (user scroll)
      // since the last edit — start a fresh session at the current position.
      stickyAnchors.delete(view);
      sticky = undefined;
      bigDocDebug.invalidated++;
    } else {
      residue = r;
      sticky.lastEdit = now;
    }
  }
  if (!sticky) {
    // Session start: pre-edit DOM read of the top-of-screen line's screen y.
    const anchorBlock = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 8);
    const top = view.coordsAtPos(anchorBlock.from)?.top;
    if (top != null) {
      bigDocDebug.captures++;
      stickyAnchors.set(view, { pos: anchorBlock.from, top, lastEdit: now });
    }
  }
  if (residue !== 0) {
    // Fold the accumulated sub-line residue into the snapshot so the pin lands
    // back on the session y (ScrollTarget.map/clip carry yMargin through
    // unchanged, so mutating before mapping is safe — the effect is ours,
    // created by scrollSnapshot() for this dispatch only).
    bigDocDebug.folds++;
    bigDocDebug.lastResidue = residue;
    (anchor.value as { yMargin: number }).yMargin -= residue;
  }
  remapAnchor(view, trs);
  // Map the snapshot's reference position through every edit in the batch so
  // it still points at the same line afterwards. A deletion can swallow it —
  // then fall back to native behavior.
  let effect: StateEffect<unknown> | undefined = anchor;
  for (const tr of trs) {
    effect = effect.map(tr.changes);
    if (!effect) {
      stickyAnchors.delete(view);
      view.update(trs);
      return;
    }
  }
  const last = trs[trs.length - 1];
  // One atomic view.update: the trailing transaction is processed last, so its
  // snapshot target overrides the edit's own "nearest" in viewState.scrollTarget.
  view.update([...trs, last.state.update({ effects: effect })]);
}
