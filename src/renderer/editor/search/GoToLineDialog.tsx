/**
 * GoToLineDialog — the "Go To Line" input (Ctrl+G), replacing the previous raw
 * window.prompt with a themed Fluent dialog that mirrors the UWP GoToControl
 * (Controls/GoTo/GoToControl.xaml): a numeric field with inline validation and
 * the ported GoTo_* notification strings.
 *
 * Validation (1:1 with GoToControl.xaml.cs):
 *   - non-numeric input  → GoTo_NotificationMsg_InputError_InvalidInput
 *   - out-of-range line  → GoTo_NotificationMsg_InputError_ExceedInputLimit
 * A valid submit calls onSubmit(lineNumber); the host performs the actual jump.
 *
 * PA-8: renderer-only Fluent UI; no fs/path/child_process/IPC here.
 */

import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input
} from '@fluentui/react-components';
import { useT } from '../../i18n';

export interface GoToLineDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** The line the caret is currently on (seeds the input). */
  readonly currentLine: number;
  /** Total lines in the document (upper validation bound). */
  readonly lineCount: number;
  /** Called with a validated 1-based line number on submit. */
  readonly onSubmit: (line: number) => void;
  /** Called when the dialog is dismissed without a valid submit. */
  readonly onCancel: () => void;
}

export function GoToLineDialog(props: GoToLineDialogProps): JSX.Element {
  const { open, currentLine, lineCount, onSubmit, onCancel } = props;
  const { t } = useT();
  const [value, setValue] = useState(String(currentLine));
  const [error, setError] = useState<string | undefined>(undefined);

  // Re-seed the field with the current line each time the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(String(currentLine));
      setError(undefined);
    }
  }, [open, currentLine]);

  const submit = (): void => {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError(t('GoTo_NotificationMsg_InputError_InvalidInput'));
      return;
    }
    const n = Number.parseInt(trimmed, 10);
    if (n < 1 || n > lineCount) {
      setError(t('GoTo_NotificationMsg_InputError_ExceedInputLimit'));
      return;
    }
    onSubmit(n);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(_e, data) => {
        if (!data.open) onCancel();
      }}
    >
      <DialogSurface data-testid="goto-line-dialog">
        <DialogBody>
          <DialogTitle>{t('GoTo_GoToBarLabel.Text')}</DialogTitle>
          <DialogContent>
            <Field validationState={error ? 'error' : 'none'} validationMessage={error}>
              <Input
                data-testid="goto-line-input"
                value={value}
                placeholder={t('GoTo_GoToBar.PlaceholderText')}
                autoFocus
                onChange={(_e, data) => {
                  setValue(data.value);
                  if (error) setError(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" data-testid="goto-line-submit" onClick={submit}>
              {t('GoTo_SearchButton.ToolTipService.ToolTip')}
            </Button>
            <Button data-testid="goto-line-cancel" onClick={onCancel}>
              {t('SetCloseSaveReminderDialog_CloseButtonText')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
