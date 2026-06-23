import { useState, useCallback, useEffect, memo } from 'react';
import { useT } from '../i18n';
import type { FolderEntry } from '@shared/ipc-contract';
import {
  FolderRegular,
  DocumentRegular,
  ChevronRightRegular,
  ChevronDownRegular,
  DismissRegular
} from '@fluentui/react-icons';
import { TabDimensions } from '../tabs/tokens';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  expanded?: boolean;
  loaded?: boolean;
}

type FolderMenuAction = 'newFile' | 'newFolder' | 'rename' | 'delete' | 'refresh';

interface FolderContextMenuState {
  x: number;
  y: number;
  target: TreeNode | null;
  parentPath: string;
}

export interface FolderSidebarProps {
  folderPath: string;
  theme: 'light' | 'dark' | 'hc';
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
//  Color tokens
// ---------------------------------------------------------------------------

function colorsForTheme(theme: 'light' | 'dark' | 'hc') {
  if (theme === 'hc') {
    return {
      text: 'ButtonText',
      hover: 'Highlight',
      hoverText: 'HighlightText',
      header: 'Canvas',
      headerText: 'CanvasText',
      border: 'ButtonText',
      icon: 'ButtonText',
      menu: 'Canvas',
      menuShadow: '0 0 0 1px ButtonText'
    };
  }
  if (theme === 'dark') {
    return {
      text: '#E6E6E6',
      hover: 'rgba(255,255,255,0.08)',
      hoverText: '#E6E6E6',
      header: 'transparent',
      headerText: '#BBBBBB',
      border: 'rgba(255,255,255,0.12)',
      icon: '#BBBBBB',
      menu: 'rgba(32,32,32,0.98)',
      menuShadow: '0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.12)'
    };
  }
  // light
  return {
    text: '#1A1A1A',
    hover: 'rgba(0,0,0,0.06)',
    hoverText: '#1A1A1A',
    header: 'transparent',
    headerText: '#555555',
    border: 'rgba(0,0,0,0.10)',
    icon: '#555555',
    menu: 'rgba(255,255,255,0.98)',
    menuShadow: '0 8px 24px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.10)'
  };
}

// ---------------------------------------------------------------------------
//  Icon helper (Fluent UI v9 SVG — cross-platform, replaces Segoe MDL2)
// ---------------------------------------------------------------------------

const ICON_STYLE: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0
};

const POLL_INTERVAL_MS = 1500;

// ---------------------------------------------------------------------------
//  Tree node item
// ---------------------------------------------------------------------------

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  theme: 'light' | 'dark' | 'hc';
  colors: ReturnType<typeof colorsForTheme>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, target: TreeNode | null, parentPath: string) => void;
}

const TreeItem = memo(function TreeItem({
  node,
  depth,
  theme,
  colors,
  onToggle,
  onOpenFile,
  onContextMenu
}: TreeItemProps): JSX.Element {
  const [hovered, setHovered] = useState(false);
  const indent = 8 + depth * 16;

  const handleClick = (): void => {
    if (node.isDir) {
      onToggle(node.path);
    } else {
      onOpenFile(node.path);
    }
  };

  const isHC = theme === 'hc';
  const itemParentPath = parentPathOf(node.path);

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={node.isDir ? node.expanded : undefined}
        onClick={handleClick}
        onContextMenu={(event) => onContextMenu(event, node, itemParentPath)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: indent,
          paddingRight: 8,
          height: 22,
          cursor: 'default',
          userSelect: 'none',
          color: hovered && isHC ? colors.hoverText : colors.text,
          background: hovered ? colors.hover : 'transparent',
          fontSize: 12,
          fontFamily: 'Segoe UI, system-ui, sans-serif',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          boxSizing: 'border-box',
          outline: isHC && hovered ? '1px solid ButtonText' : 'none'
        }}
      >
        {node.isDir ? (
          <span aria-hidden style={{ ...ICON_STYLE, fontSize: 10, width: 12, color: colors.icon }}>
            {node.expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
          </span>
        ) : (
          <span style={{ display: 'inline-block', width: 12, flexShrink: 0 }} />
        )}
        <span aria-hidden style={{ ...ICON_STYLE, color: colors.icon }}>
          {node.isDir ? <FolderRegular /> : <DocumentRegular />}
        </span>
        <span
          style={{
            flex: '1 1 auto',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0
          }}
        >
          {node.name}
        </span>
      </div>
      {node.isDir &&
        node.expanded &&
        node.children &&
        node.children.length > 0 &&
        node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            theme={theme}
            colors={colors}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
          />
        ))}
      {node.isDir &&
        node.expanded &&
        node.loaded &&
        (!node.children || node.children.length === 0) && (
          <div
            onContextMenu={(event) => onContextMenu(event, null, node.path)}
            style={{
              paddingLeft: indent + 28,
              paddingRight: 8,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              fontSize: 11,
              fontFamily: 'Segoe UI, system-ui, sans-serif',
              color: colors.icon,
              fontStyle: 'italic',
              userSelect: 'none'
            }}
          >
            (empty)
          </div>
        )}
    </>
  );
});

