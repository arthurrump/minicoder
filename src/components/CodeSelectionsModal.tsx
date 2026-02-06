import { createMemo, Show, type Component, onMount, onCleanup } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore } from '../store';
import styles from './CodeSelectionsModal.module.css';
import ColorChip from './ColorChip';
import { findCodeByGuid, MatchingSelectionsList, buildMatchGroups } from './MatchingSelections';

interface CodeSelectionsModalProps {
  codeGuid: string;
  codebookGuid: string;
  onClose: () => void;
}

const CodeSelectionsModal: Component<CodeSelectionsModalProps> = (props) => {
  const { store, actions } = useStore();

  // Find the code and codebook
  const codeInfo = createMemo(() => findCodeByGuid(store.codebooks, props.codeGuid));

  // Collect this code + all subcodes
  const targetGuids = createMemo(() => {
    const info = codeInfo();
    if (!info) return new Set<string>();
    return new Set([info.code.guid]);
  });

  // Ensure file content is loaded for all sources
  createMemo(() => {
    for (const sourcePath of Object.keys(store.sources)) {
      if (!store.fileContents[sourcePath]) {
        actions.loadFileContent(sourcePath);
      }
    }
  });

  // Build all match groups for this code
  const allGroups = createMemo(() =>
    buildMatchGroups(targetGuids(), store.sources, store.fileContents)
  );

  // Build a set of example selection GUIDs for quick lookup
  const exampleSelectionGuids = createMemo(() => {
    const info = codeInfo();
    if (!info) return new Set<string>();
    const guids = new Set<string>();

    // Collect examples from this code and its subcodes
    function collectExamples(code: Code) {
      if (code.examples) {
        for (const ex of code.examples) {
          guids.add(ex.textSelectionGuid);
        }
      }
      if (code.subcodes) {
        for (const sub of code.subcodes) {
          collectExamples(sub);
        }
      }
    }
    collectExamples(info.code);
    return guids;
  });

  // Separate example groups from other groups
  const exampleGroups = createMemo(() => {
    const exGuids = exampleSelectionGuids();
    return allGroups().filter(g =>
      g.selections.some(s => exGuids.has(s.guid))
    );
  });

  const otherGroups = createMemo(() => {
    const exGuids = exampleSelectionGuids();
    return allGroups().filter(g =>
      !g.selections.some(s => exGuids.has(s.guid))
    );
  });

  // Close on Escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
  };
  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  // Close when clicking the backdrop
  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  // Handle toggling example status for a selection
  const handleToggleExample = (sourcePath: string, selectionGuid: string) => {
    const source = store.sources[sourcePath];
    if (!source) return;
    const sel = source.selections.find(s => s.guid === selectionGuid);
    if (!sel) return;
    actions.toggleExample(sourcePath, selectionGuid, sel.code.codebookGuid, sel.code.codeGuid);
  };

  return (
    <div class={styles.modalBackdrop} onClick={handleBackdropClick}>
      <div class={styles.modalContent}>
        <div class={styles.modalHeader}>
          <div class={styles.modalTitleRow}>
            <Show when={codeInfo()}>
              {(info) => (
                <>
                  <ColorChip color={info().code.color} class={styles.codeChip} />
                  <h2 class={styles.modalTitle}>{info().code.name}</h2>
                  <span class={styles.codebookName}>({info().codebook.name})</span>
                </>
              )}
            </Show>
          </div>
          <button
            class={styles.closeBtn}
            onClick={props.onClose}
            title="Close"
            innerHTML={octicons.x.toSVG({ width: 16 })}
          />
        </div>

        <div class={styles.modalBody}>
          <Show when={codeInfo()?.code.description}>
            <p class={styles.codeDescription}>{codeInfo()!.code.description}</p>
          </Show>

          <Show when={exampleGroups().length > 0}>
            <MatchingSelectionsList
              matchGroups={exampleGroups()}
              title={`Examples (${exampleGroups().length})`}
              onToggleExample={handleToggleExample}
            />
          </Show>

          <MatchingSelectionsList
            matchGroups={otherGroups()}
            title={`Selections (${otherGroups().length})`}
            onToggleExample={handleToggleExample}
          />
        </div>
      </div>
    </div>
  );
};

export default CodeSelectionsModal;
