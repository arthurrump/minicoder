import { For, Show, type Component } from 'solid-js';
import ColorChip from '../ColorChip';
import styles from './Dashboard.module.css';

export interface CodeRowProps {
  code: Code;
  codebookGuid: string;
  depth: number;
  sourcePaths: string[];
  expanded: Set<string>;
  onToggle: (codeGuid: string) => void;
  aggregatedCount: (codeGuid: string, sourcePath: string) => number;
  selfCount: (codeGuid: string, sourcePath: string) => number;
  maxCount: number;
  onCodeClick?: (codeGuid: string, codebookGuid: string) => void;
  onCellClick?: (codeGuid: string, codebookGuid: string, sourcePath: string, includeSubcodes: boolean) => void;
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
            <span
              class={`${styles.codeName} ${props.onCodeClick ? styles.clickableCode : ''}`}
              onClick={() => props.onCodeClick?.(props.code.guid, props.codebookGuid)}
            >{props.code.name}</span>
          </div>
        </td>
        <For each={props.sourcePaths}>
          {(sourcePath) => {
            const count = () => cellCount(sourcePath);
            const barPct = () => props.maxCount > 0 ? (count() / props.maxCount) * 100 : 0;
            const includesSubcodes = () => !isExpanded() && hasSubcodes();
            return (
              <td class={styles.dataCell}>
                <Show when={count() > 0}>
                  <span
                    class={props.onCellClick ? styles.clickableCount : ''}
                    onClick={() => props.onCellClick?.(props.code.guid, props.codebookGuid, sourcePath, includesSubcodes())}
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
              sourcePaths={props.sourcePaths}
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
