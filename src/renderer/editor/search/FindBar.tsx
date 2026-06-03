import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Input,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItemCheckbox,
  Tooltip,
  type MenuProps,
} from '@fluentui/react-components';
import type { SearchOptions } from './searchEngine';
import { FindGlyph, FindDimensions, SEGOE_MDL2_FONT_FAMILY } from './findTokens';

/**
 * Find/Replace bar (RENDERER, Lane B) — 1:1 with the UWP FindAndReplaceControl.
 *
 * Owns the search query, replacement text, and option toggles. It is a CONTROLLED
 * presentational widget: it calls back to the host for every find/replace/goto
 * action and never touches CodeMirror directly (the host wires those callbacks to
 * findController.ts).
 *
 * Parity points reproduced from FindAndReplaceControl.xaml.cs:
 *   - whole-word & regex are MUTUALLY EXCLUSIVE (each disables the other while
 *     checked — OptionButtonFlyoutItem_OnClick).
 *   - in the FIND box: Enter = find-next, Shift+Enter = find-previous
 *     (FindBar_OnKeyDown); Tab moves to the replace box when visible.
 *   - in the REPLACE box: Enter = replace-one, Shift+Enter = replace-previous
 *     (ReplaceBar_OnKeyDown); Tab moves back to the find box.
 *   - the find box auto-selects its content on focus (FindBar_GotFocus).
 *   - Escape dismisses the bar (DismissButton).
 *
 * Replace-one / replace-all buttons are only enabled in replace mode with a
 * non-empty query (ShowReplaceBar + FindBar_OnTextChanged).
 */

export type FindDirection = 'next' | 'previous';

export interface FindBarProps {
  /** Whether the replace row is visible (Ctrl+H / Ctrl+Shift+F vs Ctrl+F). */
  showReplace: boolean;
  /** Seed query text (e.g. the editor's current selection on open). */
  initialQuery?: string;
  /** Find-next / find-previous. */
  onFind: (query: string, options: SearchOptions, direction: FindDirection) => void;
  /** Replace the current match then advance; direction mirrors UWP replace-prev. */
  onReplaceOne: (query: string, options: SearchOptions, replacement: string, direction: FindDirection) => void;
  /** Replace every occurrence (one undo step). */
  onReplaceAll: (query: string, options: SearchOptions, replacement: string) => void;
  /** Live query/options change (drives match highlighting + counting). */
  onQueryChange: (query: string, options: SearchOptions) => void;
  /** Toggle the replace row (the chevron button). */
  onToggleReplace: (show: boolean) => void;
  /** Dismiss the bar (Escape / close button). */
  onDismiss: () => void;
  /** Optional status text (e.g. "3 of 12" or "No results"). */
  status?: string;
}

/** A small Segoe MDL2 glyph rendered as an icon button face. */
function Glyph({ code, size }: { code: string; size: number }): JSX.Element {
  return (
    <span style={{ fontFamily: SEGOE_MDL2_FONT_FAMILY, fontSize: size, lineHeight: 1 }}>{code}</span>
  );
}

