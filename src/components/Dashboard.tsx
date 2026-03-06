import { createMemo, createSignal, For, Show, type Component } from 'solid-js';
import { useStore } from '../store';
import ColorChip from './ColorChip';
import styles from './Dashboard.module.css';

// Disambiguate source paths for column headers — show minimal unique suffix
function getSourceDisplayNames(paths: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const fileNameGroups = new Map<string, string[]>();

  for (const path of paths) {
    const fileName = path.split('/').pop() || path;
    if (!fileNameGroups.has(fileName)) {
      fileNameGroups.set(fileName, []);
    }
    fileNameGroups.get(fileName)!.push(path);
  }

  for (const [fileName, group] of fileNameGroups) {
    if (group.length === 1) {
      result.set(group[0], fileName);
    } else {
      const pathParts = group.map(p => p.split('/').reverse());
      for (let i = 0; i < group.length; i++) {
        let segmentsNeeded = 1;
        const currentParts = pathParts[i];
        for (let j = 0; j < group.length; j++) {
          if (i === j) continue;
          const otherParts = pathParts[j];
          let k = 0;
          while (k < currentParts.length && k < otherParts.length && currentParts[k] === otherParts[k]) {
            k++;
          }
          segmentsNeeded = Math.max(segmentsNeeded, k + 1);
        }
        const displayParts = currentParts.slice(0, Math.min(segmentsNeeded, currentParts.length)).reverse();
        result.set(group[i], displayParts.join('/'));
      }
    }
  }

  return result;
}

interface CountMap {
  // codeGuid -> sourcePath -> count
  [codeGuid: string]: Record<string, number>;
}

const Dashboard: Component = () => {
  const { store, indices } = useStore();

  const [codeColWidth, setCodeColWidth] = createSignal(200);

  const codebooksList = indices.sortedCodebooks;

  // Build direct count map: for each selection, increment count for its codeGuid + sourcePath
  const directCounts = createMemo(() => {
    const counts: CountMap = {};
    for (const [sourcePath, source] of Object.entries(store.sources)) {
      for (const sel of source.selections) {
        const codeGuid = sel.code.codeGuid;
        if (!counts[codeGuid]) counts[codeGuid] = {};
        counts[codeGuid][sourcePath] = (counts[codeGuid][sourcePath] || 0) + 1;
      }
    }
    return counts;
  });

  // All source paths (any file that has at least one selection), consistent across all tables
  const allSourcePaths = createMemo(() =>
    Object.keys(store.sources)
      .filter(path => store.sources[path].selections.length > 0)
      .sort((a, b) => a.localeCompare(b))
  );

  // Compute aggregated count for a code (self + all descendants) for a given source path
  function aggregatedCount(codeGuid: string, sourcePath: string): number {
    const subcodes = indices.subcodesByGuid()[codeGuid];
    if (!subcodes) return 0;
    const dc = directCounts();
    let total = 0;
    for (const guid of subcodes) {
      total += dc[guid]?.[sourcePath] || 0;
    }
    return total;
  }

  // Direct count for just the code itself (not descendants)
  function selfCount(codeGuid: string, sourcePath: string): number {
    return directCounts()[codeGuid]?.[sourcePath] || 0;
  }

  return (
    <div class={styles.dashboard} style={{ "--code-col-width": `${codeColWidth()}px` }}>
      <h2>Dashboard</h2>
      <Show when={codebooksList().length > 0} fallback={<p class={styles.noData}>No codebooks found. Create a codebook to get started.</p>}>
        <For each={codebooksList()}>
          {(codebook) => (
            <CodebookTable
              codebook={codebook}
              sourcePaths={allSourcePaths()}
              aggregatedCount={aggregatedCount}
              selfCount={selfCount}
              codeColWidth={codeColWidth}
              onResizeCodeCol={setCodeColWidth}
            />
          )}
        </For>
      </Show>
    </div>
  );
};

interface CodebookTableProps {
  codebook: Codebook;
  sourcePaths: string[];
  aggregatedCount: (codeGuid: string, sourcePath: string) => number;
  selfCount: (codeGuid: string, sourcePath: string) => number;
  codeColWidth: () => number;
  onResizeCodeCol: (width: number) => void;
}

