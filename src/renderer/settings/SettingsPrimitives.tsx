/**
 * Shared layout primitives for the settings panes (Phase 5, Stream C).
 *
 * A pane is a vertical stack of titled groups; each group is a list of rows
 * (label + control). These primitives keep the four panes visually consistent
 * with the UWP SettingsPanel (a header + stacked setting blocks) without
 * repeating the flex/spacing boilerplate in every pane.
 *
 * PA-8: pure presentational React — no fs/path/child_process, no IPC.
 */

import { Subtitle2, Text } from '@fluentui/react-components';
import type { CSSProperties, ReactNode } from 'react';

const groupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginBottom: 28
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  minHeight: 32
};

/**
 * Stacked-row variant (label above, control below). Used for WIDE controls
 * (Dropdown / SpinButton / RadioGroup / Input / color picker): at the 385px pane
 * width a wide control + a localized label cannot share one `space-between` line
 * without the label wrapping into a vertical sliver, so those rows go full-width
 * vertical — matching the UWP settings sub-pages, which stack titled controls.
 */
const rowStackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 6,
  minHeight: 32
};

const rowLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: '1 1 auto',
  minWidth: 0
};

const paneStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  // Minimal horizontal inset (was 8px each side): the outer SettingsSurface pane
  // already supplies the edge gutter, so trimming the stacked padding hands the
  // content column more usable width — keeps rows on one line at the 385px pane.
  padding: '4px 4px 24px 4px',
  overflowY: 'auto',
  height: '100%',
  boxSizing: 'border-box'
};

/** A titled group of related settings. */
export function SettingGroup(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section style={groupStyle}>
      <Subtitle2>{props.title}</Subtitle2>
      {props.children}
    </section>
  );
}

/** A single setting row with optional description.
 *
 * `layout` (default 'inline') controls the geometry:
 *  - 'inline' — label left, control right (use for narrow controls: Switch).
 *  - 'stack'  — label above a full-width control (use for wide controls:
 *    Dropdown / SpinButton / RadioGroup / Input / color picker) so neither the
 *    label nor the control gets crushed at the 385px pane width.
 */
export function SettingRow(props: {
  label: string;
  description?: string;
  /** Used as a stable e2e/testing anchor: data-testid="setting-{id}". */
  id: string;
  layout?: 'inline' | 'stack';
  children: ReactNode;
}): JSX.Element {
  const stacked = props.layout === 'stack';
  return (
    <div style={stacked ? rowStackStyle : rowStyle} data-testid={`setting-${props.id}`}>
      <div style={rowLabelStyle}>
        <Text weight="semibold">{props.label}</Text>
        {props.description ? (
          <Text size={200} style={{ opacity: 0.8 }}>
            {props.description}
          </Text>
        ) : null}
      </div>
      <div style={stacked ? { width: '100%' } : { flex: '0 0 auto' }}>{props.children}</div>
    </div>
  );
}

/** The scrolling container a pane's groups live in. */
export function SettingsPane(props: { id: string; children: ReactNode }): JSX.Element {
  return (
    <div style={paneStyle} data-testid={`settings-pane-${props.id}`} role="tabpanel">
      {props.children}
    </div>
  );
}
