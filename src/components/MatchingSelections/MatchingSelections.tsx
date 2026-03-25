import { createMemo, createSignal, Index, Show, Switch, Match, type Component } from 'solid-js';
import styles from './MatchingSelections.module.css';
import LazyMatchItem from './LazyMatchItem';
import FileMatchItem from './FileMatchItem';
import { type MatchGroup } from '../../utils/selections';
import type { AppliedCode, Code, Codebook } from '../../models/files';

type MergedItem =
  | { kind: 'file'; fileMatch: FileMatch }
  | { kind: 'selection'; group: MatchGroup };

// Re-export functions and types that were extracted to utils for backward compatibility
export { findOverlapping, computeCollapsedRegions, buildMatchGroups, type MatchGroup, type CollapsedRegion, type BuildMatchGroupsResult } from '../../utils/selections';
export { flattenCodesWithPath as flattenCodes } from '../../utils/codeTree';

export interface FileMatch {
  path: string;
  sourceCodes: AppliedCode[];
}

export interface MatchingSelectionsListProps {
  matchGroups: MatchGroup[];
  /** Files that matched via source codes (file-level codes). */
  fileMatches?: FileMatch[];
  title?: string;
  expandedKeys?: Set<string>;
  onExpandedKeysChange?: (keys: Set<string>) => void;
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionClear?: () => void;
  selectedCode?: { code: Code; codebook: Codebook } | null;
}

export const MatchingSelectionsList: Component<MatchingSelectionsListProps> = (props) => {
  const [localExpandedKeys, setLocalExpandedKeys] = createSignal<Set<string>>(new Set());

  const getGroupKey = (group: MatchGroup) => `${group.sourcePath}::${group.start}-${group.end}`;

  const getExpandedKeys = () => props.expandedKeys ?? localExpandedKeys();
  const setExpandedKeys = (next: Set<string>) => {
    if (props.onExpandedKeysChange) {
      props.onExpandedKeysChange(next);
    } else {
      setLocalExpandedKeys(next);
    }
  };

  const isExpanded = (group: MatchGroup) => getExpandedKeys().has(getGroupKey(group));

  const ensureExpanded = (group: MatchGroup) => {
    const key = getGroupKey(group);
    const current = getExpandedKeys();
    if (current.has(key)) return;
    const next = new Set(current);
    next.add(key);
    setExpandedKeys(next);
  };

  const toggleExpanded = (group: MatchGroup) => {
    const key = getGroupKey(group);
    const current = getExpandedKeys();
    const next = new Set(current);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setExpandedKeys(next);
  };

  const mergedItems = createMemo((): MergedItem[] => {
    const items: MergedItem[] = props.matchGroups.map(
      (group) => ({ kind: 'selection' as const, group }),
    );
    if (props.fileMatches) {
      for (const fm of props.fileMatches) {
        items.push({ kind: 'file' as const, fileMatch: fm });
      }
    }
    items.sort((a, b) => {
      const pathA = a.kind === 'file' ? a.fileMatch.path : a.group.sourcePath;
      const pathB = b.kind === 'file' ? b.fileMatch.path : b.group.sourcePath;
      const pathCmp = pathA.localeCompare(pathB);
      if (pathCmp !== 0) return pathCmp;
      // File-level matches sort before selection matches within the same file
      const startA = a.kind === 'file' ? -1 : a.group.start;
      const startB = b.kind === 'file' ? -1 : b.group.start;
      return startA - startB;
    });
    return items;
  });

  return (
    <div class={styles.matchingSelections}>
      <div class={styles.matchingHeader}>
        <h3>{props.title ?? `Matching Selections (${props.matchGroups.length})`}</h3>
        <div class={styles.matchingHeaderActions}>
          <button
            class={styles.expandBtnSmall}
            onClick={() => {
              const next = new Set(getExpandedKeys());
              for (const group of props.matchGroups) {
                next.add(getGroupKey(group));
              }
              setExpandedKeys(next);
            }}
          >
            Expand all
          </button>
          <button
            class={styles.expandBtnSmall}
            onClick={() => setExpandedKeys(new Set())}
          >
            Collapse all
          </button>
        </div>
      </div>
      <Show when={mergedItems().length > 0} fallback={
        <p class={styles.noMatches}>No matching selections found.</p>
      }>
        <div class={styles.matchingList}>
          <Index each={mergedItems()}>
            {(item) => (
              <Switch>
                <Match when={item().kind === 'file' ? item() as MergedItem & { kind: 'file' } : undefined}>
                  {(fileItem) => (
                    <FileMatchItem
                      sourcePath={fileItem().fileMatch.path}
                      sourceCodes={fileItem().fileMatch.sourceCodes}
                      onOpenSource={props.onOpenSource}
                    />
                  )}
                </Match>
                <Match when={item().kind === 'selection' ? item() as MergedItem & { kind: 'selection' } : undefined}>
                  {(selItem) => (
                    <LazyMatchItem
                      group={selItem().group}
                      isExpanded={isExpanded(selItem().group)}
                      onToggleExpand={() => toggleExpanded(selItem().group)}
                      onEnsureExpanded={() => ensureExpanded(selItem().group)}
                      onOpenSource={props.onOpenSource}
                      onSelectionCreate={props.onSelectionCreate}
                      onSelectionClear={props.onSelectionClear}
                      selectedCode={props.selectedCode}
                    />
                  )}
                </Match>
              </Switch>
            )}
          </Index>
        </div>
      </Show>
    </div>
  );
};

export default MatchingSelectionsList;
