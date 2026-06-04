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
  type SpinButtonOnChangeData,
} from '@fluentui/react-components';
import type { Settings } from '@shared/ipc-contract';
import type { EolId, FontStyleId, TabIndents, SearchEngineId, DefaultDecoding } from '@shared/ipc-contract';
import { SettingsPane, SettingGroup, SettingRow } from './SettingsPrimitives';
import {
  FONT_FAMILIES,
  FONT_STYLES,
  FONT_WEIGHTS,
  TAB_INDENTS,
  SEARCH_ENGINES,
  DECODING_OPTIONS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
} from './settingsOptions';
import { EOL_MENU_ROWS } from '../statusbar/statusModel';

export interface PaneProps {
  settings: Settings;
  update(patch: Partial<Settings>): void;
}

export function TextEditorPane({ settings, update }: PaneProps): JSX.Element {
  const onFontSize = (_e: unknown, d: SpinButtonOnChangeData): void => {
    const v = d.value ?? (d.displayValue ? Number(d.displayValue) : null);
    if (v != null && Number.isFinite(v)) update({ editorFontSize: v });
  };

  return (
    <SettingsPane id="textEditor">
      <SettingGroup title="Editor">
        <SettingRow id="textWrapping" label="Word wrap" description="Wrap long lines to the editor width.">
          <Switch
            checked={settings.textWrapping === 'wrap'}
            onChange={(_e, d) => update({ textWrapping: d.checked ? 'wrap' : 'noWrap' })}
          />
        </SettingRow>
        <SettingRow id="displayLineNumbers" label="Line numbers">
          <Switch
            checked={settings.displayLineNumbers}
            onChange={(_e, d) => update({ displayLineNumbers: d.checked })}
          />
        </SettingRow>
        <SettingRow id="displayLineHighlighter" label="Highlight current line">
          <Switch
            checked={settings.displayLineHighlighter}
            onChange={(_e, d) => update({ displayLineHighlighter: d.checked })}
          />
        </SettingRow>
        <SettingRow
          id="highlightMisspelledWords"
          label="Highlight misspelled words"
          description="Spellcheck red-underline."
        >
          <Switch
            checked={settings.highlightMisspelledWords}
            onChange={(_e, d) => update({ highlightMisspelledWords: d.checked })}
          />
        </SettingRow>
        <SettingRow id="tabIndents" label="Tab key inserts">
          <Dropdown
            data-testid="setting-tabIndents-dropdown"
            value={tabIndentLabel(settings.tabIndents)}
            selectedOptions={[String(settings.tabIndents)]}
            onOptionSelect={(_e, d) =>
              update({ tabIndents: Number(d.optionValue) as TabIndents })
            }
          >
            {TAB_INDENTS.map((t) => (
              <Option key={t.value} value={String(t.value)}>
                {t.label}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Font">
        <SettingRow id="editorFontFamily" label="Font family">
          <Dropdown
            data-testid="setting-editorFontFamily-dropdown"
            value={settings.editorFontFamily}
            selectedOptions={[settings.editorFontFamily]}
            onOptionSelect={(_e, d) => d.optionValue && update({ editorFontFamily: d.optionValue })}
          >
            {FONT_FAMILIES.map((f) => (
              <Option key={f} value={f}>
                {f}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
        <SettingRow id="editorFontSize" label="Font size">
          <SpinButton
            data-testid="setting-editorFontSize-spin"
            value={settings.editorFontSize}
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            onChange={onFontSize}
          />
        </SettingRow>
        <SettingRow id="editorFontStyle" label="Font style">
          <Dropdown
            value={fontStyleLabel(settings.editorFontStyle)}
            selectedOptions={[settings.editorFontStyle]}
            onOptionSelect={(_e, d) =>
              update({ editorFontStyle: d.optionValue as FontStyleId })
            }
          >
            {FONT_STYLES.map((s) => (
              <Option key={s.id} value={s.id}>
                {s.label}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
        <SettingRow id="editorFontWeight" label="Font weight">
          <Dropdown
            value={fontWeightLabel(settings.editorFontWeight)}
            selectedOptions={[String(settings.editorFontWeight)]}
            onOptionSelect={(_e, d) =>
              d.optionValue && update({ editorFontWeight: Number(d.optionValue) })
            }
          >
            {FONT_WEIGHTS.map((w) => (
              <Option key={w.weight} value={String(w.weight)}>
                {w.label}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Defaults for new files">
        <SettingRow id="defaultLineEnding" label="Line ending">
          <Dropdown
            value={eolLabel(settings.defaultLineEnding)}
            selectedOptions={[settings.defaultLineEnding]}
            onOptionSelect={(_e, d) => update({ defaultLineEnding: d.optionValue as EolId })}
          >
            {EOL_MENU_ROWS.map((r) => (
              <Option key={r.eol} value={r.eol}>
                {r.text}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
        <SettingRow id="defaultEncoding" label="Encoding">
          <Input
            data-testid="setting-defaultEncoding-input"
            value={settings.defaultEncoding}
            onChange={(_e, d) => update({ defaultEncoding: d.value })}
          />
        </SettingRow>
        <SettingRow id="defaultDecoding" label="Decoding">
          <Dropdown
            value={decodingLabel(settings.defaultDecoding)}
            selectedOptions={[settings.defaultDecoding]}
            onOptionSelect={(_e, d) =>
              update({ defaultDecoding: d.optionValue as DefaultDecoding })
            }
          >
            {DECODING_OPTIONS.map((o) => (
              <Option key={o.id} value={o.id}>
                {o.label}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Web search">
        <SettingRow id="searchEngine" label="Search engine">
          <Dropdown
            value={searchEngineLabel(settings.searchEngine)}
            selectedOptions={[settings.searchEngine]}
            onOptionSelect={(_e, d) =>
              update({ searchEngine: d.optionValue as SearchEngineId })
            }
          >
            {SEARCH_ENGINES.map((s) => (
              <Option key={s.id} value={s.id}>
                {s.label}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
        {settings.searchEngine === 'custom' ? (
          <SettingRow
            id="customSearchUrl"
            label="Custom search URL"
            description="Use {0} where the query should go."
          >
            <Input
              data-testid="setting-customSearchUrl-input"
              value={settings.customSearchUrl}
              placeholder="https://example.com/search?q={0}"
              onChange={(_e, d) => update({ customSearchUrl: d.value })}
            />
          </SettingRow>
        ) : null}
      </SettingGroup>
    </SettingsPane>
  );
}

function tabIndentLabel(v: TabIndents): string {
  return TAB_INDENTS.find((t) => t.value === v)?.label ?? 'Tab';
}
function fontStyleLabel(v: FontStyleId): string {
  return FONT_STYLES.find((s) => s.id === v)?.label ?? 'Normal';
}
function fontWeightLabel(v: number): string {
  return FONT_WEIGHTS.find((w) => w.weight === v)?.label ?? String(v);
}
function eolLabel(v: EolId): string {
  return EOL_MENU_ROWS.find((r) => r.eol === v)?.text ?? v;
}
function decodingLabel(v: DefaultDecoding): string {
  return DECODING_OPTIONS.find((o) => o.id === v)?.label ?? v;
}
function searchEngineLabel(v: SearchEngineId): string {
  return SEARCH_ENGINES.find((s) => s.id === v)?.label ?? v;
}
