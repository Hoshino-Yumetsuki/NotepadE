/**
 * SettingsSurface — the settings pane shell (Phase 5, Stream C; UI-fidelity pass).
 *
 * A RIGHT-side overlay pane (1:1 UWP RootSplitView DisplayMode=Overlay,
 * PanePlacement=Right, OpenPaneLength=385): a dim scrim covers the app and the
 * ~385px pane slides in from the right edge, full height. Dismisses on Esc or a
 * scrim click. Inside it keeps the UWP SettingsPage layout — a vertical nav rail
 * (TextAndEditor / Personalization / Advanced / About) on the left and the active
 * pane on the right.
 *
 * (Replaces the prior centered modal Dialog; the open/close contract — the `open`
 * + `onOpenChange` props the App drives via Ctrl+, / the hamburger menu and
 * the installSettingsTestHook seam — is unchanged, as are every data-testid the
 * Gate-5 e2e relies on: settings-surface / settings-nav / settings-nav-${id} /
 * settings-close.)
 *
 * All four panes read/write the SAME live settings bag (useSettings, lifted to
 * the App so the bag is shared with the live theme + status-bar wiring). Changes
 * persist immediately via settings.set and reconcile via settings.onChanged.
 *
 * PA-8: renderer-only — consumes the settings bag + update callback (window.notepads
 * lives in useSettings/useAppTheme). No fs/path/child_process here.
 */

import { useEffect, useState } from 'react';
import { Button, FluentProvider, type Theme } from '@fluentui/react-components';
import type { Settings } from '@shared/ipc-contract';
import { TextEditorPane } from './TextEditorPane';
import { PersonalizationPane } from './PersonalizationPane';
import { AdvancedPane } from './AdvancedPane';
import { AboutPane } from './AboutPane';
import { acrylicVars, type AppTheme } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';

/** The four settings sections (UWP SettingsPage NavigationViewItem tags). */
type SectionId = 'textEditor' | 'personalization' | 'advanced' | 'about';

/**
 * Section nav metadata. `labelKey` is the ported UWP NavigationViewItem.Content
 * resource (verified present in all 29 locale tables) so the rail re-localizes
 * live on a language switch; `glyph` is the Segoe MDL2 icon verbatim from
 * SettingsPage.xaml.
 */
const SECTIONS: readonly { id: SectionId; labelKey: string; glyph: string }[] = [
  {
    id: 'textEditor',
    labelKey: 'TextAndEditorPage_Title.Content',
    glyph: String.fromCharCode(0xf17f),
  },
  {
    id: 'personalization',
    labelKey: 'PersonalizationPage_Title.Content',
    glyph: String.fromCharCode(0xe771),
  },
  { id: 'advanced', labelKey: 'AdvancedPage_Title.Content', glyph: String.fromCharCode(0xe9e9) },
  { id: 'about', labelKey: 'AboutPage_Title.Content', glyph: String.fromCharCode(0xe946) },
];

/** Segoe MDL2 ChromeClose (E711) for the pane close button. */
const CLOSE_GLYPH = String.fromCharCode(0xe711);

/** Segoe MDL2 GlobalNavigationButton (E700) — the hamburger rail toggle. */
const HAMBURGER_GLYPH = String.fromCharCode(0xe700);

/** UWP RootSplitView.OpenPaneLength — the right pane is 385px wide. */
const PANE_WIDTH = 385;

/** UWP NavigationView PaneDisplayMode=LeftCompact rail widths (compact / expanded). */
const RAIL_COMPACT_WIDTH = 48;
const RAIL_EXPANDED_WIDTH = 200;

export interface SettingsSurfaceProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  settings: Settings;
  update(patch: Partial<Settings>): void;
  /** The Fluent theme to render the surface with (kept in sync with the app). */
  theme: Theme;
  /**
   * Resolved app theme bucket ('light'|'dark'|'hc') — selects the acrylic
   * approximation tint/blur (Phase 7, Task #26). Optional + defaults to 'dark'
   * so existing call sites/tests are unaffected.
   */
  resolvedTheme?: AppTheme;
}

