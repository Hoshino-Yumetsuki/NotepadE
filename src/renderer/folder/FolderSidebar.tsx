import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useT } from '../i18n';
import { getFolderBasename } from '../integrations/pathUtils';
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
  depth: number;
}

interface NameActionState {
  kind: 'newFile' | 'newFolder' | 'rename';
  parentPath: string;
  target: TreeNode | null;
  value: string;
  depth: number;
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
      menuShadow: '0 0 0 1px ButtonText',
      input: 'Canvas'
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
      menuShadow: '0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.12)',
      input: 'rgba(255,255,255,0.06)'
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
    menuShadow: '0 8px 24px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.10)',
    input: 'rgba(0,0,0,0.04)'
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

// ---------------------------------------------------------------------------
//  Tree node item
// ---------------------------------------------------------------------------

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  theme: 'light' | 'dark' | 'hc';
  colors: ReturnType<typeof colorsForTheme>;
  t: ReturnType<typeof useT>['t'];
  nameAction: NameActionState | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (
    event: React.MouseEvent,
    target: TreeNode | null,
    parentPath: string,
    depth: number
  ) => void;
  onNameChange: (value: string) => void;
  onNameCancel: () => void;
  onNameSubmit: () => void;
}

const TreeItem = memo(function TreeItem({
  node,
  depth,
  theme,
  colors,
  t,
  nameAction,
  onToggle,
  onOpenFile,
  onContextMenu,
  onNameChange,
  onNameCancel,
  onNameSubmit
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
  const isRenaming = nameAction?.kind === 'rename' && nameAction.target?.path === node.path;

  return (
    <>
      {isRenaming ? (
        <InlineNameInput
          colors={colors}
          depth={depth}
          isDir={node.isDir}
          value={nameAction.value}
          onChange={onNameChange}
          onCancel={onNameCancel}
          onSubmit={onNameSubmit}
        />
      ) : (
        <div
          role="treeitem"
          aria-expanded={node.isDir ? node.expanded : undefined}
          onClick={handleClick}
          onContextMenu={(event) => onContextMenu(event, node, itemParentPath, depth)}
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
            <span
              aria-hidden
              style={{ ...ICON_STYLE, fontSize: 10, width: 12, color: colors.icon }}
            >
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
      )}
      {node.isDir &&
        node.expanded &&
        nameAction &&
        nameAction.kind !== 'rename' &&
        nameAction.parentPath === node.path && (
          <InlineNameInput
            colors={colors}
            depth={depth + 1}
            isDir={nameAction.kind === 'newFolder'}
            value={nameAction.value}
            onChange={onNameChange}
            onCancel={onNameCancel}
            onSubmit={onNameSubmit}
          />
        )}
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
            t={t}
            nameAction={nameAction}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
            onNameChange={onNameChange}
            onNameCancel={onNameCancel}
            onNameSubmit={onNameSubmit}
          />
        ))}
      {node.isDir &&
        node.expanded &&
        node.loaded &&
        (!node.children || node.children.length === 0) &&
        !(nameAction && nameAction.kind !== 'rename' && nameAction.parentPath === node.path) && (
          <div
            onContextMenu={(event) => onContextMenu(event, null, node.path, depth + 1)}
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
            {t('FolderSidebar_Empty')}
          </div>
        )}
    </>
  );
});

