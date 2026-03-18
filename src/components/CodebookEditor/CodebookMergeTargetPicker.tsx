import { createMemo, For, type Component } from 'solid-js';
import styles from './CodebookEditor.module.css';

interface CodebookMergeTargetPickerProps {
  sourceCodebookGuid: string;
  codebooks: Codebook[];
  onSelect: (targetGuid: string) => void;
  onCancel: () => void;
}

const CodebookMergeTargetPicker: Component<CodebookMergeTargetPickerProps> = (props) => {
  const availableTargets = createMemo(() =>
    props.codebooks.filter(cb => cb.guid !== props.sourceCodebookGuid)
  );

  return (
    <div class={styles.mergeOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div class={styles.mergePanel}>
        <div class={styles.mergePanelHeader}>
          <span>Merge codebook into…</span>
          <button class={styles.codeActionBtn} onClick={props.onCancel}>
            ✕
          </button>
        </div>
        <div class={styles.mergePanelList}>
          <For each={availableTargets()}>
            {(cb) => (
              <button
                class={styles.mergeTargetItem}
                onClick={() => props.onSelect(cb.guid)}
              >
                <span>{cb.name}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default CodebookMergeTargetPicker;