export function FindBar(props: FindBarProps): JSX.Element {
  const {
    showReplace,
    initialQuery = '',
    onFind,
    onReplaceOne,
    onReplaceAll,
    onQueryChange,
    onToggleReplace,
    onDismiss,
    status,
  } = props;

  const [query, setQuery] = useState<string>(initialQuery);
  const [replacement, setReplacement] = useState<string>('');
  const [matchCase, setMatchCase] = useState<boolean>(false);
  const [wholeWord, setWholeWord] = useState<boolean>(false);
  const [useRegex, setUseRegex] = useState<boolean>(false);

  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const options: SearchOptions = { matchCase, wholeWord, useRegex };
  const optionsActive = matchCase || wholeWord || useRegex;
  const hasQuery = query.length > 0;

  // Focus + select the find box content on mount / when re-seeded (FindBar_GotFocus).
  useEffect(() => {
    const el = findInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
    // Only on mount; subsequent re-seeds are driven by key prop from the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push query/option changes to the host for live highlighting.
  useEffect(() => {
    onQueryChange(query, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase, wholeWord, useRegex]);

  const setQueryText = useCallback((v: string) => setQuery(v), []);

  // Fluent v9 drives MenuItemCheckbox selection through the parent Menu's
  // `checkedValues` (Record<name, value[]>) + `onCheckedValueChange`; there is no
  // per-item `checked` prop. We model all three options under one `name` and
  // derive the booleans from the checked-values array. Mutual exclusivity for
  // whole-word/regex (OptionButtonFlyoutItem_OnClick) is enforced here: whichever
  // of the two was just turned on turns the other off.
  const checkedValues: Record<string, string[]> = {
    findOption: [
      ...(matchCase ? ['matchCase'] : []),
      ...(wholeWord ? ['wholeWord'] : []),
      ...(useRegex ? ['useRegex'] : []),
    ],
  };

  const onCheckedValueChange = useCallback<NonNullable<MenuProps['onCheckedValueChange']>>(
    (_e, data) => {
      if (data.name !== 'findOption') return;
      const next = new Set(data.checkedItems);
      const nextMatchCase = next.has('matchCase');
      let nextWholeWord = next.has('wholeWord');
      let nextUseRegex = next.has('useRegex');
      // Whole-word & regex are mutually exclusive: if BOTH ended up on, the one
      // that flipped on most recently (i.e. wasn't on before) wins.
      if (nextWholeWord && nextUseRegex) {
        if (!wholeWord) nextUseRegex = false; // whole-word just enabled → regex off
        else nextWholeWord = false; // regex just enabled → whole-word off
      }
      setMatchCase(nextMatchCase);
      setWholeWord(nextWholeWord);
      setUseRegex(nextUseRegex);
    },
    [wholeWord],
  );

  const doFind = useCallback(
    (direction: FindDirection) => {
      if (!hasQuery) return;
      onFind(query, options, direction);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasQuery, query, matchCase, wholeWord, useRegex, onFind],
  );

  const doReplaceOne = useCallback(
    (direction: FindDirection) => {
      if (!hasQuery) return;
      onReplaceOne(query, options, replacement, direction);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasQuery, query, replacement, matchCase, wholeWord, useRegex, onReplaceOne],
  );

  const doReplaceAll = useCallback(() => {
    if (!hasQuery) return;
    onReplaceAll(query, options, replacement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasQuery, query, replacement, matchCase, wholeWord, useRegex, onReplaceAll]);

  // FIND box key handling (FindBar_OnKeyDown).
  const onFindKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        doFind(e.shiftKey ? 'previous' : 'next');
        return;
      }
      if (e.key === 'Tab' && showReplace) {
        e.preventDefault();
        replaceInputRef.current?.focus();
      }
    },
    [doFind, onDismiss, showReplace],
  );

  // REPLACE box key handling (ReplaceBar_OnKeyDown).
  const onReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        // Shift+Enter = replace previous, Enter = replace next (UWP).
        doReplaceOne(e.shiftKey ? 'previous' : 'next');
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        findInputRef.current?.focus();
      }
    },
    [doReplaceOne, onDismiss],
  );

  const iconBtnStyle: React.CSSProperties = {
    minWidth: FindDimensions.buttonWidth,
    width: FindDimensions.buttonWidth,
    height: FindDimensions.rowHeight,
    padding: 0,
  };

  return (
    <div
      data-testid="find-bar"
      role="search"
      aria-label="Find and replace"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gridTemplateRows: showReplace ? 'auto auto' : 'auto',
        alignItems: 'center',
        gap: 2,
        padding: 2,
      }}
    >
      {/* Toggle-replace chevron (spans both rows when replace is shown). */}
      <Tooltip content={showReplace ? 'Hide replace' : 'Show replace'} relationship="label">
        <Button
          appearance="subtle"
          aria-label={showReplace ? 'Hide replace' : 'Show replace'}
          data-testid="find-toggle-replace"
          onClick={() => onToggleReplace(!showReplace)}
          style={{
            minWidth: FindDimensions.toggleWidth,
            width: FindDimensions.toggleWidth,
            height: FindDimensions.rowHeight,
            padding: 0,
            gridRow: showReplace ? '1 / span 2' : '1',
          }}
          icon={
            <Glyph
              code={showReplace ? FindGlyph.toggleReplaceCollapse : FindGlyph.toggleReplaceExpand}
              size={FindDimensions.toggleGlyphFontSize}
            />
          }
        />
      </Tooltip>

      {/* Find input + options gear. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Input
          input={{ ref: findInputRef }}
          data-testid="find-input"
          aria-label="Find"
          placeholder="Find"
          value={query}
          onChange={(_, d) => setQueryText(d.value)}
          onKeyDown={onFindKeyDown}
          style={{ flex: '1 1 auto', fontSize: FindDimensions.textFontSize }}
        />
        <Menu checkedValues={checkedValues} onCheckedValueChange={onCheckedValueChange}>
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content="Search options" relationship="label">
              <Button
                appearance={optionsActive ? 'primary' : 'subtle'}
                aria-label="Search options"
                data-testid="find-options"
                style={iconBtnStyle}
                icon={<Glyph code={FindGlyph.options} size={FindDimensions.glyphFontSize} />}
              />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItemCheckbox
                name="findOption"
                value="matchCase"
                data-testid="find-opt-match-case"
              >
                Match case
              </MenuItemCheckbox>
              <MenuItemCheckbox
                name="findOption"
                value="wholeWord"
                disabled={useRegex}
                data-testid="find-opt-whole-word"
              >
                Match whole word
              </MenuItemCheckbox>
              <MenuItemCheckbox
                name="findOption"
                value="useRegex"
                disabled={wholeWord}
                data-testid="find-opt-use-regex"
              >
                Use regular expressions
              </MenuItemCheckbox>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>

      {/* Find action buttons (prev / next / dismiss). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {status !== undefined && (
          <span data-testid="find-status" style={{ fontSize: 12, opacity: 0.75, marginRight: 4, whiteSpace: 'nowrap' }}>
            {status}
          </span>
        )}
        <Tooltip content="Find previous (Shift+F3)" relationship="label">
          <Button
            appearance="subtle"
            aria-label="Find previous"
            data-testid="find-prev"
            disabled={!hasQuery}
            onClick={() => doFind('previous')}
            style={iconBtnStyle}
            icon={<Glyph code={FindGlyph.searchBackward} size={FindDimensions.glyphFontSize} />}
          />
        </Tooltip>
        <Tooltip content="Find next (F3)" relationship="label">
          <Button
            appearance="subtle"
            aria-label="Find next"
            data-testid="find-next"
            disabled={!hasQuery}
            onClick={() => doFind('next')}
            style={iconBtnStyle}
            icon={<Glyph code={FindGlyph.searchForward} size={FindDimensions.glyphFontSize} />}
          />
        </Tooltip>
        <Tooltip content="Close (Esc)" relationship="label">
          <Button
            appearance="subtle"
            aria-label="Close find bar"
            data-testid="find-dismiss"
            onClick={onDismiss}
            style={iconBtnStyle}
            icon={<Glyph code={FindGlyph.dismiss} size={FindDimensions.glyphFontSize} />}
          />
        </Tooltip>
      </div>

      {/* Replace row (second grid row), only when replace mode is on. */}
      {showReplace && (
        <>
          <Input
            input={{ ref: replaceInputRef }}
            data-testid="replace-input"
            aria-label="Replace with"
            placeholder="Replace"
            value={replacement}
            onChange={(_, d) => setReplacement(d.value)}
            onKeyDown={onReplaceKeyDown}
            style={{ gridColumn: '2', fontSize: FindDimensions.textFontSize }}
          />
          <div style={{ gridColumn: '3', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Tooltip content="Replace (Enter)" relationship="label">
              <Button
                appearance="subtle"
                aria-label="Replace"
                data-testid="replace-one"
                disabled={!hasQuery}
                onClick={() => doReplaceOne('next')}
                style={iconBtnStyle}
                icon={<Glyph code={FindGlyph.replace} size={FindDimensions.glyphFontSize} />}
              />
            </Tooltip>
            <Tooltip content="Replace all (Ctrl+Alt+Enter)" relationship="label">
              <Button
                appearance="subtle"
                aria-label="Replace all"
                data-testid="replace-all"
                disabled={!hasQuery}
                onClick={doReplaceAll}
                style={iconBtnStyle}
                icon={<Glyph code={FindGlyph.replaceAll} size={FindDimensions.glyphFontSize} />}
              />
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}
