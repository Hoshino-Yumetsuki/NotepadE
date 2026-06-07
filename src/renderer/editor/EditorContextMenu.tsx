/**
 * Editor right-click context menu (RENDERER) — UWP TextEditorContextFlyout parity
 * (Controls/TextEditor/TextEditorContextFlyout.cs). The UWP editor's right-click
 * flyout had no equivalent in the rewrite; the commands existed only as key
 * bindings, and Share / RTL had no surfaced UI at all. This restores the flyout
 * AND gives Share + RTL their entry points.
 *
 * Item order mirrors UWP:
 *   Cut · Copy · Paste · Undo · Redo · Select All ·
 *   Right-to-Left reading order · Word Wrap · Search in web (selection only) ·
 *   Toggle Preview (markdown only) · Share / Share Selected
 *
 * The menu opens at the pointer via a CM6 `domEventHandlers.contextmenu` seam
 * (contextMenuExtension) that reports the coordinates + a live editor snapshot to
 * this hook, which renders a positioned Fluent Menu. Clipboard Cut/Copy/Paste use
 * the renderer-allowed `navigator.clipboard` (PA-8: that is a DOM API, not Node).
 *
 * PA-8: renderer-only — DOM + the typed window.notepads bridge (Share/WebSearch
 * route through the existing commands). No fs/path/child_process, no raw IPC.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MenuDivider,
} from '@fluentui/react-components';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { setLtr, setRtl } from './commands/direction';
import { toggleWordWrap } from './commands/wordWrap';
import { webSearchSelection } from './commands/webSearch';
import { useT } from '../i18n';

/** A snapshot of the editor at right-click time, used to gate items. */
interface MenuContext {
  x: number;
  y: number;
  view: EditorView;
  hasSelection: boolean;
  hasText: boolean;
}

export interface EditorContextMenuHostProps {
  /** Whether the active document supports preview (markdown). Gates the item. */
  isPreviewEligible: boolean;
  /** Toggle the preview pane for the active editor. */
  onTogglePreview: () => void;
  /** Share the current document (or selection) — routes through useShare. */
  onShare: (selectionOnly: boolean) => void;
}

export interface EditorContextMenuHost {
  /** CM6 extension every editor mounts — opens the menu on contextmenu. */
  extension: Extension;
  /** The positioned Fluent menu element (render once near the editor host). */
  menu: JSX.Element | null;
}

/** Read the clipboard and insert as plain text at the current selection. */
async function pastePlainText(view: EditorView): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text.length === 0) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
    });
    view.focus();
  } catch {
    // Clipboard read can be denied; fail silently (UWP also no-oped on failure).
  }
}

/** Copy the current selection to the clipboard (plain text). */
async function copySelection(view: EditorView): Promise<void> {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  try {
    await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
  } catch {
    /* denied — no-op */
  }
}

/** Cut: copy the selection then delete it (one undo step). */
async function cutSelection(view: EditorView): Promise<void> {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  await copySelection(view);
  view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } });
  view.focus();
}

export function useEditorContextMenu(props: EditorContextMenuHostProps): EditorContextMenuHost {
  const { isPreviewEligible, onTogglePreview, onShare } = props;
  const { t } = useT();
  const [ctx, setCtx] = useState<MenuContext | null>(null);

  const open = useCallback((view: EditorView, e: MouseEvent): void => {
    e.preventDefault();
    const sel = view.state.selection.main;
    setCtx({
      x: e.clientX,
      y: e.clientY,
      view,
      hasSelection: !sel.empty,
      hasText: view.state.doc.length > 0,
    });
  }, []);

  const extension = useMemo(
    () =>
      EditorView.domEventHandlers({
        contextmenu: (e, view) => {
          open(view, e);
          return true;
        },
      }),
    [open],
  );

  const close = (): void => setCtx(null);
  /** Run a fn against the captured view, then close the menu. */
  const run = (fn: (view: EditorView) => void): (() => void) => {
    return () => {
      if (ctx) fn(ctx.view);
      close();
    };
  };

  const menu = ctx ? (
    <Menu
      open
      onOpenChange={(_e, data) => {
        if (!data.open) close();
      }}
      positioning={{
        target: { getBoundingClientRect: () => new DOMRect(ctx.x, ctx.y, 0, 0) },
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <span style={{ position: 'fixed', left: ctx.x, top: ctx.y, width: 0, height: 0 }} />
      </MenuTrigger>
      <MenuPopover data-testid="editor-context-menu">
        <MenuList>
          <MenuItem
            data-testid="ctx-cut"
            disabled={!ctx.hasSelection}
            onClick={run((v) => void cutSelection(v))}
          >
            {t('TextEditor_ContextFlyout_CutButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="ctx-copy"
            disabled={!ctx.hasSelection}
            onClick={run((v) => void copySelection(v))}
          >
            {t('TextEditor_ContextFlyout_CopyButtonDisplayText')}
          </MenuItem>
          <MenuItem data-testid="ctx-paste" onClick={run((v) => void pastePlainText(v))}>
            {t('TextEditor_ContextFlyout_PasteButtonDisplayText')}
          </MenuItem>
          <MenuItem data-testid="ctx-undo" onClick={run((v) => void undo(v))}>
            {t('TextEditor_ContextFlyout_UndoButtonDisplayText')}
          </MenuItem>
          <MenuItem data-testid="ctx-redo" onClick={run((v) => void redo(v))}>
            {t('TextEditor_ContextFlyout_RedoButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="ctx-selectall"
            onClick={run((v) => v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }))}
          >
            {t('TextEditor_ContextFlyout_SelectAllButtonDisplayText')}
          </MenuItem>
          <MenuDivider />
          {ctx.hasText ? (
            <MenuItem data-testid="ctx-rtl" onClick={run((v) => void toggleReadingOrder(v))}>
              {t('TextEditor_ContextFlyout_RightToLeftReadingOrderButtonDisplayText')}
            </MenuItem>
          ) : null}
          <MenuItem data-testid="ctx-wordwrap" onClick={run((v) => void toggleWordWrap(v))}>
            {t('TextEditor_ContextFlyout_WordWrapButtonDisplayText')}
          </MenuItem>
          {ctx.hasSelection ? (
            <MenuItem data-testid="ctx-websearch" onClick={run((v) => void webSearchSelection(v))}>
              {t('TextEditor_ContextFlyout_WebSearchButtonDisplayText')}
            </MenuItem>
          ) : null}
          {isPreviewEligible ? (
            <MenuItem
              data-testid="ctx-preview"
              onClick={() => {
                onTogglePreview();
                close();
              }}
            >
              {t('TextEditor_ContextFlyout_PreviewToggleDisplay_Text')}
            </MenuItem>
          ) : null}
          <MenuItem
            data-testid="ctx-share"
            onClick={() => {
              onShare(ctx.hasSelection);
              close();
            }}
          >
            {ctx.hasSelection
              ? t('TextEditor_ContextFlyout_ShareSelectedButtonDisplayText')
              : t('TextEditor_ContextFlyout_ShareButtonDisplayText')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  ) : null;

  return { extension, menu };
}

/** Toggle LTR/RTL reading order based on the current direction (UWP flip). */
function toggleReadingOrder(view: EditorView): void {
  // CM6 derives textDirection from the content DOM `dir`; Direction.RTL === 1.
  if (view.textDirection === 1) setLtr(view);
  else setRtl(view);
}
