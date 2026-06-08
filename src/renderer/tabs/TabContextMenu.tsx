import {
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider
} from '@fluentui/react-components';
import type { ReactElement } from 'react';
import { useT } from '../i18n';
import { modKey } from '@shared/platform';

/**
 * ============================================================================
 *  Tab context menu — 1:1 with UWP Core/TabContextFlyout.cs (Phase 2, task #2)
 * ============================================================================
 *
 * EXACT item set + order (TabContextFlyout.cs:45-53), 2 separators:
 *   1. Close                 (Ctrl+W hint; real shortcut at window level)
 *   2. Close Others          (enabled only when >1 tab)
 *   3. Close to the Right    (enabled only when >1 tab)
 *   4. Close Saved           (always)
 *   --- separator ---
 *   5. Copy Full Path        (enabled only when the tab has a saved filePath)
 *   6. Open Containing Folder(enabled only when the tab has a saved filePath)
 *   --- separator ---
 *   7. Rename                (F2 hint)
 *
 * Labels are verbatim from Strings/en-US/Resources.resw. The Ctrl+W / F2
 * accelerators are DISPLAY-ONLY hints in UWP (IsEnabled=false on the accel);
 * the working shortcuts live in the window keymap (useTabKeyboard). We surface
 * them via MenuItem's `secondaryContent`.
 *
 * Wraps its children with a Fluent v9 Menu in `openOnContext` mode so a
 * right-click anywhere on the tab opens the menu (matching the UWP flyout).
 * Renderer-only: file actions go through window.notepads.shell.* (PA-8 clean).
 */

export interface TabContextMenuActions {
  onClose(): void;
  onCloseOthers(): void;
  onCloseToRight(): void;
  onCloseSaved(): void;
  onCopyFullPath(): void;
  onOpenContainingFolder(): void;
  onRename(): void;
}

export interface TabContextMenuProps extends TabContextMenuActions {
  /** Total open-tab count — gates "Close Others" / "Close to the Right". */
  tabCount: number;
  /** True when this tab is backed by a saved file (has an absolute path). */
  hasFilePath: boolean;
  /** The tab element the menu wraps (right-click target). Must be a single element. */
  children: ReactElement;
}

export function TabContextMenu(props: TabContextMenuProps): JSX.Element {
  const {
    tabCount,
    hasFilePath,
    children,
    onClose,
    onCloseOthers,
    onCloseToRight,
    onCloseSaved,
    onCopyFullPath,
    onOpenContainingFolder,
    onRename
  } = props;

  // UWP enable conditions (TabContextFlyout_Opening, lines 79-82).
  const multiTab = tabCount > 1;
  const { t } = useT();

  return (
    <Menu openOnContext positioning="below">
      <MenuTrigger disableButtonEnhancement>{children}</MenuTrigger>
      <MenuPopover>
        <MenuList data-testid="tab-menu">
          <MenuItem data-testid="tab-menu-close" secondaryContent={`${modKey}+W`} onClick={onClose}>
            {t('Tab_ContextFlyout_CloseButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="tab-menu-close-others"
            disabled={!multiTab}
            aria-disabled={!multiTab}
            onClick={onCloseOthers}
          >
            {t('Tab_ContextFlyout_CloseOthersButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="tab-menu-close-right"
            disabled={!multiTab}
            aria-disabled={!multiTab}
            onClick={onCloseToRight}
          >
            {t('Tab_ContextFlyout_CloseRightButtonDisplayText')}
          </MenuItem>
          <MenuItem data-testid="tab-menu-close-saved" onClick={onCloseSaved}>
            {t('Tab_ContextFlyout_CloseSavedButtonDisplayText')}
          </MenuItem>
          <MenuDivider />
          <MenuItem
            data-testid="tab-menu-copy-path"
            disabled={!hasFilePath}
            aria-disabled={!hasFilePath}
            onClick={onCopyFullPath}
          >
            {t('Tab_ContextFlyout_CopyFullPathButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="tab-menu-open-folder"
            disabled={!hasFilePath}
            aria-disabled={!hasFilePath}
            onClick={onOpenContainingFolder}
          >
            {t('Tab_ContextFlyout_OpenContainingFolderButtonDisplayText')}
          </MenuItem>
          <MenuDivider />
          <MenuItem data-testid="tab-menu-rename" secondaryContent="F2" onClick={onRename}>
            {t('Tab_ContextFlyout_RenameButtonDisplayText')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