// ---------------------------------------------------------------------------
//  FolderSidebar
// ---------------------------------------------------------------------------

function folderBasename(path: string): string {
  // Works on both / and \ separators (no Node path module — PA-8)
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function FolderSidebar({
  folderPath,
  theme,
  onOpenFile,
  onClose
}: FolderSidebarProps): JSX.Element {
  const { t } = useT();
  const colors = colorsForTheme(theme);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [closeHovered, setCloseHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<FolderContextMenuState | null>(null);

  // Root-level children (the folder's direct contents)
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [rootLoaded, setRootLoaded] = useState(false);

  // Load a directory's children via window.notepads.folder.list().
  // The backend already returns entries sorted dirs-first, alphabetically.
  const loadDir = useCallback(async (path: string): Promise<TreeNode[]> => {
    try {
      const res = await window.notepads.folder.list(path);
      if (!res.ok || !res.data) return [];
      return res.data.map((entry: FolderEntry) => ({
        name: entry.name,
        path: entry.path,
        isDir: entry.isDir,
        expanded: false,
        loaded: false,
        children: undefined
      }));
    } catch {
      return [];
    }
  }, []);

  const refreshDir = useCallback(
    async (path: string): Promise<void> => {
      const children = await loadDir(path);
      if (path === folderPath) {
        setRootNodes((prev) => mergeNodes(children, prev));
        setRootLoaded(true);
        return;
      }
      setRootNodes((prev) =>
        patchNode(prev, path, (node) => ({
          ...node,
          children: mergeNodes(children, node.children ?? []),
          loaded: true
        }))
      );
    },
    [folderPath, loadDir]
  );

  // Load root on mount / folderPath change
  useEffect(() => {
    setRootLoaded(false);
    setRootNodes([]);
    let cancelled = false;
    void loadDir(folderPath).then((nodes) => {
      if (!cancelled) {
        setRootNodes(nodes);
        setRootLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [folderPath, loadDir]);

  // Poll the visible tree so file-system changes made outside the app sync in.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshVisibleDirs(folderPath, rootNodes, refreshDir);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [folderPath, refreshDir, rootNodes]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (): void => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [contextMenu]);

  // Toggle a directory: expand -> load children; collapse -> keep children cached
  const handleToggle = useCallback(
    (targetPath: string): void => {
      const toggleInTree = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) => {
          if (n.path === targetPath && n.isDir) {
            const nowExpanded = !n.expanded;
            if (nowExpanded && !n.loaded) {
              // Kick off async load; update state when done
              void loadDir(targetPath).then((children) => {
                setRootNodes((prev) =>
                  patchNode(prev, targetPath, (node) => ({
                    ...node,
                    children,
                    loaded: true
                  }))
                );
              });
              return { ...n, expanded: true };
            }
            return { ...n, expanded: nowExpanded };
          }
          if (n.children) {
            const next = toggleInTree(n.children);
            if (next !== n.children) return { ...n, children: next };
          }
          return n;
        });

      setRootNodes((prev) => toggleInTree(prev));
    },
    [loadDir]
  );

  const openContextMenu = useCallback(
    (event: React.MouseEvent, target: TreeNode | null, parentPath: string): void => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ x: event.clientX, y: event.clientY, target, parentPath });
    },
    []
  );

  const runMenuAction = useCallback(
    async (action: FolderMenuAction): Promise<void> => {
      if (!contextMenu) return;
      const { target, parentPath } = contextMenu;
      setContextMenu(null);

      if (action === 'refresh') {
        await refreshDir(target?.isDir ? target.path : parentPath);
        return;
      }

      if (action === 'newFile' || action === 'newFolder') {
        const createParentPath = target?.isDir ? target.path : parentPath;
        const name = window.prompt(action === 'newFile' ? 'New file name' : 'New folder name');
        if (!name) return;
        const res =
          action === 'newFile'
            ? await window.notepads.folder.createFile(createParentPath, name)
            : await window.notepads.folder.createFolder(createParentPath, name);
        if (!res.ok) {
          window.alert(res.error);
          return;
        }
        await refreshDir(createParentPath);
        return;
      }

      if (!target) return;
      if (action === 'rename') {
        const name = window.prompt('Rename', target.name);
        if (!name || name === target.name) return;
        const res = await window.notepads.folder.rename(target.path, name);
        if (!res.ok) {
          window.alert(res.error);
          return;
        }
        await refreshDir(parentPath);
        return;
      }

      if (window.confirm(`Delete ${target.name}?`)) {
        const res = await window.notepads.folder.delete(target.path);
        if (!res.ok) {
          window.alert(res.error);
          return;
        }
        await refreshDir(parentPath);
      }
    },
    [contextMenu, refreshDir]
  );

  const isHC = theme === 'hc';

  return (
    <div
      data-testid="folder-sidebar"
      onContextMenu={(event) => openContextMenu(event, null, folderPath)}
      style={{
        width: 250,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: isHC ? 'Canvas' : 'transparent',
        borderRight: `1px solid ${colors.border}`,
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 12,
          paddingRight: 4,
          height: TabDimensions.height + TabDimensions.topBorderThickness,
          boxSizing: 'border-box',
          flexShrink: 0,
          background: headerHovered && !isHC ? colors.hover : 'transparent',
          borderBottom: `1px solid ${colors.border}`
        }}
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: 'Segoe UI, system-ui, sans-serif',
            color: colors.headerText,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            userSelect: 'none',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: '1 1 auto',
            minWidth: 0
          }}
          title={t('FolderSidebar_Title')}
        >
          {t('FolderSidebar_Title')}
        </span>
        <button
          type="button"
          data-testid="folder-sidebar-close"
          aria-label="Close folder"
          onClick={onClose}
          onMouseEnter={() => setCloseHovered(true)}
          onMouseLeave={() => setCloseHovered(false)}
          style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            border: 'none',
            background: closeHovered ? colors.hover : 'transparent',
            color: colors.icon,
            cursor: 'default',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 2,
            outline: isHC && closeHovered ? '1px solid ButtonText' : 'none'
          }}
        >
          <span aria-hidden style={{ ...ICON_STYLE, fontSize: 10 }}>
            <DismissRegular />
          </span>
        </button>
      </div>

      <div
        style={{
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 4,
          paddingBottom: 4,
          flexShrink: 0
        }}
      >
        <span
          title={folderPath}
          style={{
            fontSize: 11,
            fontFamily: 'Segoe UI, system-ui, sans-serif',
            fontWeight: 600,
            color: colors.text,
            userSelect: 'none',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '0.03em'
          }}
        >
          {folderBasename(folderPath).toUpperCase()}
        </span>
      </div>

      <div
        role="tree"
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          overflowX: 'hidden',
          minHeight: 0,
          paddingBottom: 8
        }}
      >
        {!rootLoaded ? (
          <div
            style={{
              padding: '8px 12px',
              fontSize: 12,
              fontFamily: 'Segoe UI, system-ui, sans-serif',
              color: colors.icon,
              fontStyle: 'italic'
            }}
          >
            Loading...
          </div>
        ) : rootNodes.length === 0 ? (
          <div
            onContextMenu={(event) => openContextMenu(event, null, folderPath)}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              fontFamily: 'Segoe UI, system-ui, sans-serif',
              color: colors.icon,
              fontStyle: 'italic'
            }}
          >
            (empty folder)
          </div>
        ) : (
          rootNodes.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              theme={theme}
              colors={colors}
              onToggle={handleToggle}
              onOpenFile={onOpenFile}
              onContextMenu={openContextMenu}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <FolderContextMenu
          state={contextMenu}
          colors={colors}
          onAction={(action) => void runMenuAction(action)}
        />
      )}
    </div>
  );
}

