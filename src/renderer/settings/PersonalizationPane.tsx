/**
 * Personalization settings pane (Phase 5, Stream C) — UWP PersonalizationSettingsPage.
 *
 * Theme mode, background tint opacity, Windows-accent toggle, and a custom accent
 * picker. The accent fields feed useAppTheme's brand-ramp resolution live (no
 * reload): toggling useWindowsAccentColor off and entering a custom #RRGGBB
 * recomputes the FluentProvider theme on the next settings.onChanged.
 *
 * PA-8: consumes only the settings bag + update callback — no IPC/fs.
 */

import { RadioGroup, Radio, Slider, Switch, Input, Label } from '@fluentui/react-components';
import type { ThemeMode } from '@shared/ipc-contract';
import { SettingsPane, SettingGroup, SettingRow } from './SettingsPrimitives';
import { TINT_MIN, TINT_MAX, TINT_STEP } from './settingsOptions';
import { isValidHex } from '../theme/brandRamp';
import { useT } from '../i18n/I18nProvider';
import type { PaneProps } from './TextEditorPane';

/** Theme-mode options; labels are localized at render via the ported .resw keys. */
const THEME_MODES: readonly { id: ThemeMode; labelKey: string }[] = [
  { id: 'light', labelKey: 'PersonalizationPage_ThemeModeSettings_LightModeRadioButton.Content' },
  { id: 'dark', labelKey: 'PersonalizationPage_ThemeModeSettings_DarkModeRadioButton.Content' },
  {
    id: 'system',
    labelKey: 'PersonalizationPage_ThemeModeSettings_WindowsModeRadioButton.Content',
  },
];

export function PersonalizationPane({ settings, update }: PaneProps): JSX.Element {
  const { t } = useT();
  const tintPct = Math.round(settings.tintOpacity * 100);
  const accentValid = isValidHex(settings.customAccentColor);

  return (
    <SettingsPane id="personalization">
      <SettingGroup title={t('PersonalizationPage_ThemeModeSettings_Title.Text')}>
        <SettingRow
          id="themeMode"
          layout="stack"
          label={t('PersonalizationPage_ThemeModeSettings_Title.Text')}
        >
          <RadioGroup
            layout="horizontal"
            value={settings.themeMode}
            onChange={(_e, d) => update({ themeMode: d.value as ThemeMode })}
          >
            {THEME_MODES.map((m) => (
              <Radio key={m.id} value={m.id} label={t(m.labelKey)} />
            ))}
          </RadioGroup>
        </SettingRow>
        <SettingRow
          id="tintOpacity"
          layout="stack"
          label={t('PersonalizationPage_BackgroundTintOpacitySettings_Title.Text')}
          description={`${tintPct}%`}
        >
          <Slider
            data-testid="setting-tintOpacity-slider"
            min={TINT_MIN}
            max={TINT_MAX}
            step={TINT_STEP}
            value={settings.tintOpacity}
            onChange={(_e, d) => update({ tintOpacity: d.value })}
            style={{ width: '100%' }}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('PersonalizationPage_AccentColorSettings_Title.Text')}>
        <SettingRow
          id="useWindowsAccentColor"
          label={t(
            'PersonalizationPage_AccentColorSettings_UseWindowsAccentColorToggleSwitch.OnContent',
          )}
          description={t('PersonalizationPage_AccentColorSettings_Description')}
        >
          <Switch
            checked={settings.useWindowsAccentColor}
            onChange={(_e, d) => update({ useWindowsAccentColor: d.checked })}
          />
        </SettingRow>
        {!settings.useWindowsAccentColor ? (
          <SettingRow
            id="customAccentColor"
            layout="stack"
            label={t('PersonalizationPage_CustomAccentColor_Title')}
            description={t('PersonalizationPage_CustomAccentColor_Description')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                aria-label={t('PersonalizationPage_CustomAccentColorPicker_Label')}
                data-testid="setting-customAccentColor-picker"
                value={accentValid ? settings.customAccentColor : '#0078D4'}
                onChange={(e) => update({ customAccentColor: e.target.value })}
                style={{ width: 32, height: 28, padding: 0, border: 'none', background: 'none' }}
              />
              <Input
                data-testid="setting-customAccentColor-input"
                value={settings.customAccentColor}
                placeholder="#0078D4"
                onChange={(_e, d) => update({ customAccentColor: d.value })}
                style={{ width: 110 }}
              />
              {!accentValid && settings.customAccentColor !== '' ? (
                <Label size="small" style={{ color: 'crimson' }}>
                  {t('PersonalizationPage_CustomAccentColor_Invalid')}
                </Label>
              ) : null}
            </div>
          </SettingRow>
        ) : null}
      </SettingGroup>
    </SettingsPane>
  );
}
