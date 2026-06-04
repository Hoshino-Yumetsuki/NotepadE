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
  marginBottom: 28,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  minHeight: 32,
};

const rowLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: '1 1 auto',
  minWidth: 0,
};

const paneStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '4px 8px 24px',
  overflowY: 'auto',
  height: '100%',
  boxSizing: 'border-box',
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

/** A single label-left / control-right setting row, with optional description. */
export function SettingRow(props: {
  label: string;
  description?: string;
  /** Used as a stable e2e/testing anchor: data-testid="setting-{id}". */
  id: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={rowStyle} data-testid={`setting-${props.id}`}>
      <div style={rowLabelStyle}>
        <Text weight="semibold">{props.label}</Text>
        {props.description ? (
          <Text size={200} style={{ opacity: 0.8 }}>
            {props.description}
          </Text>
        ) : null}
      </div>
      <div style={{ flex: '0 0 auto' }}>{props.children}</div>
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
