import { createMemo, createSignal, For, Show, type Component } from 'solid-js';
import { useStore } from '../../store';
import CodebookTable from './CodebookTable';
import styles from './Dashboard.module.css';

interface CountMap {
  // codeGuid -> sourcePath -> count
  [codeGuid: string]: Record<string, number>;
}

interface DashboardProps {
  onCodeClick?: (codeGuid: string, codebookGuid: string) => void;
  onCellClick?: (codeGuid: string, codebookGuid: string, sourcePath: string, includeSubcodes: boolean) => void;
  onSourceClick?: (sourcePath: string) => void;
}

const Dashboard: Component<DashboardProps> = (props) => {
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
              onCodeClick={props.onCodeClick}
              onCellClick={props.onCellClick}
              onSourceClick={props.onSourceClick}
            />
          )}
        </For>
      </Show>
    </div>
  );
};

export default Dashboard;