/** Segoe MDL2 glyph used as a Nav item icon. */
function NavGlyph({ glyph }: { glyph: string }): JSX.Element {
  return (
    <span aria-hidden style={{ fontFamily: '"Segoe MDL2 Assets"', fontSize: 16 }}>
      {glyph}
    </span>
  );
}

export function SettingsSurface(props: SettingsSurfaceProps): JSX.Element | null {
  const [section, setSection] = useState<SectionId>('textEditor');
  // Rail expand state (UWP NavigationView LeftCompact: a hamburger toggles the rail
  // between an icon-only compact strip and the 200px icon+label open pane).
  const [expanded, setExpanded] = useState(false);
  const { settings, update, open, onOpenChange } = props;
  const resolvedTheme: AppTheme = props.resolvedTheme ?? 'dark';
  const { t } = useT();

  // The active section's localized title (UWP SettingsPanel header TextBlock,
  // FontSize 24, updated per ContentFrame navigation).
  const sectionTitle = SECTIONS.find((s) => s.id === section)?.labelKey ?? '';

  // Slide-in perf gate: the pane animates transform: translateX over 160ms while
  // wearing .np-acrylic (backdrop-filter: blur(30px)). Re-blurring the 30px kernel
  // over the full 385px×full-height pane every frame as it moves over changing
  // content behind it is what makes the open stutter. So we keep the blur OFF during
  // the slide (data-acrylic-animating in acrylic.css suppresses backdrop-filter; the
  // tint + luminosity still ride along) and only switch the heavy blur on once the
  // pane is stationary — on animationend. `will-change: transform` hints the
  // compositor during the slide and is dropped once settled so it costs nothing at
  // rest. The settled look is identical to the always-on blur.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!open) {
      // Reset so the next open re-runs the slide cheap (the instance is kept mounted
      // by the App across open/close, so state would otherwise persist).
      setSettled(false);
      return;
    }
    // Fallback: guarantee the settled blur even if animationend never arrives — a
    // stripped/instant keyframe (the inlined <style> degrades to an instant show if
    // chrome.css is absent) or a reduced-motion engine may skip the event. Slightly
    // longer than the 160ms slide so it only fires if the event was genuinely missed.
    const id = window.setTimeout(() => setSettled(true), 220);
    return () => window.clearTimeout(id);
  }, [open]);

  // Esc closes the pane (UWP SettingsPage back/close). Bound only while open so it
  // never competes with the editor's own Esc handling (find-bar dismiss etc.).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    // Capture phase so the pane wins Esc over editor-level listeners while open.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      data-testid="settings-overlay"
      // Dim scrim over the whole app; a click on it (outside the pane) closes.
      onClick={() => onOpenChange(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/* Right-pane slide-in keyframes. Inlined here (chrome.css is another lane)
          so the open transition works; degrades to an instant show if stripped. */}
      <style>
        {
          '@keyframes np-settings-slide-in{from{transform:translateX(100%)}to{transform:translateX(0)}}'
        }
      </style>
      <FluentProvider
        theme={props.theme}
        data-testid="settings-surface"
        className="np-acrylic"
        // While the slide is in flight the heavy backdrop blur is suppressed (see
        // the `settled` gate above + acrylic.css). The attribute is omitted once
        // settled, so the expensive blur only kicks in on the stationary pane.
        data-acrylic-animating={settled ? undefined : ''}
        // Switch the blur on the moment the slide finishes (the timeout above is the
        // belt-and-braces fallback for a skipped/instant keyframe).
        onAnimationEnd={(e) => {
          if (e.animationName === 'np-settings-slide-in') setSettled(true);
        }}
        // Stop scrim-dismiss when the click lands inside the pane itself.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: PANE_WIDTH,
          maxWidth: '100vw',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          // Slide-in from the right edge is the open transition; the e2e capture
          // helper pins transform:none so the golden is timing-independent.
          animationName: 'np-settings-slide-in',
          animationDuration: '160ms',
          animationTimingFunction: 'ease-out',
          // Hint the compositor during the slide; drop it at rest so a stationary
          // pane pays nothing for the promotion.
          willChange: settled ? undefined : 'transform',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.35)',
          ...acrylicVars(resolvedTheme),
        }}
      >
        {/* Pane chrome bar: title + close (UWP SplitView pane header). */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 12px 8px 16px',
            flex: '0 0 auto',
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 600 }}>
            {t('MainMenu_Button_Settings.Text')}
          </span>
          <Button
            appearance="subtle"
            aria-label={t('SettingsShell_Close.AutomationProperties.Name')}
            data-testid="settings-close"
            icon={<NavGlyph glyph={CLOSE_GLYPH} />}
            onClick={() => onOpenChange(false)}
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 0,
            flex: '1 1 auto',
            minHeight: 0,
          }}
        >
          {/* UWP NavigationView PaneDisplayMode=LeftCompact: a hamburger toggles the
              rail between a 48px icon-only strip and a 200px icon+label pane. The rail
              overlays nothing — it just widens — and items show a selection pill
              (Fluent `secondary` appearance) + keep localized aria-labels/tooltips. */}
          <div
            role="tablist"
            aria-orientation="vertical"
            data-testid="settings-nav"
            style={{
              width: expanded ? RAIL_EXPANDED_WIDTH : RAIL_COMPACT_WIDTH,
              flex: '0 0 auto',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '0 4px',
              boxSizing: 'border-box',
              transition: 'width 150ms ease',
              overflow: 'hidden',
            }}
          >
            <Button
              appearance="subtle"
              aria-label={t('SettingsNav_Expand.AutomationProperties.Name')}
              aria-expanded={expanded}
              data-testid="settings-nav-toggle"
              icon={<NavGlyph glyph={HAMBURGER_GLYPH} />}
              onClick={() => setExpanded((v) => !v)}
              style={{
                minWidth: 0,
                width: '100%',
                justifyContent: expanded ? 'flex-start' : 'center',
                paddingLeft: expanded ? 10 : 0,
                paddingRight: 0,
                marginBottom: 4,
              }}
            />
            {SECTIONS.map((s) => (
              <Button
                key={s.id}
                role="tab"
                aria-selected={section === s.id}
                aria-label={t(s.labelKey)}
                title={t(s.labelKey)}
                appearance={section === s.id ? 'secondary' : 'subtle'}
                icon={<NavGlyph glyph={s.glyph} />}
                data-testid={`settings-nav-${s.id}`}
                onClick={() => setSection(s.id)}
                style={{
                  minWidth: 0,
                  width: '100%',
                  justifyContent: expanded ? 'flex-start' : 'center',
                  paddingLeft: expanded ? 10 : 0,
                  paddingRight: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                {/* Label appears only when expanded (icon-only rail otherwise). */}
                {expanded ? t(s.labelKey) : null}
              </Button>
            ))}
          </div>
          {/* Content column: per-section 24px title + bottom-border header
              (UWP SettingsPanel.xaml 60px header row), then the scrolling pane. */}
          <div
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              padding: '0 8px 0 12px',
            }}
          >
            <div
              data-testid="settings-section-title"
              style={{
                flex: '0 0 auto',
                fontSize: 24,
                lineHeight: '1.2',
                fontWeight: 600,
                padding: '0 0 10px 0',
                marginBottom: 8,
                borderBottom: '1px solid var(--colorNeutralStroke2)',
              }}
            >
              {t(sectionTitle)}
            </div>
            <div style={{ flex: '1 1 auto', minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
              {section === 'textEditor' ? (
                <TextEditorPane settings={settings} update={update} />
              ) : null}
              {section === 'personalization' ? (
                <PersonalizationPane settings={settings} update={update} />
              ) : null}
              {section === 'advanced' ? <AdvancedPane settings={settings} update={update} /> : null}
              {section === 'about' ? <AboutPane /> : null}
            </div>
          </div>
        </div>
      </FluentProvider>
    </div>
  );
}
