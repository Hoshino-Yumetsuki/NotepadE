import type { JSX } from 'react';
import { DialogSurface, type DialogSurfaceProps } from '@fluentui/react-components';
import { isMac } from '@shared/platform';
import { acrylicVars, type AppTheme } from './tokens';
import { dialogSurfaceStyle, dialogBackdropStyle } from './dialogStyles';
import { useAppTheme } from './useAppTheme';

export interface AppDialogSurfaceProps extends DialogSurfaceProps {
  /** Resolved app theme. If omitted, dynamically resolved via useAppTheme. */
  readonly theme?: AppTheme;
}

export function AppDialogSurface(props: AppDialogSurfaceProps): JSX.Element {
  const { theme: propTheme, className, style, backdrop, children, ...rest } = props;
  const { resolved } = useAppTheme();
  const theme = propTheme ?? resolved;

  const combinedClassName = `np-dialog-enter${isMac ? ' np-mac-panel' : ''}${className ? ` ${className}` : ''}`;

  const computedStyle = {
    ...dialogSurfaceStyle(theme),
    ...(isMac ? { ...acrylicVars(theme), padding: '4px' } : undefined),
    ...style
  };

  const backdropConfig =
    typeof backdrop === 'object' && backdrop !== null && !('$$typeof' in backdrop)
      ? (backdrop as Record<string, unknown>)
      : {};
  const computedBackdrop = {
    ...backdropConfig,
    style: {
      ...dialogBackdropStyle(theme),
      ...('style' in backdropConfig &&
      typeof backdropConfig.style === 'object' &&
      backdropConfig.style !== null
        ? backdropConfig.style
        : {})
    }
  };

  return (
    <DialogSurface
      {...rest}
      className={combinedClassName}
      data-theme={theme}
      style={computedStyle}
      backdrop={computedBackdrop}
    >
      {children}
    </DialogSurface>
  );
}
