import type { JSX } from 'react';
import { MenuPopover, type MenuPopoverProps } from '@fluentui/react-components';
import { isMac } from '@shared/platform';
import { acrylicVars, type AppTheme } from './tokens';
import { useAppTheme } from './useAppTheme';

export interface ThemedMenuPopoverProps extends MenuPopoverProps {
  /** Resolved app theme. If omitted, dynamically resolved via useAppTheme. */
  readonly theme?: AppTheme;
}

export function ThemedMenuPopover(props: ThemedMenuPopoverProps): JSX.Element {
  const { theme: propTheme, className, style, children, ...rest } = props;
  const { resolved } = useAppTheme();
  const theme = propTheme ?? resolved;

  const combinedClassName = `${isMac ? 'np-mac-panel' : ''}${className ? (isMac ? ' ' : '') + className : ''}`;

  const computedStyle = {
    ...(isMac ? { ...acrylicVars(theme), padding: '4px' } : undefined),
    ...style
  };

  return (
    <MenuPopover
      {...rest}
      className={combinedClassName || undefined}
      data-theme={theme}
      style={computedStyle}
    >
      {children}
    </MenuPopover>
  );
}
