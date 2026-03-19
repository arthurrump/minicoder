import { createMemo, createSignal, Index, Show, type Component } from 'solid-js';
import { useStore } from '../../store';
import styles from './MatchingSelections.module.css';
import MatchItemBase from './MatchItemBase';
import TextView from '../TextView';
import { SelectionPopover } from '../Popover';
import { computeCollapsedRegions, type MatchGroup } from '../../utils/selections';
import type { Code, Codebook, TextSelection } from '../../models/files';

export interface SelectionMatchItemProps {
  group: MatchGroup;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEnsureExpanded: () => void;
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
  onSelectionCreate?: (sourcePath: string, start: number, end: number) => void;
  onSelectionUpdate?: (sourcePath: string, selectionGuid: string, start: number, end: number) => void;
  onSelectionClear?: () => void;
  selectedCode?: { code: Code; codebook: Codebook } | null;
}

const SelectionMatchItem: Component<SelectionMatchItemProps> = (props) => {
  const { indices } = useStore();
  const [popover, setPopover] = createSignal<{ selection: TextSelection; x: number; y: number } | null>(null);

  const handleCodeClick = (codeGuid: string, e: MouseEvent) => {
    const sel = props.group.selections.find(s => s.code.codeGuid === codeGuid);
    if (sel) {
      setPopover({ selection: sel, x: e.clientX, y: e.clientY });
    }
  };

  const handleClosePopover = () => setPopover(null);

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
  
  // Get unique codes for the header display
  const uniqueCodes = createMemo(() => {
    const map = new Map<string, { code: Code; codebook: Codebook }>();
    const idx = indices.codeByGuid();
    for (const sel of props.group.selections) {
      if (!map.has(sel.code.codeGuid)) {
        const info = idx[sel.code.codeGuid];
        if (info) map.set(sel.code.codeGuid, info);
      }
    }
    return Array.from(map.values());
  });
  
  return (
    <>
    <MatchItemBase
      sourcePath={props.group.sourcePath}
      codes={uniqueCodes()}
      charOffset={props.group.start}
      onOpenSource={props.onOpenSource}
      onCodeClick={handleCodeClick}
    >
      <div class={styles.matchContent}>
        <Show when={props.isExpanded || !hasGaps()} fallback={
          /* Collapsed view: show only matching sub-regions with ellipsis separators.
           * Index preserves component instances by position so that interactions
           * (popovers, drag handles, note editing) survive reactive updates. */
          <Index each={collapsedRegions()}>
            {(region, i) => (
              <>
                <Show when={i > 0}>
                  <div class={styles.ellipsisSeparator}>···</div>
                </Show>
                <TextView
                  content={region().content}
                  selections={region().selections}
                  sourcePath={props.group.sourcePath}
                  nonResizableGuids={region().clippedGuids.size > 0 ? region().clippedGuids : undefined}
                  onSelectionCreate={(start, end) => {
                    props.onEnsureExpanded();
                    props.onSelectionCreate?.(props.group.sourcePath, props.group.start + region().offsetInGroup + start, props.group.start + region().offsetInGroup + end);
                  }}
                  onSelectionUpdate={(selectionGuid, start, end) =>
                    props.onSelectionUpdate?.(props.group.sourcePath, selectionGuid, props.group.start + region().offsetInGroup + start, props.group.start + region().offsetInGroup + end)
                  }
                  onSelectionClear={props.onSelectionClear}
                  selectedCode={props.selectedCode}
                />
              </>
            )}
          </Index>
        }>
          {/* Expanded view: full group content with all selections */}
          <TextView
            content={props.group.content}
            selections={props.group.selections}
            sourcePath={props.group.sourcePath}
            nonResizableGuids={boundaryGuids().size > 0 ? boundaryGuids() : undefined}
            onSelectionCreate={(start, end) => {
              props.onEnsureExpanded();
              props.onSelectionCreate?.(props.group.sourcePath, props.group.start + start, props.group.start + end);
            }}
            onSelectionUpdate={(selectionGuid, start, end) =>
              props.onSelectionUpdate?.(props.group.sourcePath, selectionGuid, props.group.start + start, props.group.start + end)
            }
            onSelectionClear={props.onSelectionClear}
            selectedCode={props.selectedCode}
          />
        </Show>
      </div>
      <Show when={hasGaps()}>
        <button class={styles.expandBtn} onClick={() => props.onToggleExpand()}>
          {props.isExpanded ? 'Show less' : 'Show more'}
        </button>
      </Show>
    </MatchItemBase>
    <Show when={popover()}>
      {(p) => (
        <SelectionPopover
          sourcePath={props.group.sourcePath}
          selection={p().selection}
          x={p().x}
          y={p().y}
          onClose={handleClosePopover}
        />
      )}
    </Show>
    </>
  );
};

export default SelectionMatchItem;
