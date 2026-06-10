/**
 * Advanced settings pane (Phase 5, Stream C) — UWP AdvancedSettingsPage.
 *
 * Status bar, smart copy, session snapshot, always-open-new-window,
 * exit-when-last-tab-closed, and the app-language selector (the 29-locale set;
 * the actual i18n binding is Phase 6 — here it only persists appLanguage).
 *
 * showStatusBar is consumed live by the App shell to mount/unmount the Phase-4
 * status bar.
 *
 * Reset (web port only — UWP had no such affordance): a "Reset all settings"
 * button at the bottom of the pane, gated by a Fluent confirmation dialog
 * (destructive action; same Dialog composition as CloseReminderDialog). On
 * confirm it calls window.notepads.settings.resetAll(): MAIN restores the
 * verbatim defaults, deletes the managed wallpaper file (via the wallpaper
 * lifecycle), and broadcasts EvtSettingsChanged — every control in every
 * window snaps back live, no restart (appLanguage keeps its existing
 * restart-prompt convention).
 *
 * PA-8: consumes the settings bag + update callback + the typed
 * window.notepads.settings contract — no fs/path/child_process.
 */

import { useState } from 'react';
import {
  Switch,
  Dropdown,
  Option,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  tokens
} from '@fluentui/react-components';
import { SettingsPane, SettingGroup, SettingRow } from './SettingsPrimitives';
import { APP_LANGUAGES } from './settingsOptions';
import { useT } from '../i18n/I18nProvider';
import type { PaneProps } from './TextEditorPane';