// ---------------------------------------------------------------------------
//  FolderSidebar
// ---------------------------------------------------------------------------

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
  const [nameAction, setNameAction] = useState<NameActionState | null>(null);

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

  // Start filesystem watcher; refresh affected dirs on change events.
  const refreshDirRef = useRef(refreshDir);
  refreshDirRef.current = refreshDir;
  useEffect(() => {
    void window.notepads.folder.startWatch(folderPath);
    const unsub = window.notepads.folder.onFolderChanged((changedParent: string) => {
      void refreshDirRef.current(changedParent);
    });
    return () => {
      unsub();
      void window.notepads.folder.stopWatch(folderPath);
    };
  }, [folderPath]);

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
    (event: React.MouseEvent, target: TreeNode | null, parentPath: string, depth: number): void => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ x: event.clientX, y: event.clientY, target, parentPath, depth });
    },
    []
  );

  const runMenuAction = useCallback(
    (action: FolderMenuAction): void => {
      if (!contextMenu) return;
      const { target, parentPath, depth } = contextMenu;
      setContextMenu(null);

      if (action === 'refresh') {
        const refreshTarget = target?.isDir ? target.path : parentPath;
        void refreshDir(refreshTarget);
        return;
      }

      if (action === 'newFile' || action === 'newFolder') {
        const createParentPath = target?.isDir ? target.path : parentPath;
        if (target?.isDir) {
          setRootNodes((prev) =>
            patchNode(prev, target.path, (node) => ({
              ...node,
              expanded: true
            }))
          );
          if (!target.loaded) {
            void loadDir(target.path).then((children) => {
              setRootNodes((prev) =>
                patchNode(prev, target.path, (node) => ({
                  ...node,
                  children,
                  expanded: true,
                  loaded: true
                }))
              );
            });
          }
        }
        setNameAction({
          kind: action,
          parentPath: createParentPath,
          target: null,
          value: '',
          depth: target?.isDir ? depth + 1 : depth
        });
        return;
      }

      if (!target) return;
      if (action === 'rename') {
        setNameAction({
          kind: 'rename',
          parentPath,
          target,
          value: target.name,
          depth
        });
        return;
      }

      if (window.confirm(t('FolderSidebar_DeleteConfirm', target.name))) {
        void window.notepads.folder.delete(target.path).then(async (res) => {
          if (!res.ok) {
            window.alert(res.error);
            return;
          }
          await refreshDir(parentPath);
        });
      }
    },
    [contextMenu, loadDir, refreshDir, t]
  );

  const submitNameAction = useCallback(async (): Promise<void> => {
    if (!nameAction) return;
    const name = nameAction.value.trim();
    if (!name) return;

    const res =
      nameAction.kind === 'newFile'
        ? await window.notepads.folder.createFile(nameAction.parentPath, name)
        : nameAction.kind === 'newFolder'
          ? await window.notepads.folder.createFolder(nameAction.parentPath, name)
          : nameAction.target
            ? await window.notepads.folder.rename(nameAction.target.path, name)
            : { ok: false as const, error: 'No item selected' };

    if (!res.ok) {
      window.alert(res.error);
      return;
    }
    const refreshPath =
      nameAction.kind === 'rename' ? parentPathOf(res.data) : nameAction.parentPath;
    setNameAction(null);
    await refreshDir(refreshPath);
  }, [nameAction, refreshDir]);

  const isHC = theme === 'hc';

  return (
    <div
      data-testid="folder-sidebar"
      onContextMenu={(event) => openContextMenu(event, null, folderPath, 0)}
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
          aria-label={t('FolderSidebar_Close')}
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
          {getFolderBasename(folderPath).toUpperCase()}
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
            {t('FolderSidebar_Loading')}
          </div>
        ) : rootNodes.length === 0 ? (
          <>
            {nameAction && nameAction.kind !== 'rename' && nameAction.parentPath === folderPath && (
              <InlineNameInput
                colors={colors}
                depth={nameAction.depth}
                isDir={nameAction.kind === 'newFolder'}
                value={nameAction.value}
                onChange={(value) => setNameAction((prev) => (prev ? { ...prev, value } : prev))}
                onCancel={() => setNameAction(null)}
                onSubmit={() => void submitNameAction()}
              />
            )}
            {!(
              nameAction &&
              nameAction.kind !== 'rename' &&
              nameAction.parentPath === folderPath
            ) && (
              <div
                onContextMenu={(event) => openContextMenu(event, null, folderPath, 0)}
                style={{
                  padding: '8px 12px',
                  fontSize: 12,
                  fontFamily: 'Segoe UI, system-ui, sans-serif',
                  color: colors.icon,
                  fontStyle: 'italic'
                }}
              >
                {t('FolderSidebar_EmptyFolder')}
              </div>
            )}
          </>
        ) : (
          <>
            {nameAction && nameAction.kind !== 'rename' && nameAction.parentPath === folderPath && (
              <InlineNameInput
                colors={colors}
                depth={nameAction.depth}
                isDir={nameAction.kind === 'newFolder'}
                value={nameAction.value}
                onChange={(value) => setNameAction((prev) => (prev ? { ...prev, value } : prev))}
                onCancel={() => setNameAction(null)}
                onSubmit={() => void submitNameAction()}
              />
            )}
            {rootNodes.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                theme={theme}
                colors={colors}
                t={t}
                nameAction={nameAction}
                onToggle={handleToggle}
                onOpenFile={onOpenFile}
                onContextMenu={openContextMenu}
                onNameChange={(value) =>
                  setNameAction((prev) => (prev ? { ...prev, value } : prev))
                }
                onNameCancel={() => setNameAction(null)}
                onNameSubmit={() => void submitNameAction()}
              />
            ))}
          </>
        )}
      </div>

      {contextMenu && (
        <FolderContextMenu state={contextMenu} colors={colors} t={t} onAction={runMenuAction} />
      )}
    </div>
  );
}

