/**
 * About settings pane (Phase 5, Stream C) — UWP AboutPage.
 *
 * Version, upstream/support links, third-party dependency credits, the
 * license disclaimer, and the update controls (auto-check toggle + manual
 * check button with inline result feedback).
 */

import { useState } from 'react';
import {
  Title3,
  Subtitle2,
  Body1,
  Text,
  Link,
  Divider,
  Switch,
  Button,
  Spinner,
  tokens
} from '@fluentui/react-components';
import { SettingsPane, SettingGroup, SettingRow } from './SettingsPrimitives';
import {
  APP_NAME,
  APP_VERSION,
  ABOUT_LINKS,
  DEPENDENCY_CREDITS,
  ABOUT_DISCLAIMER
} from './aboutInfo';
import { useT } from '../i18n/I18nProvider';
import type { PaneProps } from './types';
import type { UpdateInfo } from '@shared/ipc-contract';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'upToDate' }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'error'; message: string };

export function AboutPane({ settings, update }: PaneProps): JSX.Element {
  const { t } = useT();
  const [checkState, setCheckState] = useState<CheckState>({ status: 'idle' });

  const doCheck = (): void => {
    setCheckState({ status: 'checking' });
    void window.notepads.updates
      .check()
      .then((r) => {
        if (!r.ok) {
          setCheckState({ status: 'error', message: r.error });
        } else if (r.data.available) {
          setCheckState({ status: 'available', info: r.data });
        } else {
          setCheckState({ status: 'upToDate' });
        }
      })
      .catch((e: unknown) => {
        setCheckState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  };

  const doInstall = (info: UpdateInfo): void => {
    void window.notepads.updates.install(info.assetUrl, info.assetName, info.htmlUrl);
  };

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

      <SettingGroup title={t('Updates_AutoCheckToggle')}>
        <SettingRow id="autoCheckUpdates" label={t('Updates_AutoCheckToggle')}>
          <Switch
            checked={settings.autoCheckUpdates}
            onChange={(_e, d) => update({ autoCheckUpdates: d.checked })}
          />
        </SettingRow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <Button
              data-testid="check-updates-button"
              disabled={checkState.status === 'checking'}
              onClick={doCheck}
            >
              {t('Updates_CheckButton')}
            </Button>
          </div>
          {checkState.status === 'checking' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spinner size="tiny" />
              <Text size={200}>{t('Updates_Checking')}</Text>
            </div>
          )}
          {checkState.status === 'upToDate' && (
            <Text size={200} style={{ color: tokens.colorPaletteGreenForeground1 }}>
              {t('Updates_UpToDate')}
            </Text>
          )}
          {checkState.status === 'error' && (
            <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
              {t('Updates_CheckFailed')} {checkState.message}
            </Text>
          )}
          {checkState.status === 'available' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size={200}>{t('Updates_Available', checkState.info.version)}</Text>
              <div>
                <Button
                  appearance="primary"
                  data-testid="install-update-button"
                  onClick={() => doInstall(checkState.info)}
                >
                  {t('Updates_InstallNow')}
                </Button>
              </div>
            </div>
          )}
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: -12 }}>
        <Divider />
        <div>
          <Subtitle2>{t('AboutPage_Disclaimer_Title.Text')}</Subtitle2>
          <Body1 as="p" style={{ marginTop: 10, opacity: 0.85 }}>
            {ABOUT_DISCLAIMER}
          </Body1>
        </div>
      </div>
    </SettingsPane>
  );
}
