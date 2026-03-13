import { createSignal, createMemo, Show, type Component, onMount, onCleanup } from 'solid-js';
import octicons from '@primer/octicons';
import { useStore } from '../store';
import { updateCodeInTree } from '../utils/codeTree';
import styles from './CodeSelectionsModal.module.css';
import ColorChip from './ColorChip';
import { MatchingSelectionsList, buildMatchGroups } from './MatchingSelections';

interface CodeSelectionsModalProps {
  codeGuid: string;
  codebookGuid: string;
  currentFilePath?: string;
  /** When set, only show selections from this source file */
  sourceFilter?: string;
  /** When true, include selections for all subcodes of the given code */
  includeSubcodes?: boolean;
  onClose: () => void;
  onOpenSource?: (sourcePath: string, charOffset: number) => void;
}

const CodeSelectionsModal: Component<CodeSelectionsModalProps> = (props) => {
  const { store, actions, indices } = useStore();
  const [editing, setEditing] = createSignal(false);
  const [showOnlyMatching, setShowOnlyMatching] = createSignal(false);

  // Find the code and codebook
  const codeInfo = createMemo(() => indices.codeByGuid()[props.codeGuid] ?? null);

  // Collect target code GUIDs: just this code, or include all subcodes
  const targetGuids = createMemo(() => {
    const info = codeInfo();
    if (!info) return new Set<string>();
    if (props.includeSubcodes) {
      return indices.subcodesByGuid()[props.codeGuid] ?? new Set([info.code.guid]);
    }
    return new Set([info.code.guid]);
  });

  // Build all match groups for this code, optionally filtered to a single source
  const filteredSources = createMemo(() => {
    if (!props.sourceFilter) return store.sources;
    const source = store.sources[props.sourceFilter];
    if (!source) return {} as Record<string, Source>;
    return { [props.sourceFilter]: source } as Record<string, Source>;
  });

  const allMatchResult = createMemo(() =>
    buildMatchGroups(targetGuids(), filteredSources(), store.fileContents, showOnlyMatching())
  );

  const allGroups = createMemo(() => allMatchResult().groups);
  const totalMatchCount = createMemo(() => allMatchResult().matchCount);

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

  // Count matching selections in example groups
  const exampleSelectionCount = createMemo(() => {
    const guids = targetGuids();
    return exampleGroups().reduce((sum, g) =>
      sum + g.selections.filter(s => guids.has(s.code.codeGuid)).length, 0);
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

  // Count matching selections in current file groups
  const currentFileSelectionCount = createMemo(() => {
    const guids = targetGuids();
    return currentFileGroups().reduce((sum, g) =>
      sum + g.selections.filter(s => guids.has(s.code.codeGuid)).length, 0);
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

  // Count matching selections in other groups
  const otherSelectionCount = createMemo(() => {
    const guids = targetGuids();
    return otherGroups().reduce((sum, g) =>
      sum + g.selections.filter(s => guids.has(s.code.codeGuid)).length, 0);
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
                    <h2 class={styles.modalTitle}>{info().code.name}{props.includeSubcodes ? ' + subcodes' : ''}</h2>
                    <span class={styles.codebookName}>({info().codebook.name})</span>
                  </>
                }>
                  <input
                    type="color"
                    class={styles.codeColorPicker}
                    value={info().code.color}
                    onChange={(e) => handleUpdateCode({ color: e.target.value })}
                    title="Code color"
                  />
                  <input
                    type="text"
                    class={styles.codeNameInput}
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

          <div class={styles.modalOptions}>
            <span class={styles.totalCount}>{totalMatchCount()} selections total</span>
            <label class={styles.showOnlyMatchingLabel}>
              <input
                type="checkbox"
                checked={showOnlyMatching()}
                onChange={(e) => setShowOnlyMatching(e.target.checked)}
              />
              Show only matching
            </label>
          </div>

          <Show when={exampleGroups().length > 0}>
            <MatchingSelectionsList
              matchGroups={exampleGroups()}
              title={`Examples (${exampleSelectionCount()})`}
              onOpenSource={(sourcePath, charOffset) => { props.onClose(); props.onOpenSource?.(sourcePath, charOffset); }}
            />
          </Show>

          <Show when={currentFileGroups().length > 0}>
            <MatchingSelectionsList
              matchGroups={currentFileGroups()}
              title={`In Current File (${currentFileSelectionCount()})`}
              onOpenSource={(sourcePath, charOffset) => { props.onClose(); props.onOpenSource?.(sourcePath, charOffset); }}
            />
          </Show>

          <MatchingSelectionsList
            matchGroups={otherGroups()}
            title={`Selections (${otherSelectionCount()})`}
            onOpenSource={(sourcePath, charOffset) => { props.onClose(); props.onOpenSource?.(sourcePath, charOffset); }}
          />
        </div>
      </div>
    </div>
  );
};

export default CodeSelectionsModal;
