import type { Settings } from '@shared/ipc-contract';

export interface PaneProps {
  settings: Settings;
  update(patch: Partial<Settings>): void;
}
