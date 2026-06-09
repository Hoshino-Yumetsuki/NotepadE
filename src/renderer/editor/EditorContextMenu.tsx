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
  MenuDivider
} from '@fluentui/react-components';
import {
  CutRegular,
  CopyRegular,
  ClipboardPasteRegular,
  ArrowUndoRegular,
  ArrowRedoRegular,
  SelectAllOnRegular,
  GlobeRegular,
  EyeRegular,
  ShareRegular,
  CheckmarkRegular
} from '@fluentui/react-icons';
import type { FC } from 'react';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { setLtr, setRtl } from './commands/direction';
import { toggleWordWrapPreferGlobal, wordWrapField } from './commands/wordWrap';
import { webSearchSelection } from './commands/webSearch';
import { useT } from '../i18n';
import { modKey } from '@shared/platform';

const CtxGlyph = {
  cut: CutRegular as FC,
  copy: CopyRegular as FC,
  paste: ClipboardPasteRegular as FC,
  undo: ArrowUndoRegular as FC,
  redo: ArrowRedoRegular as FC,
  selectAll: SelectAllOnRegular as FC,
  webSearch: GlobeRegular as FC,
  preview: EyeRegular as FC,
  share: ShareRegular as FC,
  check: CheckmarkRegular as FC
} as const;

/** Render a Fluent UI icon in the menu icon slot. */
function Glyph(props: { icon: FC }): JSX.Element {
  const Icon = props.icon;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20
      }}
    >
      <Icon />
    </span>
  );
}

/** Icon slot for a checkmark-TOGGLE item. */
function ToggleIcon({ on }: { on: boolean }): JSX.Element {
  return on ? <Glyph icon={CtxGlyph.check} /> : <span aria-hidden style={{ width: 20 }} />;
}

/** A snapshot of the editor at right-click time, used to gate items. */
interface MenuContext {
  x: number;
  y: number;
  view: EditorView;
  hasSelection: boolean;
  hasText: boolean;
  /** Live word-wrap state — drives the Word Wrap checkmark (UWP Icon.Visibility). */
  wordWrap: boolean;
  /** True when the editor is currently RTL — drives the RTL checkmark. */
  rtl: boolean;
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
      scrollIntoView: true
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
      wordWrap: view.state.field(wordWrapField, false) ?? false,
      // CM6 Direction.RTL === 1 (derived from the content DOM `dir`).
      rtl: view.textDirection === 1
    });
  }, []);

  const extension = useMemo(
    () =>
      EditorView.domEventHandlers({
        contextmenu: (e, view) => {
          open(view, e);
          return true;
        }
      }),
    [open]
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
        target: { getBoundingClientRect: () => new DOMRect(ctx.x, ctx.y, 0, 0) }
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <span style={{ position: 'fixed', left: ctx.x, top: ctx.y, width: 0, height: 0 }} />
      </MenuTrigger>
      <MenuPopover data-testid="editor-context-menu">
        <MenuList>
          <MenuItem
            data-testid="ctx-cut"
            icon={<Glyph icon={CtxGlyph.cut} />}
            secondaryContent={`${modKey}+X`}
            disabled={!ctx.hasSelection}
            onClick={run((v) => void cutSelection(v))}
          >
            {t('TextEditor_ContextFlyout_CutButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="ctx-copy"
            icon={<Glyph icon={CtxGlyph.copy} />}
            secondaryContent={`${modKey}+C`}
            disabled={!ctx.hasSelection}
            onClick={run((v) => void copySelection(v))}
          >
            {t('TextEditor_ContextFlyout_CopyButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="ctx-paste"
            icon={<Glyph icon={CtxGlyph.paste} />}
            secondaryContent={`${modKey}+V`}
            onClick={run((v) => void pastePlainText(v))}
          >
            {t('TextEditor_ContextFlyout_PasteButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="ctx-undo"
            icon={<Glyph icon={CtxGlyph.undo} />}
            secondaryContent={`${modKey}+Z`}
            onClick={run((v) => void undo(v))}
          >
            {t('TextEditor_ContextFlyout_UndoButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="ctx-redo"
            icon={<Glyph icon={CtxGlyph.redo} />}
            secondaryContent={`${modKey}+Shift+Z`}
            onClick={run((v) => void redo(v))}
          >
            {t('TextEditor_ContextFlyout_RedoButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="ctx-selectall"
            icon={<Glyph icon={CtxGlyph.selectAll} />}
            secondaryContent={`${modKey}+A`}
            onClick={run((v) => v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }))}
          >
            {t('TextEditor_ContextFlyout_SelectAllButtonDisplayText')}
          </MenuItem>
          <MenuDivider />
          {ctx.hasText ? (
            <MenuItem
              data-testid="ctx-rtl"
              // Toggle items use the SAME single icon slot as the command items: a
              // CheckMark when active, an empty spacer when not. This keeps every
              // label in one aligned column and avoids the extra checkbox-indicator
              // slot that MenuItemCheckbox added (the misaligned "extra block").
              icon={<ToggleIcon on={ctx.rtl} />}
              onClick={run((v) => void toggleReadingOrder(v))}
            >
              {t('TextEditor_ContextFlyout_RightToLeftReadingOrderButtonDisplayText')}
            </MenuItem>
          ) : null}
          <MenuItem
            data-testid="ctx-wordwrap"
            icon={<ToggleIcon on={ctx.wordWrap} />}
            secondaryContent="Alt+Z"
            onClick={run((v) => void toggleWordWrapPreferGlobal(v))}
          >
            {t('TextEditor_ContextFlyout_WordWrapButtonDisplayText')}
          </MenuItem>
          {ctx.hasSelection ? (
            <MenuItem
              data-testid="ctx-websearch"
              icon={<Glyph icon={CtxGlyph.webSearch} />}
              secondaryContent={`${modKey}+E`}
              onClick={run((v) => void webSearchSelection(v))}
            >
              {t('TextEditor_ContextFlyout_WebSearchButtonDisplayText')}
            </MenuItem>
          ) : null}
          {isPreviewEligible ? (
            <MenuItem
              data-testid="ctx-preview"
              icon={<Glyph icon={CtxGlyph.preview} />}
              secondaryContent="Alt+P"
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
            icon={<Glyph icon={CtxGlyph.share} />}
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
