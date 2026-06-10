/**
 * CloseReminderDialog — the per-tab "save your changes?" confirmation shown when
 * closing a MODIFIED tab (Issue 4, UWP SetCloseSaveReminderDialog parity:
 * NotepadsMainPage.xaml.cs OnTextEditorClosing → SetCloseSaveReminderDialog).
 *
 * Three outcomes mapped 1:1 to the UWP ContentDialog buttons:
 *   - Save (primary)        → onSave   (write, then close iff the write succeeded)
 *   - Don't Save (secondary)→ onDontSave (discard + close)
 *   - Cancel (close button) → onCancel (abort, keep the tab)
 *
 * Strings reuse the ported SetCloseSaveReminderDialog_* keys (present in all 29
 * locale tables); the content interpolates the file name via {0}.
 *
 * PA-8: renderer-only Fluent UI; no fs/path/child_process/IPC here.
 */

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle
} from '@fluentui/react-components';
import { useT } from './i18n';
import type { AppTheme } from './theme/tokens';
import { dialogSurfaceStyle, dialogBackdropStyle } from './theme/dialogStyles';

export interface CloseReminderDialogProps {
  /** The modified tab pending close, or null when the dialog is hidden. */
  readonly pending: { readonly editorId: string; readonly fileName: string } | null;
  /** Resolved app theme (drives the UWP ContentDialog surface/backdrop colors). */
  readonly theme?: AppTheme;
  readonly onSave: () => void;
  readonly onDontSave: () => void;
  readonly onCancel: () => void;
}

export function CloseReminderDialog(props: CloseReminderDialogProps): JSX.Element {
  const { pending, theme = 'light', onSave, onDontSave, onCancel } = props;
  const { t } = useT();
  const open = pending !== null;

  return (
    <Dialog
      open={open}
      // Backdrop / Esc dismiss == Cancel (keep the tab).
      onOpenChange={(_e, data) => {
        if (!data.open) onCancel();
      }}
    >
      <DialogSurface
        data-testid="close-reminder-dialog"
        className="np-dialog-enter"
        style={dialogSurfaceStyle(theme)}
        backdrop={{ style: dialogBackdropStyle(theme) }}
      >
        <DialogBody>
          <DialogTitle>{t('SetCloseSaveReminderDialog_Title')}</DialogTitle>
          <DialogContent>
            {t('SetCloseSaveReminderDialog_Content', pending?.fileName ?? '')}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" data-testid="close-reminder-save" onClick={onSave}>
              {t('SetCloseSaveReminderDialog_PrimaryButtonText')}
            </Button>
            <Button data-testid="close-reminder-dontsave" onClick={onDontSave}>
              {t('SetCloseSaveReminderDialog_SecondaryButtonText')}
            </Button>
            <Button data-testid="close-reminder-cancel" onClick={onCancel}>
              {t('SetCloseSaveReminderDialog_CloseButtonText')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
