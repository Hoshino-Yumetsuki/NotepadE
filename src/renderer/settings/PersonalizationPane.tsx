/**
 * Personalization settings pane (Phase 5, Stream C) — UWP PersonalizationSettingsPage.
 *
 * Theme mode, background tint opacity, Windows-accent toggle, and a custom accent
 * picker. The accent fields feed useAppTheme's brand-ramp resolution live (no
 * reload): toggling useWindowsAccentColor off and entering a custom #RRGGBB
 * recomputes the FluentProvider theme on the next settings.onChanged.
 *
 * Custom wallpaper (web-port-only): a background image set from a URL or a
 * local file. MAIN owns the whole lifecycle behind window.notepads.wallpaper
 * (download/copy into {userData}/wallpaper/, delete-on-replace/clear, PA-8) —
 * this pane only triggers those actions; the persisted `wallpaperFileName`
 * flows back through the shared settings bag like every other field. While a
 * wallpaper is active the tint-opacity slider drives the WALLPAPER layer's
 * selected effect (theme/wallpaper.ts) — `wallpaperEffect` picks BLUR
 * intensity (higher = blurrier, converging on the no-wallpaper acrylic
 * material) or layer OPACITY (higher = more opaque image) via a toggle switch
 * shown only while a wallpaper is set — so the slider row swaps in an
 * explanatory description.
 *
 * PA-8: consumes the settings bag + update callback + the typed
 * window.notepads.wallpaper contract — no fs/path/child_process.
 */

import { useState } from 'react';
import {
  RadioGroup,
  Radio,
  Slider,
  Switch,
  Input,
  Label,
  Button,
  tokens
} from '@fluentui/react-components';
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
    labelKey: 'PersonalizationPage_ThemeModeSettings_WindowsModeRadioButton.Content'
  }
];

