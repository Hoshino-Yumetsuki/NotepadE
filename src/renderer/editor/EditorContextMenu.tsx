/**
 * Editor right-click context menu (RENDERER) — Monaco edition.
 *
 * Drop-in replacement for the CM6 version. The Fluent UI menu JSX, item
 * order, labels, icons, and props are identical to the CM6 version. The only
 * change is that the editor snapshot uses IStandaloneCodeEditor instead of
 * EditorView, and the CM6-specific operations (undo/redo, direction, wordWrap,
 * webSearch) are reimplemented against the Monaco API.
 *
 * Item order mirrors UWP TextEditorContextFlyout.cs:
 *   Cut · Copy · Paste · Undo · Redo · Select All ·
 *   Right-to-Left · Word Wrap · Search in web · Toggle Preview · Share
 *
 * PA-8: renderer-only — DOM + typed window.notepads bridge. No fs/IPC.
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
import type * as monacoApi from 'monaco-editor/esm/vs/editor/editor.api';
import { buildWebSearchQuery } from './commands/logic/webSearch';
import { useT } from '../i18n';
import { modKey, isMac } from '@shared/platform';
import { useAppTheme } from '../theme/useAppTheme';
import { acrylicVars } from '../theme/tokens';

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

function ToggleIcon({ on }: { on: boolean }): JSX.Element {
  return on ? <Glyph icon={CtxGlyph.check} /> : <span aria-hidden style={{ width: 20 }} />;
}

/** Snapshot of the editor at right-click time — gates menu items. */
interface MenuContext {
  x: number;
  y: number;
  editor: monacoApi.editor.IStandaloneCodeEditor;
  hasSelection: boolean;
  hasText: boolean;
  wordWrap: boolean;
  rtl: boolean;
}

export interface EditorContextMenuHostProps {
  /** Whether the active document supports preview (markdown). */
  isPreviewEligible: boolean;
  onTogglePreview: () => void;
  onShare: (selectionOnly: boolean) => void;
  /** Active web search engine for Ctrl+E / context menu search. */
  searchEngine: string;
  /** Custom search URL template for 'custom' engine (empty if not custom). */
  customSearchUrl: string;
}

export interface EditorContextMenuHost {
  /**
   * Register the contextmenu listener on an editor. Returns a disposable.
   * Call from MonacoEditor's mount effect; dispose on unmount.
   */
  attach(editor: monacoApi.editor.IStandaloneCodeEditor): monacoApi.IDisposable;
  /** The positioned Fluent menu element (render once near the editor host). */
  menu: JSX.Element | null;
}

// ---------------------------------------------------------------------------
//  Monaco clipboard / edit helpers
// ---------------------------------------------------------------------------

async function pastePlainText(editor: monacoApi.editor.IStandaloneCodeEditor): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.length) return;
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel) return;
    model.applyEdits([{ range: sel, text }]);
    editor.focus();
  } catch {
    /* clipboard denied — no-op */
  }
}

async function copySelection(editor: monacoApi.editor.IStandaloneCodeEditor): Promise<void> {
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel || sel.isEmpty()) return;
  try {
    await navigator.clipboard.writeText(model.getValueInRange(sel));
  } catch {
    /* denied */
  }
}

async function cutSelection(editor: monacoApi.editor.IStandaloneCodeEditor): Promise<void> {
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel || sel.isEmpty()) return;
  await copySelection(editor);
  model.applyEdits([{ range: sel, text: '' }]);
  editor.focus();
}

function selectAll(editor: monacoApi.editor.IStandaloneCodeEditor): void {
  const model = editor.getModel();
  if (!model) return;
  editor.setSelection(model.getFullModelRange());
}

function triggerUndo(editor: monacoApi.editor.IStandaloneCodeEditor): void {
  editor.trigger('contextmenu', 'undo', null);
}

function triggerRedo(editor: monacoApi.editor.IStandaloneCodeEditor): void {
  editor.trigger('contextmenu', 'redo', null);
}

function setDirection(editor: monacoApi.editor.IStandaloneCodeEditor, dir: 'ltr' | 'rtl'): void {
  const dom = editor.getDomNode();
  if (!dom) return;
  // Monaco derives text direction from the content DOM's `dir` attribute.
  const content = dom.querySelector<HTMLElement>('.monaco-editor .lines-content');
  if (content) content.setAttribute('dir', dir);
  // updateOptions does not expose direction; patch the DOM directly (same
  // approach the CM6 directionCompartment used via contentAttributes).
  editor.updateOptions({}); // trigger a layout pass so Monaco re-reads geometry
}

function toggleDirection(editor: monacoApi.editor.IStandaloneCodeEditor): void {
  const dom = editor.getDomNode();
  if (!dom) return;
  const content = dom.querySelector<HTMLElement>('.monaco-editor .lines-content');
  const cur = content?.getAttribute('dir') ?? 'ltr';
  setDirection(editor, cur === 'rtl' ? 'ltr' : 'rtl');
}

function isRtl(editor: monacoApi.editor.IStandaloneCodeEditor): boolean {
  const dom = editor.getDomNode();
  if (!dom) return false;
  const content = dom.querySelector<HTMLElement>('.monaco-editor .lines-content');
  return content?.getAttribute('dir') === 'rtl';
}

function toggleWordWrap(editor: monacoApi.editor.IStandaloneCodeEditor): void {
  const opts = editor.getOptions();
  const current = opts.get(
    // wordWrap option id = 132 in monaco-editor; use the enum-safe accessor
    (globalThis as unknown as { monaco: typeof monacoApi }).monaco.editor.EditorOption.wordWrap
  );
  editor.updateOptions({ wordWrap: current === 'on' ? 'off' : 'on' });
}

