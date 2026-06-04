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
import type { PaneProps } from './TextEditorPane';

export function AdvancedPane({ settings, update }: PaneProps): JSX.Element {
  const langLabel =
    APP_LANGUAGES.find((l) => l.tag === settings.appLanguage)?.label ?? 'System default';

  return (
    <SettingsPane id="advanced">
      <SettingGroup title="Interface">
        <SettingRow id="showStatusBar" label="Show status bar">
          <Switch
            checked={settings.showStatusBar}
            onChange={(_e, d) => update({ showStatusBar: d.checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Editing">
        <SettingRow
          id="smartCopy"
          label="Smart copy"
          description="Copy the whole line when nothing is selected."
        >
          <Switch
            checked={settings.smartCopy}
            onChange={(_e, d) => update({ smartCopy: d.checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Session & windows">
        <SettingRow
          id="sessionSnapshot"
          label="Save session on exit"
          description="Restore open tabs the next time the app starts."
        >
          <Switch
            checked={settings.sessionSnapshot}
            onChange={(_e, d) => update({ sessionSnapshot: d.checked })}
          />
        </SettingRow>
        <SettingRow id="alwaysOpenNewWindow" label="Always open files in a new window">
          <Switch
            checked={settings.alwaysOpenNewWindow}
            onChange={(_e, d) => update({ alwaysOpenNewWindow: d.checked })}
          />
        </SettingRow>
        <SettingRow id="exitWhenLastTabClosed" label="Exit when the last tab is closed">
          <Switch
            checked={settings.exitWhenLastTabClosed}
            onChange={(_e, d) => update({ exitWhenLastTabClosed: d.checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Language">
        <SettingRow
          id="appLanguage"
          label="App language"
          description="Applied after restart (full i18n is a later phase)."
        >
          <Dropdown
            data-testid="setting-appLanguage-dropdown"
            value={langLabel}
            selectedOptions={[settings.appLanguage]}
            onOptionSelect={(_e, d) => update({ appLanguage: d.optionValue ?? '' })}
          >
            {APP_LANGUAGES.map((l) => (
              <Option key={l.tag || 'system'} value={l.tag}>
                {l.label}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
      </SettingGroup>
    </SettingsPane>
  );
}
