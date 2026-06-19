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
      icon: 'ButtonText'
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
      icon: '#BBBBBB'
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
    icon: '#555555'
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
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}

const TreeItem = memo(function TreeItem({
  node,
  depth,
  theme,
  colors,
  onToggle,
  onOpenFile
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

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={node.isDir ? node.expanded : undefined}
        onClick={handleClick}
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
        {/* Chevron for dirs, spacing for files */}
        {node.isDir ? (
          <span aria-hidden style={{ ...ICON_STYLE, fontSize: 10, width: 12, color: colors.icon }}>
            {node.expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
          </span>
        ) : (
          <span style={{ display: 'inline-block', width: 12, flexShrink: 0 }} />
        )}
        {/* Folder / file icon */}
        <span aria-hidden style={{ ...ICON_STYLE, color: colors.icon }}>
          {node.isDir ? <FolderRegular /> : <DocumentRegular />}
        </span>
        {/* Name */}
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
      {/* Render children if expanded */}
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
          />
        ))}
      {/* Empty dir indicator */}
      {node.isDir &&
        node.expanded &&
        node.loaded &&
        (!node.children || node.children.length === 0) && (
          <div
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
                setRootNodes((prev) => patchNode(prev, targetPath, { children, loaded: true }));
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

  const isHC = theme === 'hc';

  return (
    <div
      data-testid="folder-sidebar"
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
      {/* Header bar — height + bottom border align with the TabStrip's
          strip→editor seam on the right (32px tab body + 1px top border = 33px
          total). border-box keeps the 1px bottom border INSIDE the height so the
          divider line falls on exactly the same y-pixel as the editor's top edge. */}
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
        {/* Close button */}
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

      {/* Folder name sub-header */}
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

      {/* Tree */}
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
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** Immutably patch a node at `targetPath` anywhere in the tree. */
function patchNode(nodes: TreeNode[], targetPath: string, patch: Partial<TreeNode>): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return { ...n, ...patch };
    if (n.children) {
      const next = patchNode(n.children, targetPath, patch);
      if (next !== n.children) return { ...n, children: next };
    }
    return n;
  });
}
