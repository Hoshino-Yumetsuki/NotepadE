/**
 * About settings pane (Phase 5, Stream C) — UWP AboutPage.
 *
 * Version, upstream/support links, third-party dependency credits, and the
 * license disclaimer. Links open via window.notepads.shell.webSearch is NOT
 * appropriate here (these are URLs, not searches); the contract has no generic
 * "open external URL" channel in Phase 5, so links render as anchors with
 * target=_blank — Electron routes new-window navigations through the main
 * process's will-navigate/new-window handler (lane-a), keeping PA-8 intact.
 *
 * PA-8: pure presentational — no IPC/fs.
 */

import { Title3, Subtitle2, Body1, Text, Link, Divider } from '@fluentui/react-components';
import { SettingsPane, SettingGroup } from './SettingsPrimitives';
import {
  APP_NAME,
  APP_VERSION,
  ABOUT_LINKS,
  DEPENDENCY_CREDITS,
  ABOUT_DISCLAIMER,
} from './aboutInfo';
import { useT } from '../i18n/I18nProvider';

export function AboutPane(): JSX.Element {
  const { t } = useT();
  return (
    <SettingsPane id="about">
      <SettingGroup title="">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Title3>{APP_NAME}</Title3>
          <Text size={300} style={{ opacity: 0.8 }} data-testid="about-version">
            {t('AboutPage_Version_Label', APP_VERSION)}
          </Text>
        </div>
      </SettingGroup>

      <SettingGroup title={t('AboutPage_Links_GroupTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ABOUT_LINKS.map((l) => (
            <Link key={l.url} href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </Link>
          ))}
        </div>
      </SettingGroup>

      <SettingGroup title={t('AboutPage_BuiltWith_GroupTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DEPENDENCY_CREDITS.map((d) => (
            <Link key={d.url} href={d.url} target="_blank" rel="noreferrer">
              {d.label}
            </Link>
          ))}
        </div>
      </SettingGroup>

      <Divider />
      <div style={{ marginTop: 16 }}>
        <Subtitle2>{t('AboutPage_Disclaimer_Title.Text')}</Subtitle2>
        <Body1 as="p" style={{ marginTop: 6, opacity: 0.85 }}>
          {ABOUT_DISCLAIMER}
        </Body1>
      </div>
    </SettingsPane>
  );
}