interface FolderContextMenuProps {
  state: FolderContextMenuState;
  colors: ReturnType<typeof colorsForTheme>;
  onAction: (action: FolderMenuAction) => void;
}

function FolderContextMenu({ state, colors, onAction }: FolderContextMenuProps): JSX.Element {
  const canRenameOrDelete = Boolean(state.target);
  return (
    <div
      role="menu"
      onClick={(event) => event.stopPropagation()}
      style={{
        position: 'fixed',
        left: state.x,
        top: state.y,
        zIndex: 1000,
        minWidth: 150,
        padding: 4,
        borderRadius: 6,
        background: colors.menu,
        boxShadow: colors.menuShadow,
        color: colors.text,
        fontSize: 12,
        fontFamily: 'Segoe UI, system-ui, sans-serif'
      }}
    >
      <MenuButton label="New File" onClick={() => onAction('newFile')} colors={colors} />
      <MenuButton label="New Folder" onClick={() => onAction('newFolder')} colors={colors} />
      <MenuSeparator colors={colors} />
      <MenuButton label="Rename" disabled={!canRenameOrDelete} onClick={() => onAction('rename')} colors={colors} />
      <MenuButton label="Delete" disabled={!canRenameOrDelete} onClick={() => onAction('delete')} colors={colors} />
      <MenuSeparator colors={colors} />
      <MenuButton label="Refresh" onClick={() => onAction('refresh')} colors={colors} />
    </div>
  );
}

