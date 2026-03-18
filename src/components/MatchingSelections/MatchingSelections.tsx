import { createSignal, Index, Show, type Component } from 'solid-js';
import { useStore } from '../../store';
import styles from './MatchingSelections.module.css';
import LazyMatchItem from './LazyMatchItem';
import { type MatchGroup } from '../../utils/selections';
import type { Code, Codebook } from '../../models/files';

// Re-export functions and types that were extracted to utils for backward compatibility
export { findOverlapping, computeCollapsedRegions, buildMatchGroups, type MatchGroup, type CollapsedRegion, type BuildMatchGroupsResult } from '../../utils/selections';
export { flattenCodesWithPath as flattenCodes } from '../../utils/codeTree';

export interface MatchingSelectionsListProps {
  matchGroups: MatchGroup[];
  title?: string;
  expandedKeys?: Set<string>;
  onExpandedKeysChange?: (keys: Set<string>) => void;
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionUpdate?: (sourcePath: string, selectionGuid: string, start: number, end: number) => void;
  onSelectionClear?: () => void;
  selectedCode?: { code: Code; codebook: Codebook } | null;
}

export const MatchingSelectionsList: Component<MatchingSelectionsListProps> = (props) => {
  const { store } = useStore();
  const [localExpandedKeys, setLocalExpandedKeys] = createSignal<Set<string>>(new Set());

  const getGroupKey = (group: MatchGroup) => `${group.sourcePath}::${group.start}-${group.end}`;

  const getExpandedKeys = () => props.expandedKeys ?? localExpandedKeys();
  const setExpandedKeys = (next: Set<string>) => {
    props.onExpandedKeysChange ? props.onExpandedKeysChange(next) : setLocalExpandedKeys(next);
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
      <Show when={props.matchGroups.length > 0} fallback={
        <p class={styles.noMatches}>No matching selections found.</p>
      }>
        <div class={styles.matchingList}>
          <Index each={props.matchGroups}>
            {(group) => (
              <LazyMatchItem
                group={group()}
                isExpanded={isExpanded(group())}
                onToggleExpand={() => toggleExpanded(group())}
                onEnsureExpanded={() => ensureExpanded(group())}
                onOpenSource={props.onOpenSource}
                onSelectionCreate={props.onSelectionCreate}
                onSelectionUpdate={props.onSelectionUpdate}
                onSelectionClear={props.onSelectionClear}
                selectedCode={props.selectedCode}
              />
            )}
          </Index>
        </div>
      </Show>
    </div>
  );
};

export default MatchingSelectionsList;