const CodebookTable: Component<CodebookTableProps> = (props) => {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

  function toggleExpanded(codeGuid: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(codeGuid)) {
        next.delete(codeGuid);
      } else {
        next.add(codeGuid);
      }
      return next;
    });
  }

  const displayNames = createMemo(() => getSourceDisplayNames(props.sourcePaths));

  // Compute max count across all visible cells in this codebook's table.
  // "Visible" means: for expanded codes, use selfCount; for collapsed, use aggregatedCount.
  const maxCount = createMemo(() => {
    let max = 0;
    function walk(codes: Code[]) {
      for (const code of codes) {
        for (const sp of props.sourcePaths) {
          const isExp = expanded().has(code.guid);
          const count = isExp
            ? props.selfCount(code.guid, sp)
            : props.aggregatedCount(code.guid, sp);
          if (count > max) max = count;
        }
        if (code.subcodes && expanded().has(code.guid)) {
          walk(code.subcodes);
        }
      }
    }
    walk(props.codebook.codes);
    return max;
  });

  function handleResizeStart(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = props.codeColWidth();

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX;
      props.onResizeCodeCol(Math.max(80, startWidth + delta));
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  return (
    <div class={styles.codebookSection}>
      <h3>{props.codebook.name}</h3>
      <Show when={props.sourcePaths.length > 0} fallback={<p class={styles.emptyMessage}>No coded sources</p>}>
        <div class={styles.tableWrapper}>
          <table class={styles.table}>
            <thead>
              <tr>
                <th>
                  <div class={styles.headerFirstCell}>
                    <span>Code</span>
                    <div class={styles.resizeHandle} onMouseDown={handleResizeStart}>
                      <div class={styles.resizeHandleBar} />
                    </div>
                  </div>
                </th>
                <For each={props.sourcePaths}>
                  {(sourcePath) => (
                    <th title={sourcePath}>
                      <span class={styles.sourceHeader}>{displayNames().get(sourcePath)}</span>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={props.codebook.codes}>
                {(code) => (
                  <CodeRow
                    code={code}
                    depth={0}
                    sourcePaths={props.sourcePaths}
                    expanded={expanded()}
                    onToggle={toggleExpanded}
                    aggregatedCount={props.aggregatedCount}
                    selfCount={props.selfCount}
                    maxCount={maxCount()}
                  />
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
};

interface CodeRowProps {
  code: Code;
  depth: number;
  sourcePaths: string[];
  expanded: Set<string>;
  onToggle: (codeGuid: string) => void;
  aggregatedCount: (codeGuid: string, sourcePath: string) => number;
  selfCount: (codeGuid: string, sourcePath: string) => number;
  maxCount: number;
}

const CodeRow: Component<CodeRowProps> = (props) => {
  const hasSubcodes = () => props.code.subcodes && props.code.subcodes.length > 0;
  const isExpanded = () => props.expanded.has(props.code.guid);

  // When collapsed or no subcodes: show aggregated count (self + descendants)
  // When expanded: show only direct (self) count
  function cellCount(sourcePath: string): number {
    if (isExpanded()) {
      return props.selfCount(props.code.guid, sourcePath);
    }
    return props.aggregatedCount(props.code.guid, sourcePath);
  }

  return (
    <>
      <tr>
        <td>
          <div class={styles.codeCell} style={{ "padding-left": `${props.depth * 20}px` }}>
            <Show when={hasSubcodes()} fallback={<span class={styles.togglePlaceholder} />}>
              <button
                class={styles.toggleButton}
                onClick={() => props.onToggle(props.code.guid)}
                title={isExpanded() ? 'Collapse' : 'Expand'}
              >
                {isExpanded() ? '▼' : '▶'}
              </button>
            </Show>
            <ColorChip color={props.code.color} />
            <span class={styles.codeName}>{props.code.name}</span>
          </div>
        </td>
        <For each={props.sourcePaths}>
          {(sourcePath) => {
            const count = () => cellCount(sourcePath);
            const barPct = () => props.maxCount > 0 ? (count() / props.maxCount) * 100 : 0;
            return (
              <td class={styles.dataCell}>
                {count() > 0 ? count() : ''}
                <Show when={count() > 0}>
                  <div
                    class={styles.cellBar}
                    style={{ width: `${barPct()}%`, "background-color": props.code.color }}
                  />
                </Show>
              </td>
            );
          }}
        </For>
      </tr>
      <Show when={hasSubcodes() && isExpanded()}>
        <For each={props.code.subcodes}>
          {(subcode) => (
            <CodeRow
              code={subcode}
              depth={props.depth + 1}
              sourcePaths={props.sourcePaths}
              expanded={props.expanded}
              onToggle={props.onToggle}
              aggregatedCount={props.aggregatedCount}
              selfCount={props.selfCount}
              maxCount={props.maxCount}
            />
          )}
        </For>
      </Show>
    </>
  );
};

export default Dashboard;
