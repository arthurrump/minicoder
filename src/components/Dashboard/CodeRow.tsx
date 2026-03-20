import { For, Show, type Component } from 'solid-js';
import ColorChip from '../ColorChip';
import styles from './Dashboard.module.css';
import type { Code } from '../../models/files';
import type { ColumnNode } from '../../utils/paths';

export interface CodeRowProps {
  code: Code;
  codebookGuid: string;
  depth: number;
  leafColumns: ColumnNode[];
  expanded: Set<string>;
  onToggle: (codeGuid: string) => void;
  aggregatedCount: (codeGuid: string, sourcePath: string) => number;
  selfCount: (codeGuid: string, sourcePath: string) => number;
  maxCount: number;
  onCodeClick?: (codeGuid: string, codebookGuid: string) => void;
  onCellClick?: (codeGuid: string, codebookGuid: string, sourcePaths: string[], includeSubcodes: boolean) => void;
}

const CodeRow: Component<CodeRowProps> = (props) => {
  const hasSubcodes = () => props.code.subcodes && props.code.subcodes.length > 0;
  const isExpanded = () => props.expanded.has(props.code.guid);

  // Sum counts across all leaf files in a column node
  function cellCount(column: ColumnNode): number {
    let count = 0;
    for (const sp of column.leafPaths) {
      count += isExpanded()
        ? props.selfCount(props.code.guid, sp)
        : props.aggregatedCount(props.code.guid, sp);
    }
    return count;
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
            <span
              class={`${styles.codeName} ${props.onCodeClick ? styles.clickableCode : ''}`}
              onClick={() => props.onCodeClick?.(props.code.guid, props.codebookGuid)}
            >{props.code.name}</span>
          </div>
        </td>
        <For each={props.leafColumns}>
          {(column) => {
            const count = () => cellCount(column);
            const barPct = () => props.maxCount > 0 ? (count() / props.maxCount) * 100 : 0;
            const includesSubcodes = () => !isExpanded() && hasSubcodes();
            return (
              <td class={styles.dataCell}>
                <Show when={count() > 0}>
                  <span
                    class={props.onCellClick ? styles.clickableCount : ''}
                    onClick={() => props.onCellClick?.(props.code.guid, props.codebookGuid, column.leafPaths, includesSubcodes())}
                  >{count()}</span>
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
              codebookGuid={props.codebookGuid}
              depth={props.depth + 1}
              leafColumns={props.leafColumns}
              expanded={props.expanded}
              onToggle={props.onToggle}
              aggregatedCount={props.aggregatedCount}
              selfCount={props.selfCount}
              maxCount={props.maxCount}
              onCodeClick={props.onCodeClick}
              onCellClick={props.onCellClick}
            />
          )}
        </For>
      </Show>
    </>
  );
};

export default CodeRow;
