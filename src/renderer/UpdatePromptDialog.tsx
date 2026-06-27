/**
 * UpdatePromptDialog — shown once per session when a startup auto-check finds
 * a newer release on GitHub. Follows the CloseReminderDialog / AppCloseReminderDialog
 * Fluent Dialog composition pattern.
 */

import {
  Dialog,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Text
} from '@fluentui/react-components';
import { useT } from './i18n/I18nProvider';
import type { UpdateInfo } from '@shared/ipc-contract';
import { useAppTheme } from './theme/useAppTheme';
import { AppDialogSurface } from './theme/AppDialogSurface';

export interface UpdatePromptDialogProps {
  open: boolean;
  info: UpdateInfo | null;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdatePromptDialog({
  open,
  info,
  onInstall,
  onDismiss
}: UpdatePromptDialogProps): JSX.Element | null {
  const { t } = useT();
  const { resolved } = useAppTheme();
  if (!info) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(_e, data) => {
        if (!data.open) onDismiss();
      }}
    >
      <AppDialogSurface data-testid="update-prompt-dialog" theme={resolved}>
        <DialogBody>
          <DialogTitle>{t('Updates_DialogTitle')}</DialogTitle>
          <DialogContent>
            <Text>{t('Updates_Available', info.version)}</Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" data-testid="update-prompt-install" onClick={onInstall}>
              {t('Updates_InstallNow')}
            </Button>
            <Button data-testid="update-prompt-later" onClick={onDismiss}>
              {t('Updates_Later')}
            </Button>
          </DialogActions>
        </DialogBody>
      </AppDialogSurface>
    </Dialog>
  );
}