function isWordWrapOn(editor: monacoApi.editor.IStandaloneCodeEditor): boolean {
  const opts = editor.getOptions();
  return (
    opts.get(
      (globalThis as unknown as { monaco: typeof monacoApi }).monaco.editor.EditorOption.wordWrap
    ) === 'on'
  );
}

function webSearch(
  editor: monacoApi.editor.IStandaloneCodeEditor,
  searchEngine: string,
  customSearchUrl: string
): void {
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel || sel.isEmpty()) return;
  const raw = model.getValueInRange(sel);
  const query = buildWebSearchQuery(raw);
  if (!query) return;
  void window.notepads?.shell.webSearch({
    query,
    searchEngine: searchEngine as 'bing' | 'google' | 'duckDuckGo' | 'custom',
    customSearchUrl
  });
}

// ---------------------------------------------------------------------------
//  Hook
// ---------------------------------------------------------------------------

export function useEditorContextMenu(props: EditorContextMenuHostProps): EditorContextMenuHost {
  const { isPreviewEligible, onTogglePreview, onShare, searchEngine, customSearchUrl } = props;
  const { t } = useT();
  const { resolved } = useAppTheme();
  const [ctx, setCtx] = useState<MenuContext | null>(null);

  const close = (): void => setCtx(null);

  const run =
    (fn: (editor: monacoApi.editor.IStandaloneCodeEditor) => void): (() => void) =>
    () => {
      if (ctx) fn(ctx.editor);
      close();
    };

  const attach = useCallback(
    (editor: monacoApi.editor.IStandaloneCodeEditor): monacoApi.IDisposable => {
      const domNode = editor.getDomNode();
      if (!domNode) return { dispose() {} };

      const handler = (e: MouseEvent): void => {
        e.preventDefault();
        const model = editor.getModel();
        const sel = editor.getSelection();
        setCtx({
          x: e.clientX,
          y: e.clientY,
          editor,
          hasSelection: !!(sel && !sel.isEmpty()),
          hasText: !!(model && model.getValue().length > 0),
          wordWrap: isWordWrapOn(editor),
          rtl: isRtl(editor)
        });
      };

      domNode.addEventListener('contextmenu', handler);
      return {
        dispose() {
          domNode.removeEventListener('contextmenu', handler);
        }
      };
    },
    []
  );

  const menu = useMemo(() => {
    if (!ctx) return null;
    return (
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
        <MenuPopover
          data-testid="editor-context-menu"
          className={isMac ? 'np-mac-panel' : ''}
          data-theme={resolved}
          style={isMac ? { ...acrylicVars(resolved), padding: '4px' } : undefined}
        >
          <MenuList>
            <MenuItem
              data-testid="ctx-cut"
              icon={<Glyph icon={CtxGlyph.cut} />}
              secondaryContent={`${modKey}+X`}
              disabled={!ctx.hasSelection}
              onClick={run((e) => void cutSelection(e))}
            >
              {t('TextEditor_ContextFlyout_CutButtonDisplayText')}
            </MenuItem>
            <MenuItem
              data-testid="ctx-copy"
              icon={<Glyph icon={CtxGlyph.copy} />}
              secondaryContent={`${modKey}+C`}
              disabled={!ctx.hasSelection}
              onClick={run((e) => void copySelection(e))}
            >
              {t('TextEditor_ContextFlyout_CopyButtonDisplayText')}
            </MenuItem>
            <MenuItem
              data-testid="ctx-paste"
              icon={<Glyph icon={CtxGlyph.paste} />}
              secondaryContent={`${modKey}+V`}
              onClick={run((e) => void pastePlainText(e))}
            >
              {t('TextEditor_ContextFlyout_PasteButtonDisplayText')}
            </MenuItem>
            <MenuItem
              data-testid="ctx-undo"
              icon={<Glyph icon={CtxGlyph.undo} />}
              secondaryContent={`${modKey}+Z`}
              onClick={run(triggerUndo)}
            >
              {t('TextEditor_ContextFlyout_UndoButtonDisplayText')}
            </MenuItem>
            <MenuItem
              data-testid="ctx-redo"
              icon={<Glyph icon={CtxGlyph.redo} />}
              secondaryContent={`${modKey}+Shift+Z`}
              onClick={run(triggerRedo)}
            >
              {t('TextEditor_ContextFlyout_RedoButtonDisplayText')}
            </MenuItem>
            <MenuItem
              data-testid="ctx-selectall"
              icon={<Glyph icon={CtxGlyph.selectAll} />}
              secondaryContent={`${modKey}+A`}
              onClick={run(selectAll)}
            >
              {t('TextEditor_ContextFlyout_SelectAllButtonDisplayText')}
            </MenuItem>
            <MenuDivider />
            {ctx.hasText ? (
              <MenuItem
                data-testid="ctx-rtl"
                icon={<ToggleIcon on={ctx.rtl} />}
                onClick={run(toggleDirection)}
              >
                {t('TextEditor_ContextFlyout_RightToLeftReadingOrderButtonDisplayText')}
              </MenuItem>
            ) : null}
            <MenuItem
              data-testid="ctx-wordwrap"
              icon={<ToggleIcon on={ctx.wordWrap} />}
              secondaryContent="Alt+Z"
              onClick={run(toggleWordWrap)}
            >
              {t('TextEditor_ContextFlyout_WordWrapButtonDisplayText')}
            </MenuItem>
            {ctx.hasSelection ? (
              <MenuItem
                data-testid="ctx-websearch"
                icon={<Glyph icon={CtxGlyph.webSearch} />}
                secondaryContent={`${modKey}+E`}
                onClick={run((e) => webSearch(e, searchEngine, customSearchUrl))}
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
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, isPreviewEligible, onTogglePreview, onShare, t]);

  return { attach, menu };
}
