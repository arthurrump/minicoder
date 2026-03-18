import { createMemo, For, type Component } from 'solid-js';
import styles from './CodebookEditor.module.css';

interface MoveToCodebookPickerProps {
  sourceCodebookGuid: string;
  codebooks: Codebook[];
  onSelect: (targetCodebookGuid: string) => void;
  onCancel: () => void;
}

const MoveToCodebookPicker: Component<MoveToCodebookPickerProps> = (props) => {
  const availableTargets = createMemo(() =>
    props.codebooks.filter(cb => cb.guid !== props.sourceCodebookGuid)
  );

  return (
    <div class={styles.mergeOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div class={styles.mergePanel}>
        <div class={styles.mergePanelHeader}>
          <span>Move to codebook…</span>
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

export default MoveToCodebookPicker;
