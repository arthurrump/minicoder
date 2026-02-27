import { createSignal, createMemo, For, Index, Show, onMount, onCleanup, type Component } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore, type FileContent } from '../store';
import styles from './MatchingSelections.module.css';
import ColorChip from './ColorChip';
import TextView from './TextView';

/**
 * Given selections sorted by start, find all that overlap the interval [start, end).
 * Uses binary search on `start` to find the upper bound, then scans checking end.
 */
export function findOverlapping(
  sorted: TextSelection[],
  start: number,
  end: number,
): TextSelection[] {
  // Binary search: find first selection whose start >= end
  // (all selections from this point onward can't overlap)
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].start < end) lo = mid + 1;
    else hi = mid;
  }
  const upperBound = lo;
  const result: TextSelection[] = [];
  for (let i = 0; i < upperBound; i++) {
    if (sorted[i].end > start) result.push(sorted[i]);
  }
  return result;
}

// Flatten all codes from all codebooks for the picker
export function flattenCodes(codebooks: Codebook[]): { code: Code; codebook: Codebook; path: string[] }[] {
  const results: { code: Code; codebook: Codebook; path: string[] }[] = [];
  
  function traverse(codes: Code[], codebook: Codebook, path: string[]) {
    for (const code of codes) {
      results.push({ code, codebook, path: [...path, code.name] });
      if (code.subcodes) {
        traverse(code.subcodes, codebook, [...path, code.name]);
      }
    }
  }
  
  for (const codebook of codebooks) {
    traverse(codebook.codes, codebook, [codebook.name]);
  }
  
  return results;
}

// A match group represents a contiguous region of text that matches the query
export interface MatchGroup {
  sourcePath: string;
  start: number;
  end: number;
  content: string;
  selections: TextSelection[]; // All selections that overlap with this region (with adjusted offsets)
}

export interface MatchItemProps {
  group: MatchGroup;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEnsureExpanded: () => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionRemove?: (sourcePath: string, selectionGuid: string) => void;
  onSelectionUpdate?: (sourcePath: string, selectionGuid: string, start: number, end: number, note?: string) => void;
  onToggleExample?: (sourcePath: string, selectionGuid: string) => void;
  onChangeCode?: (sourcePath: string, selectionGuid: string, newCode: CodeReference) => void;
  onSelectionClear?: () => void;
  selectedCode?: { code: Code; codebook: Codebook } | null;
}

export const MatchItem: Component<MatchItemProps> = (props) => {
  let contentRef: HTMLDivElement | undefined;
  const [needsExpand, setNeedsExpand] = createSignal(false);
  const { indices } = useStore();
  
  // Build code map for this group
  const codeMap = createMemo(() => {
    const map = new Map<string, { code: Code; codebook: Codebook }>();
    const idx = indices.codeByGuid();
    for (const sel of props.group.selections) {
      if (!map.has(sel.code.codeGuid)) {
        const info = idx[sel.code.codeGuid];
        if (info) map.set(sel.code.codeGuid, info);
      }
    }
    return map;
  });
  
  // Get unique codes for the header display
  const uniqueCodes = createMemo(() => {
    return Array.from(codeMap().values());
  });
  
  onMount(() => {
    if (!contentRef) return;
    
    const observer = new ResizeObserver(() => {
      if (contentRef) {
        setNeedsExpand(contentRef.scrollHeight > 200);
      }
    });
    
    observer.observe(contentRef);
    
    return () => observer.disconnect();
  });
  
  return (
    <div class={styles.matchItem}>
      <div class={styles.matchHeader}>
        <span class={styles.matchSource}>{props.group.sourcePath}</span>
        <div class={styles.matchCodes}>
          <For each={uniqueCodes()}>
            {(info) => (
              <span class={styles.matchCodeTag}>
                <ColorChip color={info.code.color} class={styles.codeChip} />
                <span>{info.code.name}</span>
              </span>
            )}
          </For>
        </div>
      </div>
      <div 
        class={`${styles.matchContent} ${!props.isExpanded && needsExpand() ? styles.matchContentCollapsed : ''}`}
        ref={contentRef}
      >
        <TextView
          content={props.group.content}
          selections={props.group.selections}
          onSelectionCreate={(start, end) => {
            props.onEnsureExpanded();
            props.onSelectionCreate?.(props.group.sourcePath, props.group.start + start, props.group.start + end);
          }}
          onSelectionRemove={(selectionGuid) =>
            props.onSelectionRemove?.(props.group.sourcePath, selectionGuid)
          }
          onSelectionUpdate={(selectionGuid, start, end, note) =>
            props.onSelectionUpdate?.(props.group.sourcePath, selectionGuid, props.group.start + start, props.group.start + end, note)
          }
          onToggleExample={(selectionGuid) =>
            props.onToggleExample?.(props.group.sourcePath, selectionGuid)
          }
          onChangeCode={(selectionGuid, newCode) =>
            props.onChangeCode?.(props.group.sourcePath, selectionGuid, newCode)
          }
          onSelectionClear={props.onSelectionClear}
          selectedCode={props.selectedCode}
        />
      </div>
      <Show when={needsExpand()}>
        <button class={styles.expandBtn} onClick={props.onToggleExpand}>
          {props.isExpanded ? 'Show less' : 'Show more'}
        </button>
      </Show>
    </div>
  );
};