interface FolderContextMenuProps {
  state: FolderContextMenuState;
  colors: ReturnType<typeof colorsForTheme>;
  t: ReturnType<typeof useT>['t'];
  onAction: (action: FolderMenuAction) => void;
}

function FolderContextMenu({ state, colors, t, onAction }: FolderContextMenuProps): JSX.Element {
  const canRenameOrDelete = Boolean(state.target);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = state.x;
    let top = state.y;

    if (left + rect.width > vw) left = vw - rect.width - 8;
    if (top + rect.height > vh) top = vh - rect.height - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    setPosition({ left, top });
  }, [state.x, state.y]);

  return (
    <div
      ref={menuRef}
      role="menu"
      onClick={(event) => event.stopPropagation()}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
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
      <MenuButton
        label={t('FolderSidebar_NewFile')}
        onClick={() => onAction('newFile')}
        colors={colors}
      />
      <MenuButton
        label={t('FolderSidebar_NewFolder')}
        onClick={() => onAction('newFolder')}
        colors={colors}
      />
      <MenuSeparator colors={colors} />
      <MenuButton
        label={t('FolderSidebar_Rename')}
        disabled={!canRenameOrDelete}
        onClick={() => onAction('rename')}
        colors={colors}
      />
      <MenuButton
        label={t('FolderSidebar_Delete')}
        disabled={!canRenameOrDelete}
        onClick={() => onAction('delete')}
        colors={colors}
      />
      <MenuSeparator colors={colors} />
      <MenuButton
        label={t('FolderSidebar_Refresh')}
        onClick={() => onAction('refresh')}
        colors={colors}
      />
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
  return (
    <div role="separator" style={{ height: 1, margin: '4px 6px', background: colors.border }} />
  );
}

interface InlineNameInputProps {
  colors: ReturnType<typeof colorsForTheme>;
  depth: number;
  isDir: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function InlineNameInput({
  colors,
  depth,
  isDir,
  value,
  onChange,
  onCancel,
  onSubmit
}: InlineNameInputProps): JSX.Element {
  const indent = 8 + depth * 16;
  return (
    <div
      role="treeitem"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        paddingLeft: indent,
        paddingRight: 8,
        height: 22,
        color: colors.text,
        fontSize: 12,
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        boxSizing: 'border-box'
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {isDir ? (
        <span aria-hidden style={{ ...ICON_STYLE, fontSize: 10, width: 12, color: colors.icon }}>
          <ChevronRightRegular />
        </span>
      ) : (
        <span style={{ display: 'inline-block', width: 12, flexShrink: 0 }} />
      )}
      <span aria-hidden style={{ ...ICON_STYLE, color: colors.icon }}>
        {isDir ? <FolderRegular /> : <DocumentRegular />}
      </span>
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit();
          if (event.key === 'Escape') onCancel();
        }}
        onBlur={() => {
          if (value.trim()) {
            onSubmit();
          } else {
            onCancel();
          }
        }}
        onFocus={(event) => event.currentTarget.select()}
        style={{
          minWidth: 0,
          flex: '1 1 auto',
          height: 18,
          boxSizing: 'border-box',
          border: `1px solid ${colors.border}`,
          borderRadius: 2,
          padding: '1px 4px',
          background: colors.input,
          color: colors.text,
          font: 'inherit',
          outline: 'none'
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function parentPathOf(path: string): string {
  const trimmed = path.replaceAll('\\', '/').replace(/[/]+$/, '');
  const index = trimmed.lastIndexOf('/');
  return index > 0 ? trimmed.slice(0, index) : trimmed;
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
function patchNode(
  nodes: TreeNode[],
  targetPath: string,
  patch: (node: TreeNode) => TreeNode
): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return patch(n);
    if (n.children) {
      const next = patchNode(n.children, targetPath, patch);
      if (next !== n.children) return { ...n, children: next };
    }
    return n;
  });
}
