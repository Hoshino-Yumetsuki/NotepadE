/**
 * Text & Editor settings pane (Phase 5, Stream C) — UWP TextAndEditorSettingsPage.
 *
 * Every control reads its value from `settings` and writes via `update({field})`.
 * The MAIN store persists + broadcasts; the bag arrives back through
 * settings.onChanged (wired in useSettings) so external writes reconcile too.
 *
 * PA-8: consumes only the in-memory settings bag + update callback — no IPC/fs.
 */

import {
  Switch,
  Dropdown,
  Option,
  SpinButton,
  Input,
  RadioGroup,
  Radio,
  type SpinButtonOnChangeData
} from '@fluentui/react-components';
import type { Settings } from '@shared/ipc-contract';
import type {
  EolId,
  FontStyleId,
  TabIndents,
  SearchEngineId,
  DefaultDecoding,
  EncodingId
} from '@shared/ipc-contract';
import { SettingsPane, SettingGroup, SettingRow } from './SettingsPrimitives';
import {
  FONT_FAMILIES,
  FONT_STYLES,
  FONT_WEIGHTS,
  TAB_INDENTS,
  SEARCH_ENGINES,
  DECODING_OPTIONS,
  ENCODING_OPTIONS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX
} from './settingsOptions';
import { EOL_MENU_ROWS } from '../statusbar/statusModel';
import { useT } from '../i18n/I18nProvider';

export interface PaneProps {
  settings: Settings;
  update(patch: Partial<Settings>): void;
}

/** Ported .resw key for each tab-indent option (UWP TabKeySettings radio set). */
const TAB_INDENT_KEYS: Record<number, string> = {
  [-1]: 'TextAndEditorPage_TabKeySettings_DefaultRadioButton.Content',
  2: 'TextAndEditorPage_TabKeySettings_TwoSpacesRadioButton.Content',
  4: 'TextAndEditorPage_TabKeySettings_FourSpacesRadioButton.Content',
  8: 'TextAndEditorPage_TabKeySettings_EightSpacesRadioButton.Content'
};

/** Ported .resw key for each fallback-decoding option. */
const DECODING_KEYS: Record<string, string> = {
  auto: 'TextAndEditorPage_DecodingSettings_AutoGuessRadioButton.Content',
  'utf-8': 'TextAndEditorPage_DecodingSettings_Utf8RadioButton.Content',
  ansi: 'TextAndEditorPage_DecodingSettings_AnsiRadioButton.Content'
};