interface MenuButtonProps {
  label: string;
  disabled?: boolean;
  colors: ReturnType<typeof colorsForTheme>;
  onClick: () => void;
}

function MenuButton({ label, disabled = false, colors, onClick }: MenuButtonProps): JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block',
        width: '100%',
        border: 'none',
        borderRadius: 4,
        padding: '6px 10px',
        textAlign: 'left',
        color: disabled ? colors.icon : colors.text,
        background: hovered && !disabled ? colors.hover : 'transparent',
        opacity: disabled ? 0.55 : 1,
        cursor: 'default',
        font: 'inherit'
      }}
    >
      {label}
    </button>
  );
}

function MenuSeparator({ colors }: { colors: ReturnType<typeof colorsForTheme> }): JSX.Element {
  return <div role="separator" style={{ height: 1, margin: '4px 6px', background: colors.border }} />;
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function parentPathOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index > 0 ? trimmed.slice(0, index) : trimmed;
}

async function refreshVisibleDirs(
  folderPath: string,
  nodes: TreeNode[],
  refreshDir: (path: string) => Promise<void>
): Promise<void> {
  await refreshDir(folderPath);
  const expandedDirs = collectExpandedDirs(nodes);
  for (const path of expandedDirs) {
    await refreshDir(path);
  }
}

function collectExpandedDirs(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.isDir && node.expanded) {
      paths.push(node.path);
      paths.push(...collectExpandedDirs(node.children ?? []));
    }
  }
  return paths;
}

function mergeNodes(next: TreeNode[], prev: TreeNode[]): TreeNode[] {
  const previousByPath = new Map(prev.map((node) => [node.path, node]));
  return next.map((node) => {
    const previous = previousByPath.get(node.path);
    if (!previous) return node;
    return {
      ...node,
      expanded: previous.expanded,
      loaded: previous.loaded,
      children: previous.children
    };
  });
}

/** Immutably patch a node at `targetPath` anywhere in the tree. */
function patchNode(nodes: TreeNode[], targetPath: string, patch: (node: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return patch(n);
    if (n.children) {
      const next = patchNode(n.children, targetPath, patch);
      if (next !== n.children) return { ...n, children: next };
    }
    return n;
  });
}
