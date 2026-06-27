/**
 * AppCloseReminderDialog — the APP-level "save your changes?" confirmation shown
 * when the WINDOW is closed (X / Alt+F4 / OS close) while one or more tabs have
 * unsaved changes. This is distinct from CloseReminderDialog, which guards a
 * SINGLE tab's close; this guards the whole window's close.
 *
 * 1:1 with UWP `MainPage_CloseRequested` → `AppCloseSaveReminderDialog`
 * (NotepadsMainPage.xaml.cs:372-444). Three outcomes:
 *   - Save All & Exit (primary)   → onSaveAllAndExit (save every modified tab,
 *                                    then close iff all saved)
 *   - Discard & Exit (secondary)  → onDiscardAndExit (close, dropping changes)
 *   - Cancel (close button / Esc) → onCancel (keep the window open)
 *
 * Strings reuse the ported `AppCloseSaveReminderDialog_*` keys (present in all 29
 * locale tables).
 *
 * PA-8: renderer-only Fluent UI; no fs/path/child_process/IPC here.
 */

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogTitle
} from '@fluentui/react-components';
import { useT } from './i18n';
import type { AppTheme } from './theme/tokens';
import { AppDialogSurface } from './theme/AppDialogSurface';

export interface AppCloseReminderDialogProps {
  /** Whether the dialog is shown (a window close is pending on unsaved tabs). */
  readonly open: boolean;
  /** Resolved app theme (drives the UWP ContentDialog surface/backdrop colors). */
  readonly theme?: AppTheme;
  readonly onSaveAllAndExit: () => void;
  readonly onDiscardAndExit: () => void;
  readonly onCancel: () => void;
}

export function AppCloseReminderDialog(props: AppCloseReminderDialogProps): JSX.Element {
  const { open, theme = 'light', onSaveAllAndExit, onDiscardAndExit, onCancel } = props;
  const { t } = useT();

  return (
    <Dialog
      open={open}
      // Backdrop / Esc dismiss == Cancel (keep the window open).
      onOpenChange={(_e, data) => {
        if (!data.open) onCancel();
      }}
    >
      <AppDialogSurface data-testid="app-close-reminder-dialog" theme={theme}>
        <DialogBody>
          <DialogTitle>{t('AppCloseSaveReminderDialog_Title')}</DialogTitle>
          <DialogContent>{t('AppCloseSaveReminderDialog_Content')}</DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              data-testid="app-close-reminder-saveall"
              onClick={onSaveAllAndExit}
            >
              {t('AppCloseSaveReminderDialog_PrimaryButtonText')}
            </Button>
            <Button data-testid="app-close-reminder-discard" onClick={onDiscardAndExit}>
              {t('AppCloseSaveReminderDialog_SecondaryButtonText')}
            </Button>
            <Button data-testid="app-close-reminder-cancel" onClick={onCancel}>
              {t('AppCloseSaveReminderDialog_CloseButtonText')}
            </Button>
          </DialogActions>
        </DialogBody>
      </AppDialogSurface>
    </Dialog>
  );
}
