import { createMemo, createSignal, For, Show, type Component } from 'solid-js';
import { disambiguatePaths } from '../../utils/paths';
import CodeRow from './CodeRow';
import styles from './Dashboard.module.css';

interface CodebookTableProps {
  codebook: Codebook;
  sourcePaths: string[];
  aggregatedCount: (codeGuid: string, sourcePath: string) => number;
  selfCount: (codeGuid: string, sourcePath: string) => number;
  codeColWidth: () => number;
  onResizeCodeCol: (width: number) => void;
  onCodeClick?: (codeGuid: string, codebookGuid: string) => void;
  onCellClick?: (codeGuid: string, codebookGuid: string, sourcePath: string, includeSubcodes: boolean) => void;
  onSourceClick?: (sourcePath: string) => void;
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

  const displayNames = createMemo(() => disambiguatePaths(props.sourcePaths));

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
                    <th
                      title={sourcePath}
                      class={props.onSourceClick ? styles.clickableHeader : ''}
                      onClick={() => props.onSourceClick?.(sourcePath)}
                    >
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
                    codebookGuid={props.codebook.guid}
                    depth={0}
                    sourcePaths={props.sourcePaths}
                    expanded={expanded()}
                    onToggle={toggleExpanded}
                    aggregatedCount={props.aggregatedCount}
                    selfCount={props.selfCount}
                    maxCount={maxCount()}
                    onCodeClick={props.onCodeClick}
                    onCellClick={props.onCellClick}
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

export default CodebookTable;
