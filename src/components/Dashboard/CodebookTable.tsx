import { createMemo, createSignal, For, Show, onCleanup, type Component } from 'solid-js';
import { buildColumnTree, computeColumnGrid } from '../../utils/paths';
import CodeRow from './CodeRow';
import styles from './Dashboard.module.css';
import type { Code, Codebook } from '../../models/files';

interface CodebookTableProps {
  codebook: Codebook;
  sourcePaths: string[];
  aggregatedCount: (codeGuid: string, sourcePath: string) => number;
  selfCount: (codeGuid: string, sourcePath: string) => number;
  codeColWidth: () => number;
  onResizeCodeCol: (width: number) => void;
  expandedColumns: Set<string>;
  onToggleColumn: (folderPath: string) => void;
  onCodeClick?: (codeGuid: string, codebookGuid: string) => void;
  onCellClick?: (codeGuid: string, codebookGuid: string, sourcePaths: string[], includeSubcodes: boolean) => void;
  onSourceClick?: (sourcePath: string) => void;
}

const CodebookTable: Component<CodebookTableProps> = (props) => {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

  let isResizing = false;
  let resizeMouseMoveListener: ((e: MouseEvent) => void) | null = null;
  let resizeMouseUpListener: ((e: MouseEvent | FocusEvent) => void) | null = null;

  function stopResize() {
    if (!isResizing) return;
    if (resizeMouseMoveListener) {
      document.removeEventListener('mousemove', resizeMouseMoveListener);
    }
    if (resizeMouseUpListener) {
      document.removeEventListener('mouseup', resizeMouseUpListener as EventListener);
      window.removeEventListener('blur', resizeMouseUpListener as EventListener);
    }
    isResizing = false;
    resizeMouseMoveListener = null;
    resizeMouseUpListener = null;
  }

  onCleanup(() => {
    stopResize();
  });

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

  const columnTree = createMemo(() => buildColumnTree(props.sourcePaths));
  const columnGrid = createMemo(() => computeColumnGrid(columnTree(), props.expandedColumns));

  // Compute max count across all visible cells in this codebook's table.
  // Each leaf column may represent multiple source files (collapsed folder).
  const maxCount = createMemo(() => {
    let max = 0;
    const leaves = columnGrid().leafColumns;
    function walk(codes: Code[]) {
      for (const code of codes) {
        for (const col of leaves) {
          const isExp = expanded().has(code.guid);
          let count = 0;
          for (const sp of col.leafPaths) {
            count += isExp
              ? props.selfCount(code.guid, sp)
              : props.aggregatedCount(code.guid, sp);
          }
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

    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      props.onResizeCodeCol(Math.max(80, startWidth + delta));
    };

    const onMouseUp = () => {
      stopResize();
    };

    // Store listeners so they can be removed on cleanup/unmount.
    resizeMouseMoveListener = onMouseMove;
    resizeMouseUpListener = onMouseUp;
    isResizing = true;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onMouseUp);
  }

  return (
    <div class={styles.codebookSection}>
      <h3>{props.codebook.name}</h3>
      <Show when={props.sourcePaths.length > 0} fallback={<p class={styles.emptyMessage}>No coded sources</p>}>
        <div class={styles.tableWrapper}>
          <table class={styles.table}>
            <thead>
              <For each={columnGrid().headerRows}>
                {(row, rowIdx) => (
                  <tr>
                    <Show when={rowIdx() === 0}>
                      <th rowSpan={columnGrid().depth}>
                        <div class={styles.headerFirstCell}>
                          <span>Code</span>
                          <div class={styles.resizeHandle} onMouseDown={handleResizeStart}>
                            <div class={styles.resizeHandleBar} />
                          </div>
                        </div>
                      </th>
                    </Show>
                    <For each={row}>
                      {(cell) => (
                        <th
                          colSpan={cell.colspan}
                          rowSpan={cell.rowspan}
                          title={cell.node.path}
                          class={cell.node.isFolder || props.onSourceClick ? styles.clickableHeader : ''}
                          onClick={() => {
                            if (cell.node.isFolder) {
                              props.onToggleColumn(cell.node.path);
                            } else {
                              props.onSourceClick?.(cell.node.path);
                            }
                          }}
                        >
                          <Show when={cell.node.isFolder && props.expandedColumns.has(cell.node.path)}
                            fallback={
                              <span class={styles.sourceHeader}>
                                {cell.node.isFolder ? `▸ ${cell.node.name}/` : cell.node.name}
                              </span>
                            }
                          >
                            <span class={styles.folderHeaderExpanded}>
                              ▾ {cell.node.name}/
                            </span>
                          </Show>
                        </th>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </thead>
            <tbody>
              <For each={props.codebook.codes}>
                {(code) => (
                  <CodeRow
                    code={code}
                    codebookGuid={props.codebook.guid}
                    depth={0}
                    leafColumns={columnGrid().leafColumns}
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
