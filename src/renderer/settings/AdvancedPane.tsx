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
 * PA-8: consumes only the settings bag + update callback — no IPC/fs.
 */

import { Switch, Dropdown, Option } from '@fluentui/react-components';
import { SettingsPane, SettingGroup, SettingRow } from './SettingsPrimitives';
import { APP_LANGUAGES } from './settingsOptions';
import { useT } from '../i18n/I18nProvider';
import type { PaneProps } from './TextEditorPane';

export function AdvancedPane({ settings, update }: PaneProps): JSX.Element {
  const { t } = useT();
  const systemDefaultLabel = t('AdvancedPage_LanguagePreferenceSettings_SystemDefaultText');
  // The empty-tag entry is the localized "System Default"; named locales keep
  // their endonym label (e.g. "日本語") so the list reads natively in any UI lang.
  const languageLabel = (tag: string, label: string): string =>
    tag === '' ? systemDefaultLabel : label;
  const langLabel =
    languageLabel(
      settings.appLanguage,
      APP_LANGUAGES.find((l) => l.tag === settings.appLanguage)?.label ?? '',
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
            'AdvancedPage_LaunchPreferenceSettings_AlwaysOpenNewWindowToggleSwitch.OnContent',
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
            'AdvancedPage_LaunchPreferenceSettings_ExitWhenLastTabClosedToggleSwitch.OnContent',
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
          label="Open with NotepadsE (Explorer context menu)"
          description="Add 'Open with NotepadsE' to the Windows Explorer right-click menu."
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
    </SettingsPane>
  );
}