export function AdvancedPane({ settings, update }: PaneProps): JSX.Element {
  const { t } = useT();

  // Reset-all confirmation state. The dialog gates the destructive action;
  // `busy` debounces double-clicks while MAIN restores + broadcasts; `error`
  // surfaces an ok:false Result (or a rejected invoke) inline in the dialog so
  // a failure is never silent (PersonalizationPane's wallpaper error pattern).
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');

  const onResetConfirmed = (): void => {
    if (resetBusy) return;
    setResetBusy(true);
    setResetError('');
    // MAIN does the whole reset (defaults persist + wallpaper-file delete +
    // broadcast); the live settings bag reconciles via settings.onChanged so
    // no local update() call is needed — same flow as an external write.
    // Success closes the dialog; an ok:false Result keeps it open with the
    // error shown. The catch + busy-always-cleared matters: without it a
    // rejected invoke would leave resetBusy=true forever and the busy-guarded
    // onOpenChange below would refuse to close — an unclosable modal.
    void window.notepads.settings
      .resetAll()
      .then((r) => {
        if (r.ok) {
          setResetConfirmOpen(false);
        } else {
          setResetError(r.error);
        }
      })
      .catch((e: unknown) => {
        setResetError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setResetBusy(false);
      });
  };

  /** Close + clear the transient error so a reopen starts clean. */
  const closeResetDialog = (): void => {
    setResetConfirmOpen(false);
    setResetError('');
  };

  const systemDefaultLabel = t('AdvancedPage_LanguagePreferenceSettings_SystemDefaultText');
  // The empty-tag entry is the localized "System Default"; named locales keep
  // their endonym label (e.g. "日本語") so the list reads natively in any UI lang.
  const languageLabel = (tag: string, label: string): string =>
    tag === '' ? systemDefaultLabel : label;
  const langLabel =
    languageLabel(
      settings.appLanguage,
      APP_LANGUAGES.find((l) => l.tag === settings.appLanguage)?.label ?? ''
    ) || systemDefaultLabel;

  return (
    <SettingsPane id="advanced">
      <SettingGroup title={t('AdvancedPage_StatusBarSettings_Title.Text')}>
        <SettingRow
          id="showStatusBar"
          label={t('AdvancedPage_StatusBarSettings_ShowHideStatusBarToggleSwitch.OnContent')}
        >
          <Switch
            checked={settings.showStatusBar}
            onChange={(_e, d) => update({ showStatusBar: d.checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('AdvancedPage_SmartCopySettings_Title.Text')}>
        <SettingRow
          id="smartCopy"
          label={t('AdvancedPage_SmartCopySettings_EnableSmartCopyToggleSwitch.OnContent')}
          description={t('AdvancedPage_SmartCopySettings_Description.Text')}
        >
          <Switch
            checked={settings.smartCopy}
            onChange={(_e, d) => update({ smartCopy: d.checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('AdvancedPage_SessionSnapshotSettings_Title.Text')}>
        <SettingRow
          id="sessionSnapshot"
          label={t('AdvancedPage_SessionSnapshotSettings_OnOffToggleSwitch.OnContent')}
          description={t('AdvancedPage_SessionSnapshotSettings_Description.Text')}
        >
          <Switch
            checked={settings.sessionSnapshot}
            onChange={(_e, d) => update({ sessionSnapshot: d.checked })}
          />
        </SettingRow>
        <SettingRow
          id="alwaysOpenNewWindow"
          label={t(
            'AdvancedPage_LaunchPreferenceSettings_AlwaysOpenNewWindowToggleSwitch.OnContent'
          )}
          description={t('AdvancedPage_AlwaysOpenNewWindow_Description.Text')}
        >
          <Switch
            checked={settings.alwaysOpenNewWindow}
            onChange={(_e, d) => update({ alwaysOpenNewWindow: d.checked })}
          />
        </SettingRow>
        <SettingRow
          id="exitWhenLastTabClosed"
          label={t(
            'AdvancedPage_LaunchPreferenceSettings_ExitWhenLastTabClosedToggleSwitch.OnContent'
          )}
        >
          <Switch
            checked={settings.exitWhenLastTabClosed}
            onChange={(_e, d) => update({ exitWhenLastTabClosed: d.checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Shell Integration">
        <SettingRow
          id="openWithContextMenu"
          label="Open with NotepadE (Explorer context menu)"
          description="Add 'Open with NotepadE' to the Windows Explorer right-click menu."
        >
          <Switch
            checked={settings.openWithContextMenu}
            onChange={(_e, d) => update({ openWithContextMenu: d.checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('AdvancedPage_LanguagePreferenceSettings_Title.Text')}>
        <SettingRow
          id="appLanguage"
          layout="stack"
          label={t('AdvancedPage_LanguagePreferenceSettings_Title.Text')}
          description={t('AdvancedPage_LanguagePreferenceSettings_Description.Text')}
        >
          <Dropdown
            data-testid="setting-appLanguage-dropdown"
            value={langLabel}
            selectedOptions={[settings.appLanguage]}
            onOptionSelect={(_e, d) => update({ appLanguage: d.optionValue ?? '' })}
            style={{ width: '100%' }}
          >
            {APP_LANGUAGES.map((l) => (
              <Option key={l.tag || 'system'} value={l.tag}>
                {languageLabel(l.tag, l.label)}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('AdvancedPage_ResetSettings_Title')}>
        <SettingRow
          id="resetAllSettings"
          layout="stack"
          label={t('AdvancedPage_ResetSettings_Title')}
          description={t('AdvancedPage_ResetSettings_Description')}
        >
          <div>
            <Button
              data-testid="setting-resetAll-button"
              onClick={() => setResetConfirmOpen(true)}
            >
              {t('AdvancedPage_ResetSettings_Button')}
            </Button>
          </div>
        </SettingRow>
      </SettingGroup>

      {/* Confirmation dialog (destructive action — UWP ContentDialog pattern,
          same Fluent composition as CloseReminderDialog). Backdrop/Esc == Cancel. */}
      <Dialog
        open={resetConfirmOpen}
        onOpenChange={(_e, data) => {
          if (!data.open && !resetBusy) closeResetDialog();
        }}
      >
        <DialogSurface data-testid="reset-settings-dialog">
          <DialogBody>
            <DialogTitle>{t('AdvancedPage_ResetSettings_ConfirmTitle')}</DialogTitle>
            <DialogContent>
              {t('AdvancedPage_ResetSettings_ConfirmBody')}
              {resetError !== '' ? (
                <div
                  data-testid="reset-settings-error"
                  style={{ color: tokens.colorPaletteRedForeground1, marginTop: 8 }}
                >
                  {resetError}
                </div>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                data-testid="reset-settings-confirm"
                disabled={resetBusy}
                onClick={onResetConfirmed}
              >
                {t('AdvancedPage_ResetSettings_ConfirmButton')}
              </Button>
              <Button
                data-testid="reset-settings-cancel"
                disabled={resetBusy}
                onClick={closeResetDialog}
              >
                {t('AdvancedPage_ResetSettings_CancelButton')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </SettingsPane>
  );
}