/**
 * Lazy wrapper around MatchItem that only mounts the full component
 * when it's near the viewport. Off-screen items render as lightweight
 * placeholders, so expand/collapse and other state changes only
 * trigger re-renders for visible items.
 */
const LazyMatchItem: Component<MatchItemProps> = (props) => {
  let wrapperRef: HTMLDivElement | undefined;
  const [isNearViewport, setIsNearViewport] = createSignal(false);
  const [lastHeight, setLastHeight] = createSignal(80);

  onMount(() => {
    if (!wrapperRef) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsNearViewport(true);
        } else {
          // Capture height before unmounting so the placeholder keeps the same size
          if (wrapperRef) {
            const h = wrapperRef.getBoundingClientRect().height;
            if (h > 0) setLastHeight(h);
          }
          setIsNearViewport(false);
        }
      },
      { rootMargin: '600px 0px' },
    );

    observer.observe(wrapperRef);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={wrapperRef}>
      <Show
        when={isNearViewport()}
        fallback={
          <div
            class={styles.matchItemPlaceholder}
            style={{ height: `${lastHeight()}px` }}
          />
        }
      >
        <MatchItem
          group={props.group}
          isExpanded={props.isExpanded}
          onToggleExpand={props.onToggleExpand}
          onEnsureExpanded={props.onEnsureExpanded}
          onSelectionCreate={props.onSelectionCreate}
          onSelectionRemove={props.onSelectionRemove}
          onSelectionUpdate={props.onSelectionUpdate}
          onToggleExample={props.onToggleExample}
          onChangeCode={props.onChangeCode}
          onSelectionClear={props.onSelectionClear}
          selectedCode={props.selectedCode}
        />
      </Show>
    </div>
  );
};

export interface MatchingSelectionsListProps {
  matchGroups: MatchGroup[];
  title?: string;
  expandedKeys?: Set<string>;
  onExpandedKeysChange?: (keys: Set<string>) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionRemove?: (sourcePath: string, selectionGuid: string) => void;
  onSelectionUpdate?: (sourcePath: string, selectionGuid: string, start: number, end: number, note?: string) => void;
  onToggleExample?: (sourcePath: string, selectionGuid: string) => void;
  onChangeCode?: (sourcePath: string, selectionGuid: string, newCode: CodeReference) => void;
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
                onSelectionCreate={props.onSelectionCreate}
                onSelectionRemove={props.onSelectionRemove}
                onSelectionUpdate={props.onSelectionUpdate}
                onToggleExample={props.onToggleExample}
                onChangeCode={props.onChangeCode}
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

/**
 * Build match groups for selections that match the given code GUIDs.
 * Returns grouped, overlapping selections with content slices.
 */
export function buildMatchGroups(
  codeGuids: Set<string>,
  sources: Record<string, Source>,
  fileContents: Record<string, FileContent>,
): MatchGroup[] {
  const groups: MatchGroup[] = [];

  for (const [sourcePath, source] of Object.entries(sources)) {
    const fc = fileContents[sourcePath];
    const content = fc?.type === 'plain-text' ? fc.content : '';
    if (!content) continue;

    // Selections are kept sorted by start position in the store
    const allSorted = source.selections;

    // Find all selections matching any of the target code GUIDs
    const matchingSelections = allSorted.filter(s => codeGuids.has(s.code.codeGuid));
    if (matchingSelections.length === 0) continue;

    // Group overlapping matched selections (already sorted)
    const mergedGroups: { start: number; end: number; selections: TextSelection[] }[] = [];

    for (const sel of matchingSelections) {
      const lastGroup = mergedGroups[mergedGroups.length - 1];
      if (lastGroup && sel.start <= lastGroup.end) {
        lastGroup.end = Math.max(lastGroup.end, sel.end);
        lastGroup.selections.push(sel);
      } else {
        mergedGroups.push({ start: sel.start, end: sel.end, selections: [sel] });
      }
    }

    // Convert to MatchGroup with content and adjusted offsets
    for (const group of mergedGroups) {
      // Include all selections that overlap with this region (not just matching ones)
      const groupSelections = findOverlapping(allSorted, group.start, group.end);
      groups.push({
        sourcePath,
        start: group.start,
        end: group.end,
        content: content.slice(group.start, group.end),
        selections: groupSelections.map(s => ({
          ...s,
          start: s.start - group.start,
          end: s.end - group.start,
        })),
      });
    }
  }

  // Sort by filepath, then by start index
  groups.sort((a, b) => {
    const pathCompare = a.sourcePath.localeCompare(b.sourcePath);
    if (pathCompare !== 0) return pathCompare;
    return a.start - b.start;
  });

  return groups;
}
