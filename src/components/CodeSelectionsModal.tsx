import { createSignal, createMemo, Show, type Component, onMount, onCleanup } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore } from '../store';
import styles from './CodeSelectionsModal.module.css';
import editorStyles from './CodebookEditor.module.css';
import ColorChip from './ColorChip';
import { findCodeByGuid, MatchingSelectionsList, buildMatchGroups } from './MatchingSelections';

interface CodeSelectionsModalProps {
  codeGuid: string;
  codebookGuid: string;
  currentFilePath?: string;
  onClose: () => void;
}

function updateCodeInTree(codes: Code[], guid: string, updates: Partial<Code>): Code[] {
  return codes.map(code => {
    if (code.guid === guid) return { ...code, ...updates };
    if (code.subcodes?.length) {
      return { ...code, subcodes: updateCodeInTree(code.subcodes, guid, updates) };
    }
    return code;
  });
}

const CodeSelectionsModal: Component<CodeSelectionsModalProps> = (props) => {
  const { store, actions } = useStore();
  const [editing, setEditing] = createSignal(false);

  // Find the code and codebook
  const codeInfo = createMemo(() => findCodeByGuid(Object.values(store.codebooks), props.codeGuid));

  // Collect this code + all subcodes
  const targetGuids = createMemo(() => {
    const info = codeInfo();
    if (!info) return new Set<string>();
    return new Set([info.code.guid]);
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

  // Groups from the current file (excluding examples)
  const currentFileGroups = createMemo(() => {
    const exGuids = exampleSelectionGuids();
    const currentPath = props.currentFilePath;
    if (!currentPath) return [];
    return allGroups().filter(g =>
      g.sourcePath === currentPath &&
      !g.selections.some(s => exGuids.has(s.guid))
    );
  });

  // All other groups (excluding examples and current file)
  const otherGroups = createMemo(() => {
    const exGuids = exampleSelectionGuids();
    const currentPath = props.currentFilePath;
    return allGroups().filter(g =>
      !g.selections.some(s => exGuids.has(s.guid)) &&
      !(currentPath && g.sourcePath === currentPath)
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

  // Update code properties (name, description, color)
  const handleUpdateCode = (updates: Partial<Code>) => {
    const info = codeInfo();
    if (!info) return;
    const updatedCodebook = {
      ...info.codebook,
      codes: updateCodeInTree(info.codebook.codes, props.codeGuid, updates),
    };
    actions.updateCodebook(updatedCodebook);
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
                <Show when={editing()} fallback={
                  <>
                    <ColorChip color={info().code.color} class={styles.codeChip} />
                    <h2 class={styles.modalTitle}>{info().code.name}</h2>
                    <span class={styles.codebookName}>({info().codebook.name})</span>
                  </>
                }>
                  <input
                    type="color"
                    class={editorStyles.codeColorPicker}
                    value={info().code.color}
                    onChange={(e) => handleUpdateCode({ color: e.target.value })}
                    title="Code color"
                  />
                  <input
                    type="text"
                    class={editorStyles.codeNameInput}
                    value={info().code.name}
                    onInput={(e) => handleUpdateCode({ name: e.target.value })}
                    placeholder="Code name..."
                  />
                </Show>
              )}
            </Show>
          </div>
          <div class={styles.headerActions}>
            <button
              class={styles.closeBtn}
              onClick={() => setEditing(e => !e)}
              title={editing() ? 'Stop editing' : 'Edit code'}
              innerHTML={editing() ? octicons.check.toSVG({ width: 16 }) : octicons.pencil.toSVG({ width: 16 })}
            />
            <button
              class={styles.closeBtn}
              onClick={props.onClose}
              title="Close"
              innerHTML={octicons.x.toSVG({ width: 16 })}
            />
          </div>
        </div>

        <div class={styles.modalBody}>
          <Show when={editing() && codeInfo()}>
            {(info) => (
              <textarea
                class={styles.editDescription}
                placeholder="Description..."
                value={info().code.description || ''}
                onInput={(e) => handleUpdateCode({ description: e.target.value })}
                rows="3"
              />
            )}
          </Show>
          <Show when={!editing() && codeInfo()?.code.description}>
            <p class={styles.codeDescription}>{codeInfo()!.code.description}</p>
          </Show>

          <Show when={exampleGroups().length > 0}>
            <MatchingSelectionsList
              matchGroups={exampleGroups()}
              title={`Examples (${exampleGroups().length})`}
              onToggleExample={handleToggleExample}
            />
          </Show>

          <Show when={currentFileGroups().length > 0}>
            <MatchingSelectionsList
              matchGroups={currentFileGroups()}
              title={`In Current File (${currentFileGroups().length})`}
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