export function TextEditorPane({ settings, update }: PaneProps): JSX.Element {
  const { t } = useT();
  const onFontSize = (_e: unknown, d: SpinButtonOnChangeData): void => {
    const v = d.value ?? (d.displayValue ? Number(d.displayValue) : null);
    if (v != null && Number.isFinite(v)) update({ editorFontSize: v });
  };

  const tabIndentLabel = (v: TabIndents): string =>
    TAB_INDENT_KEYS[v] ? t(TAB_INDENT_KEYS[v]) : String(v);
  const decodingLabel = (v: DefaultDecoding): string =>
    DECODING_KEYS[v] ? t(DECODING_KEYS[v]) : v;
  // Font style / weight / search engine / EOL keep their static option labels:
  // UWP rendered these from enum names with no per-option .resw string, so the
  // existing English labels stay (parity with the ported tables).
  const fontStyleLabel = (v: FontStyleId): string =>
    FONT_STYLES.find((s) => s.id === v)?.label ?? 'Normal';
  const fontWeightLabel = (v: number): string =>
    FONT_WEIGHTS.find((w) => w.weight === v)?.label ?? String(v);
  const searchEngineLabel = (v: SearchEngineId): string =>
    v === 'custom'
      ? t('TextAndEditorPage_SearchEngineSettings_CustomSearchUrlRadioButton.Text')
      : (SEARCH_ENGINES.find((s) => s.id === v)?.label ?? v);

  return (
    <SettingsPane id="textEditor">
      <SettingGroup title={t('TextAndEditorPage_DisplaySettings_Title.Text')}>
        <SettingRow
          id="textWrapping"
          label={t('TextAndEditorPage_TextWrappingSettings_ToggleSwitch.OnContent')}
        >
          <Switch
            checked={settings.textWrapping === 'wrap'}
            onChange={(_e, d) => update({ textWrapping: d.checked ? 'wrap' : 'noWrap' })}
          />
        </SettingRow>
        <SettingRow
          id="displayLineNumbers"
          label={t('TextAndEditorPage_LineNumbersSettings_ToggleSwitch.OnContent')}
          description={t('TextAndEditorPage_LineNumbersSettings_Description.Text')}
        >
          <Switch
            checked={settings.displayLineNumbers}
            onChange={(_e, d) => update({ displayLineNumbers: d.checked })}
          />
        </SettingRow>
        <SettingRow
          id="displayLineHighlighter"
          label={t('TextAndEditorPage_LineHighlighterSettings_ToggleSwitch.OnContent')}
        >
          <Switch
            checked={settings.displayLineHighlighter}
            onChange={(_e, d) => update({ displayLineHighlighter: d.checked })}
          />
        </SettingRow>
        <SettingRow
          id="highlightMisspelledWords"
          label={t(
            'TextAndEditorPage_SpellingSettings_HighlightMisspelledWordsToggleSwitch.OnContent'
          )}
        >
          <Switch
            checked={settings.highlightMisspelledWords}
            onChange={(_e, d) => update({ highlightMisspelledWords: d.checked })}
          />
        </SettingRow>
        <SettingRow
          id="tabIndents"
          layout="stack"
          label={t('TextAndEditorPage_TabKeySettings_Title.Text')}
          description={t('TextAndEditorPage_TabKeySettings_Description.Text')}
        >
          <RadioGroup
            data-testid="setting-tabIndents-group"
            value={String(settings.tabIndents)}
            onChange={(_e, d) => update({ tabIndents: Number(d.value) as TabIndents })}
          >
            {TAB_INDENTS.map((tt) => (
              <Radio key={tt.value} value={String(tt.value)} label={tabIndentLabel(tt.value)} />
            ))}
          </RadioGroup>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('TextAndEditorPage_FontSettings_Title.Text')}>
        <SettingRow
          id="editorFontFamily"
          layout="stack"
          label={t('TextAndEditorPage_FontFamilySettings_Title')}
        >
          <Dropdown
            data-testid="setting-editorFontFamily-dropdown"
            value={settings.editorFontFamily}
            selectedOptions={[settings.editorFontFamily]}
            onOptionSelect={(_e, d) => d.optionValue && update({ editorFontFamily: d.optionValue })}
            style={{ width: '100%' }}
          >
            {FONT_FAMILIES.map((f) => (
              <Option key={f} value={f}>
                {f}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
        <SettingRow id="editorFontSize" label={t('TextAndEditorPage_FontSettings_Title.Text')}>
          <SpinButton
            data-testid="setting-editorFontSize-spin"
            value={settings.editorFontSize}
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            onChange={onFontSize}
          />
        </SettingRow>
        <SettingRow
          id="editorFontStyle"
          layout="stack"
          label={t('TextAndEditorPage_FontStyleSettings_Title.Text')}
        >
          <Dropdown
            value={fontStyleLabel(settings.editorFontStyle)}
            selectedOptions={[settings.editorFontStyle]}
            onOptionSelect={(_e, d) => update({ editorFontStyle: d.optionValue as FontStyleId })}
            style={{ width: '100%' }}
          >
            {FONT_STYLES.map((s) => (
              <Option key={s.id} value={s.id}>
                {s.label}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
        <SettingRow
          id="editorFontWeight"
          layout="stack"
          label={t('TextAndEditorPage_FontWeightSettings_Title.Text')}
        >
          <Dropdown
            value={fontWeightLabel(settings.editorFontWeight)}
            selectedOptions={[String(settings.editorFontWeight)]}
            onOptionSelect={(_e, d) =>
              d.optionValue && update({ editorFontWeight: Number(d.optionValue) })
            }
            style={{ width: '100%' }}
          >
            {FONT_WEIGHTS.map((w) => (
              <Option key={w.weight} value={String(w.weight)}>
                {w.label}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('TextAndEditorPage_EncodingSettings_Title.Text')}>
        <SettingRow
          id="defaultLineEnding"
          layout="stack"
          label={t('TextAndEditorPage_LineEndingSettings_Title.Text')}
          description={t('TextAndEditorPage_LineEndingSettings_Description.Text')}
        >
          <RadioGroup
            data-testid="setting-defaultLineEnding-group"
            value={settings.defaultLineEnding}
            onChange={(_e, d) => update({ defaultLineEnding: d.value as EolId })}
          >
            {EOL_MENU_ROWS.map((r) => (
              <Radio key={r.eol} value={r.eol} label={r.text} />
            ))}
          </RadioGroup>
        </SettingRow>
        <SettingRow
          id="defaultEncoding"
          layout="stack"
          label={t('TextAndEditorPage_EncodingSettings_Title.Text')}
          description={t('TextAndEditorPage_EncodingSettings_Description.Text')}
        >
          <RadioGroup
            data-testid="setting-defaultEncoding-group"
            value={settings.defaultEncoding}
            onChange={(_e, d) => update({ defaultEncoding: d.value as EncodingId })}
          >
            {ENCODING_OPTIONS.map((o) => (
              <Radio key={o.id} value={o.id} label={o.label} />
            ))}
          </RadioGroup>
        </SettingRow>
        <SettingRow
          id="defaultDecoding"
          layout="stack"
          label={t('TextAndEditorPage_DecodingSettings_Title.Text')}
          description={t('TextAndEditorPage_DecodingSettings_Description.Text')}
        >
          <RadioGroup
            data-testid="setting-defaultDecoding-group"
            value={settings.defaultDecoding}
            onChange={(_e, d) => update({ defaultDecoding: d.value as DefaultDecoding })}
          >
            {DECODING_OPTIONS.map((o) => (
              <Radio key={o.id} value={o.id} label={decodingLabel(o.id)} />
            ))}
          </RadioGroup>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('TextAndEditorPage_WebSearch_GroupTitle')}>
        <SettingRow
          id="searchEngine"
          layout="stack"
          label={t('TextAndEditorPage_SearchEngineSettings_Title.Text')}
          description={t('TextAndEditorPage_SearchEngineSettings_Description.Text')}
        >
          <RadioGroup
            data-testid="setting-searchEngine-group"
            value={settings.searchEngine}
            onChange={(_e, d) => update({ searchEngine: d.value as SearchEngineId })}
          >
            {SEARCH_ENGINES.map((s) => (
              <Radio key={s.id} value={s.id} label={searchEngineLabel(s.id)} />
            ))}
          </RadioGroup>
        </SettingRow>
        {settings.searchEngine === 'custom' ? (
          <SettingRow
            id="customSearchUrl"
            layout="stack"
            label={t('TextAndEditorPage_SearchEngineSettings_CustomSearchUrlRadioButton.Text')}
            description={t('TextAndEditorPage_CustomSearchUrl_Description')}
          >
            <Input
              data-testid="setting-customSearchUrl-input"
              value={settings.customSearchUrl}
              placeholder="https://example.com/search?q={0}"
              onChange={(_e, d) => update({ customSearchUrl: d.value })}
              style={{ width: '100%' }}
            />
          </SettingRow>
        ) : null}
      </SettingGroup>
    </SettingsPane>
  );
}
