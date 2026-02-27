import { createSignal, createMemo, For, Index, Show, onMount, onCleanup, type Component } from 'solid-js';
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
  matchingGuids?: Set<string>; // GUIDs of selections that directly match the query (vs overlapping context)
}

/** A sub-region of a MatchGroup shown in the collapsed view. */
export interface CollapsedRegion {
  /** Text content for this sub-region */
  content: string;
  /** Selections with offsets relative to this sub-region's content */
  selections: TextSelection[];
  /** Offset of this sub-region within the parent MatchGroup's content */
  offsetInGroup: number;
  /** GUIDs of selections that were clipped to fit this sub-region */
  clippedGuids: Set<string>;
}

/**
 * Compute the collapsed sub-regions for a MatchGroup.
 * Each sub-region covers one or more matching selections extended to line boundaries,
 * with gaps between non-adjacent matches omitted (shown as ellipsis separators).
 * If no matchingGuids are set, returns a single region covering the whole group.
 */
export function computeCollapsedRegions(group: MatchGroup): CollapsedRegion[] {
  const matchingGuids = group.matchingGuids;
  if (!matchingGuids || matchingGuids.size === 0) {
    // No matching info — treat entire group as one region
    return [{ content: group.content, selections: group.selections, offsetInGroup: 0, clippedGuids: new Set() }];
  }

  // Find the matching selections (offsets are relative to group content)
  const matchingSels = group.selections.filter(s => matchingGuids.has(s.guid));
  if (matchingSels.length === 0) {
    return [{ content: group.content, selections: group.selections, offsetInGroup: 0, clippedGuids: new Set() }];
  }

  // Merge matching selections into contiguous ranges
  const sorted = [...matchingSels].sort((a, b) => a.start - b.start);
  const ranges: { start: number; end: number }[] = [];
  for (const sel of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && sel.start <= last.end) {
      last.end = Math.max(last.end, sel.end);
    } else {
      ranges.push({ start: sel.start, end: sel.end });
    }
  }

  // Extend each range to line boundaries within group.content
  const content = group.content;
  for (const range of ranges) {
    // Extend start to the character after the previous newline (or 0)
    let lineStart = range.start;
    while (lineStart > 0 && content[lineStart - 1] !== '\n') lineStart--;
    range.start = lineStart;

    // Extend end to the next newline (or content length)
    let lineEnd = range.end;
    while (lineEnd < content.length && content[lineEnd] !== '\n') lineEnd++;
    range.end = lineEnd;
  }

  // Merge ranges that became adjacent or overlapping after line extension
  const merged: { start: number; end: number }[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1];
    if (ranges[i].start <= prev.end) {
      prev.end = Math.max(prev.end, ranges[i].end);
    } else {
      merged.push(ranges[i]);
    }
  }

  // Build CollapsedRegion for each merged range
  return merged.map(range => {
    const subContent = content.slice(range.start, range.end);
    // Collect all selections (matching and non-matching) overlapping this sub-range
    const clippedGuids = new Set<string>();
    const subSelections = group.selections
      .filter(s => s.end > range.start && s.start < range.end)
      .map(s => {
        const clampedStart = Math.max(0, s.start - range.start);
        const clampedEnd = Math.min(subContent.length, s.end - range.start);
        // Track if this selection was clipped (its range extends beyond the sub-region)
        if (s.start < range.start || s.end > range.end) {
          clippedGuids.add(s.guid);
        }
        return { ...s, start: clampedStart, end: clampedEnd };
      });
    return { content: subContent, selections: subSelections, offsetInGroup: range.start, clippedGuids };
  });
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
  const { indices } = useStore();

  // Compute collapsed sub-regions
  const collapsedRegions = createMemo(() => computeCollapsedRegions(props.group));

  // Whether there are gaps between collapsed regions (non-matching text is hidden)
  const hasGaps = createMemo(() => {
    const regions = collapsedRegions();
    if (regions.length > 1) return true;
    if (regions.length === 1) {
      const r = regions[0];
      return r.offsetInGroup > 0 || r.content.length < props.group.content.length;
    }
    return false;
  });

  // In expanded view, selections that define the outer bounds of the group
  // (start === 0 or end === content.length) should not be resizable since
  // the group range was derived from their extent.
  const boundaryGuids = createMemo(() => {
    const guids = new Set<string>();
    const contentLen = props.group.content.length;
    for (const sel of props.group.selections) {
      if (sel.start <= 0 || sel.end >= contentLen) {
        guids.add(sel.guid);
      }
    }
    return guids;
  });
  
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

  const renderTextView = (content: string, selections: TextSelection[], baseOffset: number, nonResizableGuids?: Set<string>) => {
    return (
      <TextView
        content={content}
        selections={selections}
        nonResizableGuids={nonResizableGuids}
        onSelectionCreate={(start, end) => {
          props.onEnsureExpanded();
          props.onSelectionCreate?.(props.group.sourcePath, props.group.start + baseOffset + start, props.group.start + baseOffset + end);
        }}
        onSelectionRemove={(selectionGuid) =>
          props.onSelectionRemove?.(props.group.sourcePath, selectionGuid)
        }
        onSelectionUpdate={(selectionGuid, start, end, note) =>
          props.onSelectionUpdate?.(props.group.sourcePath, selectionGuid, props.group.start + baseOffset + start, props.group.start + baseOffset + end, note)
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
    );
  };
  
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
      <div class={styles.matchContent}>
        <Show when={props.isExpanded || !hasGaps()} fallback={
          /* Collapsed view: show only matching sub-regions with ellipsis separators */
          <For each={collapsedRegions()}>
            {(region, i) => (
              <>
                <Show when={i() > 0}>
                  <div class={styles.ellipsisSeparator}>···</div>
                </Show>
                {renderTextView(region.content, region.selections, region.offsetInGroup, region.clippedGuids.size > 0 ? region.clippedGuids : undefined)}
              </>
            )}
          </For>
        }>
          {/* Expanded view: full group content with all selections */}
          {renderTextView(props.group.content, props.group.selections, 0, boundaryGuids().size > 0 ? boundaryGuids() : undefined)}
        </Show>
      </div>
      <Show when={hasGaps()}>
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
 * Performs transitive expansion: overlapping non-matching selections widen
 * the group range so the expanded view shows full context.
 * Returns grouped selections with content slices and matchingGuids.
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

    // Collect matching GUIDs
    const matchingGuidSet = new Set(matchingSelections.map(s => s.guid));

    // Group overlapping matched selections into contiguous ranges (already sorted)
    let ranges: { start: number; end: number }[] = [];
    for (const sel of matchingSelections) {
      const last = ranges[ranges.length - 1];
      if (last && sel.start <= last.end) {
        last.end = Math.max(last.end, sel.end);
      } else {
        ranges.push({ start: sel.start, end: sel.end });
      }
    }

    // Transitively expand ranges with overlapping non-matching selections
    const seen = new Set(matchingGuidSet);
    let allSelections = [...matchingSelections];
    let changed = true;
    while (changed) {
      changed = false;
      const newRanges: { start: number; end: number }[] = [];
      for (const range of ranges) {
        const overlapping = findOverlapping(allSorted, range.start, range.end);
        let rStart = range.start, rEnd = range.end;
        for (const s of overlapping) {
          if (!seen.has(s.guid)) {
            seen.add(s.guid);
            allSelections.push(s);
            changed = true;
          }
          rStart = Math.min(rStart, s.start);
          rEnd = Math.max(rEnd, s.end);
        }
        const prev = newRanges[newRanges.length - 1];
        if (prev && rStart <= prev.end) {
          prev.end = Math.max(prev.end, rEnd);
        } else {
          newRanges.push({ start: rStart, end: rEnd });
        }
      }
      ranges = newRanges;
    }
    allSelections.sort((a, b) => a.start - b.start || b.end - a.end);

    // Build MatchGroups from the final expanded ranges
    for (const range of ranges) {
      const groupSelections = findOverlapping(allSelections, range.start, range.end);
      groups.push({
        sourcePath,
        start: range.start,
        end: range.end,
        content: content.slice(range.start, range.end),
        selections: groupSelections.map(s => ({
          ...s,
          start: s.start - range.start,
          end: s.end - range.start,
        })),
        matchingGuids: matchingGuidSet,
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
