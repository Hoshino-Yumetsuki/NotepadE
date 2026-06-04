/**
 * SettingsSurface — the settings window shell (Phase 5, Stream C).
 *
 * A modal Dialog hosting a Fluent NavDrawer (4 sections) + the active pane, a
 * 1:1 structural port of the UWP SettingsPage (NavigationView with TextAndEditor
 * / Personalization / Advanced / About). The Nav uses Segoe MDL2 glyphs matching
 * the UWP NavigationViewItem icons.
 *
 * All four panes read/write the SAME live settings bag (useSettings, lifted to
 * the App so the bag is shared with the live theme + status-bar wiring). Changes
 * persist immediately via settings.set and reconcile via settings.onChanged.
 *
 * PA-8: renderer-only — consumes the settings bag + update callback (window.notepads
 * lives in useSettings/useAppTheme). No fs/path/child_process here.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  Button,
  FluentProvider,
  type Theme,
} from '@fluentui/react-components';
import { NavDrawer, NavDrawerBody, NavItem } from '@fluentui/react-components';
import type { Settings } from '@shared/ipc-contract';
import { TextEditorPane } from './TextEditorPane';
import { PersonalizationPane } from './PersonalizationPane';
import { AdvancedPane } from './AdvancedPane';
import { AboutPane } from './AboutPane';

/** The four settings sections (UWP SettingsPage NavigationViewItem tags). */
type SectionId = 'textEditor' | 'personalization' | 'advanced' | 'about';

const SECTIONS: readonly { id: SectionId; label: string; glyph: string }[] = [
  // Segoe MDL2 glyphs verbatim from UWP SettingsPage.xaml NavigationViewItem icons.
  { id: 'textEditor', label: 'Text & Editor', glyph: String.fromCharCode(0xf17f) },
  { id: 'personalization', label: 'Personalization', glyph: String.fromCharCode(0xe771) },
  { id: 'advanced', label: 'Advanced', glyph: String.fromCharCode(0xe9e9) },
  { id: 'about', label: 'About', glyph: String.fromCharCode(0xe946) },
];

/** Segoe MDL2 ChromeClose (E711) for the dialog close button. */
const CLOSE_GLYPH = String.fromCharCode(0xe711);

export interface SettingsSurfaceProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  settings: Settings;
  update(patch: Partial<Settings>): void;
  /** The Fluent theme to render the surface with (kept in sync with the app). */
  theme: Theme;
}

/** Segoe MDL2 glyph used as a Nav item icon. */
function NavGlyph({ glyph }: { glyph: string }): JSX.Element {
  return (
    <span aria-hidden style={{ fontFamily: '"Segoe MDL2 Assets"', fontSize: 16 }}>
      {glyph}
    </span>
  );
}

export function SettingsSurface(props: SettingsSurfaceProps): JSX.Element {
  const [section, setSection] = useState<SectionId>('textEditor');
  const { settings, update } = props;

  return (
    <Dialog open={props.open} onOpenChange={(_e, d) => props.onOpenChange(d.open)}>
      <DialogSurface
        data-testid="settings-surface"
        style={{ maxWidth: 880, width: '90vw', padding: 0 }}
      >
        <FluentProvider theme={props.theme} style={{ background: 'transparent' }}>
          <DialogBody style={{ display: 'block' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px 0',
              }}
            >
              <DialogTitle action={null}>Settings</DialogTitle>
              <Button
                appearance="subtle"
                aria-label="Close settings"
                data-testid="settings-close"
                icon={<NavGlyph glyph={CLOSE_GLYPH} />}
                onClick={() => props.onOpenChange(false)}
              />
            </div>
            <DialogContent>
              <div style={{ display: 'flex', gap: 8, height: '70vh', minHeight: 420 }}>
                <NavDrawer
                  open
                  type="inline"
                  selectedValue={section}
                  onNavItemSelect={(_e, d) => setSection(d.value as SectionId)}
                  data-testid="settings-nav"
                  style={{ minWidth: 200, height: '100%' }}
                >
                  <NavDrawerBody>
                    {SECTIONS.map((s) => (
                      <NavItem
                        key={s.id}
                        value={s.id}
                        icon={<NavGlyph glyph={s.glyph} />}
                        data-testid={`settings-nav-${s.id}`}
                      >
                        {s.label}
                      </NavItem>
                    ))}
                  </NavDrawerBody>
                </NavDrawer>
                <div style={{ flex: '1 1 auto', minWidth: 0, height: '100%' }}>
                  {section === 'textEditor' ? (
                    <TextEditorPane settings={settings} update={update} />
                  ) : null}
                  {section === 'personalization' ? (
                    <PersonalizationPane settings={settings} update={update} />
                  ) : null}
                  {section === 'advanced' ? (
                    <AdvancedPane settings={settings} update={update} />
                  ) : null}
                  {section === 'about' ? <AboutPane /> : null}
                </div>
              </div>
            </DialogContent>
          </DialogBody>
        </FluentProvider>
      </DialogSurface>
    </Dialog>
  );
}