export function PersonalizationPane({ settings, update }: PaneProps): JSX.Element {
  const { t } = useT();
  const tintPct = Math.round(settings.tintOpacity * 100);
  const accentValid = isValidHex(settings.customAccentColor);
  const wallpaperActive = settings.wallpaperFileName !== '';

  // Wallpaper URL input + transient action state. The settings bag never holds
  // the URL (only MAIN's managed file name persists), so the field is local.
  const [wallpaperUrl, setWallpaperUrl] = useState('');
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [wallpaperError, setWallpaperError] = useState('');

  /** Shared completion handler: surface MAIN's error or clear it on success. */
  const finishWallpaperAction = (r: { ok: true } | { ok: false; error: string }): void => {
    setWallpaperBusy(false);
    setWallpaperError(r.ok ? '' : r.error);
  };

  const onWallpaperFromUrl = (): void => {
    const url = wallpaperUrl.trim();
    if (!url || wallpaperBusy) return;
    setWallpaperBusy(true);
    setWallpaperError('');
    // MAIN downloads + validates (content-type/size) and persists the managed
    // file name; the settings bag updates via the EvtSettingsChanged broadcast.
    void window.notepads.wallpaper.setFromUrl(url).then((r) => {
      finishWallpaperAction(r);
      if (r.ok) setWallpaperUrl('');
    });
  };

  const onWallpaperBrowse = (): void => {
    if (wallpaperBusy) return;
    setWallpaperBusy(true);
    setWallpaperError('');
    // MAIN shows the native image-filtered open dialog, then copies the pick
    // into the managed folder. Cancel resolves ok/null — a silent no-op.
    void window.notepads.wallpaper.pick().then(finishWallpaperAction);
  };

  const onWallpaperClear = (): void => {
    if (wallpaperBusy) return;
    setWallpaperBusy(true);
    setWallpaperError('');
    // MAIN empties the setting and DELETES the managed file (no orphans).
    void window.notepads.wallpaper.clear().then(finishWallpaperAction);
  };

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
            // Whole radios wrap to the next row at the 385px pane width instead
            // of squeezing each label into a vertical sliver.
            style={{ flexWrap: 'wrap' }}
          >
            {THEME_MODES.map((m) => (
              <Radio
                key={m.id}
                value={m.id}
                // nowrap on the label slot: CJK text breaks between ANY two
                // characters, so a squeezed 浅色/深色 would stack vertically.
                label={{ children: t(m.labelKey), style: { whiteSpace: 'nowrap' } }}
              />
            ))}
          </RadioGroup>
        </SettingRow>
        <SettingRow
          id="tintOpacity"
          layout="stack"
          label={t('PersonalizationPage_BackgroundTintOpacitySettings_Title.Text')}
          description={
            // Semantics switch: with a wallpaper active this slider drives the
            // WALLPAPER layer's selected effect — blur intensity or layer
            // opacity, per the wallpaperEffect toggle below (theme/wallpaper.ts)
            // — not the tint alpha over the OS material. Tell the user which
            // one they're tuning.
            wallpaperActive
              ? `${tintPct}% — ${t('PersonalizationPage_Wallpaper_OpacityHint')}`
              : `${tintPct}%`
          }
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

      <SettingGroup title={t('PersonalizationPage_Wallpaper_Title')}>
        <SettingRow
          id="wallpaperUrl"
          layout="stack"
          label={t('PersonalizationPage_Wallpaper_UrlLabel')}
          description={t('PersonalizationPage_Wallpaper_Description')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Input
              data-testid="setting-wallpaperUrl-input"
              value={wallpaperUrl}
              placeholder="https://"
              disabled={wallpaperBusy}
              onChange={(_e, d) => setWallpaperUrl(d.value)}
              style={{ flex: '1 1 auto', minWidth: 0 }}
            />
            <Button
              data-testid="setting-wallpaperUrl-apply"
              disabled={wallpaperBusy || wallpaperUrl.trim() === ''}
              onClick={onWallpaperFromUrl}
            >
              {t('PersonalizationPage_Wallpaper_SetFromUrlButton')}
            </Button>
          </div>
        </SettingRow>
        <SettingRow
          id="wallpaperActions"
          layout="stack"
          label={t('PersonalizationPage_Wallpaper_LocalLabel')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              data-testid="setting-wallpaperBrowse-button"
              disabled={wallpaperBusy}
              onClick={onWallpaperBrowse}
            >
              {t('PersonalizationPage_Wallpaper_BrowseButton')}
            </Button>
            {wallpaperActive ? (
              <Button
                data-testid="setting-wallpaperClear-button"
                disabled={wallpaperBusy}
                onClick={onWallpaperClear}
              >
                {t('PersonalizationPage_Wallpaper_ClearButton')}
              </Button>
            ) : null}
          </div>
          {wallpaperError !== '' ? (
            <Label
              size="small"
              data-testid="setting-wallpaper-error"
              // Theme token (not a hardcoded color) so the error reads
              // correctly in dark mode and HC re-maps it like any Fluent text.
              style={{ color: tokens.colorPaletteRedForeground1 }}
            >
              {wallpaperError}
            </Label>
          ) : null}
        </SettingRow>
        {wallpaperActive ? (
          // Background-mode toggle: which wallpaper effect the tint-opacity
          // slider drives (theme/wallpaper.ts). Checked = blur (the default,
          // frost intensity), unchecked = opacity (layer transparency). Only
          // rendered while a wallpaper is set — same gate as the Remove
          // button — because the effect is meaningless without one.
          <SettingRow
            id="wallpaperEffect"
            label={t('PersonalizationPage_Wallpaper_EffectLabel')}
            description={t('PersonalizationPage_Wallpaper_EffectDescription')}
          >
            <Switch
              data-testid="setting-wallpaperEffect-switch"
              checked={settings.wallpaperEffect === 'blur'}
              // The Switch's own label announces the CURRENT mode (the
              // OnContent/OffContent pattern of the UWP toggle strings).
              label={t(
                settings.wallpaperEffect === 'blur'
                  ? 'PersonalizationPage_Wallpaper_EffectBlur'
                  : 'PersonalizationPage_Wallpaper_EffectOpacity'
              )}
              onChange={(_e, d) => update({ wallpaperEffect: d.checked ? 'blur' : 'opacity' })}
            />
          </SettingRow>
        ) : null}
      </SettingGroup>

      <SettingGroup title={t('PersonalizationPage_AccentColorSettings_Title.Text')}>
        <SettingRow
          id="useWindowsAccentColor"
          label={t(
            'PersonalizationPage_AccentColorSettings_UseWindowsAccentColorToggleSwitch.OnContent'
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
