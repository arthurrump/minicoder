import { createMemo, For, type Component } from 'solid-js';
import styles from './CodebookEditor.module.css';
import ColorChip from '../ColorChip';
import type { Code } from '../../models/files';

interface MergeTargetPickerProps {
  sourceCodeGuid: string;
  allCodes: { code: Code; depth: number }[];
  onSelect: (targetGuid: string) => void;
  onCancel: () => void;
}

const MergeTargetPicker: Component<MergeTargetPickerProps> = (props) => {
  const availableTargets = createMemo(() =>
    props.allCodes.filter(c => c.code.guid !== props.sourceCodeGuid)
  );

  return (
    <div class={styles.mergeOverlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div class={styles.mergePanel}>
        <div class={styles.mergePanelHeader}>
          <span>Merge into…</span>
          <button class={styles.codeActionBtn} onClick={props.onCancel}>
            ✕
          </button>
        </div>
        <div class={styles.mergePanelList}>
          <For each={availableTargets()}>
            {(item) => (
              <button
                class={styles.mergeTargetItem}
                style={{ "padding-left": `${12 + item.depth * 16}px` }}
                onClick={() => props.onSelect(item.code.guid)}
              >
                <ColorChip color={item.code.color} />
                <span>{item.code.name}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default MergeTargetPicker;
