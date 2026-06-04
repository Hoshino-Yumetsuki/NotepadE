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
import type { PaneProps } from './TextEditorPane';

const THEME_MODES: readonly { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Use system setting' },
];

export function PersonalizationPane({ settings, update }: PaneProps): JSX.Element {
  const tintPct = Math.round(settings.tintOpacity * 100);
  const accentValid = isValidHex(settings.customAccentColor);

  return (
    <SettingsPane id="personalization">
      <SettingGroup title="Theme">
        <SettingRow id="themeMode" label="App theme">
          <RadioGroup
            layout="horizontal"
            value={settings.themeMode}
            onChange={(_e, d) => update({ themeMode: d.value as ThemeMode })}
          >
            {THEME_MODES.map((m) => (
              <Radio key={m.id} value={m.id} label={m.label} />
            ))}
          </RadioGroup>
        </SettingRow>
        <SettingRow
          id="tintOpacity"
          label="Background tint opacity"
          description={`${tintPct}%`}
        >
          <Slider
            data-testid="setting-tintOpacity-slider"
            min={TINT_MIN}
            max={TINT_MAX}
            step={TINT_STEP}
            value={settings.tintOpacity}
            onChange={(_e, d) => update({ tintOpacity: d.value })}
            style={{ minWidth: 160 }}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Accent color">
        <SettingRow
          id="useWindowsAccentColor"
          label="Use Windows accent color"
          description="Follow the system accent."
        >
          <Switch
            checked={settings.useWindowsAccentColor}
            onChange={(_e, d) => update({ useWindowsAccentColor: d.checked })}
          />
        </SettingRow>
        {!settings.useWindowsAccentColor ? (
          <SettingRow
            id="customAccentColor"
            label="Custom accent"
            description="Hex color, e.g. #0078D4."
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                aria-label="Custom accent color picker"
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
                  Invalid
                </Label>
              ) : null}
            </div>
          </SettingRow>
        ) : null}
      </SettingGroup>
    </SettingsPane>
  );
}
