import octicons from '@primer/octicons';
import { type Component, Show, createMemo, createSignal, For, onMount } from 'solid-js';
import styles from './HighlightPopover.module.css';
import ColorChip from './ColorChip';
import { useStore } from '../store';
import type { Code, Codebook, CodeReference, TextSelection } from '../models/files';

interface HighlightPopoverProps {
    x: number;
    y: number;
    sourcePath: string;
    selection: TextSelection;
    onClick: (e: MouseEvent) => void;
}

const HighlightPopover: Component<HighlightPopoverProps> = (props) => {
    const { store, actions, indices } = useStore();
    const [showCodePicker, setShowCodePicker] = createSignal(false);

    const codeInfo = createMemo(() => {
        const info = indices.codeByGuid()[props.selection.code.codeGuid];
        return info ? { code: info.code, codebook: info.codebook } : { code: null, codebook: undefined };
    });

    const isExample = createMemo(() => {
        const info = codeInfo();
        return info.code?.examples?.some(ex => ex.textSelectionGuid === props.selection.guid) ?? false;
    });

    const handleRemoveCode = () => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        const sel = source.selections.find(s => s.guid === props.selection.guid);
        if (sel) {
            actions.removeExample(props.sourcePath, sel.guid, sel.code.codebookGuid, sel.code.codeGuid);
        }
        actions.updateSourceSelections(props.sourcePath, source.selections.filter(s => s.guid !== props.selection.guid));
    };

    const handleToggleExample = () => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        const sel = source.selections.find(s => s.guid === props.selection.guid);
        if (!sel) return;
        actions.toggleExample(props.sourcePath, sel.guid, sel.code.codebookGuid, sel.code.codeGuid);
    };

    const handleNoteChange = (e: Event) => {
        const target = e.currentTarget as HTMLTextAreaElement;
        const note = target.value.trim() === '' ? undefined : target.value;
        const source = store.sources[props.sourcePath];
        if (!source) return;
        actions.updateSourceSelections(
            props.sourcePath,
            source.selections.map(s => s.guid === props.selection.guid ? { ...s, note } : s)
        );
    };

    const handleChangeCode = (code: Code, codebook: Codebook) => {
        const newCode: CodeReference = { codebookGuid: codebook.guid, codeGuid: code.guid };
        const source = store.sources[props.sourcePath];
        if (!source) return;
        actions.updateSourceSelections(
            props.sourcePath,
            source.selections.map(s => s.guid === props.selection.guid ? { ...s, code: newCode } : s)
        );
        setShowCodePicker(false);
    };

    /** Flatten codes per codebook for grouped display */
    const codebookGroups = createMemo(() => {
        const groups: { codebook: Codebook; codes: { code: Code; depth: number }[] }[] = [];
        function walk(codes: Code[], depth: number, list: { code: Code; depth: number }[]) {
            for (const code of codes) {
                if (code.guid !== props.selection.code.codeGuid) {
                    list.push({ code, depth });
                }
                if (code.subcodes) walk(code.subcodes, depth + 1, list);
            }
        }
        for (const cb of indices.sortedCodebooks()) {
            const codes: { code: Code; depth: number }[] = [];
            walk(cb.codes, 0, codes);
            if (codes.length > 0) {
                groups.push({ codebook: cb, codes });
            }
        }
        return groups;
    });

    return (
        <div
            ref={(el) => {
                // After mounting, check if the popover overflows the viewport and adjust
                requestAnimationFrame(() => {
                    const rect = el.getBoundingClientRect();
                    const margin = 8;

                    // Horizontal: flip left if overflowing right
                    if (rect.right > window.innerWidth - margin) {
                        const newLeft = Math.max(margin, props.x - rect.width);
                        el.style.left = `${newLeft}px`;
                    }

                    // Vertical: flip above if overflowing bottom
                    if (rect.bottom > window.innerHeight - margin) {
                        const newTop = Math.max(margin, props.y - rect.height);
                        el.style.top = `${newTop}px`;
                    }
                });
            }}
            class={styles.highlightPopover}
            style={{ left: `${props.x}px`, top: `${props.y}px` }}
            onClick={props.onClick}
        >
            <div class={styles.popoverHeader}>
                <div class={styles.popoverCodeItem}>
                    <ColorChip color={codeInfo().code?.color || '#888'} />
                    <span class={styles.popoverCodeName}>{codeInfo().code?.name || 'Unknown'}</span>
                    <Show when={codeInfo().codebook}>
                        <span class={styles.popoverCodeCodebook}>({codeInfo().codebook!.name})</span>
                    </Show>
                </div>
                <div class={styles.popoverActions}>
                    <button
                        class={styles.popoverActionBtn}
                        onClick={handleToggleExample}
                        title={isExample() ? 'Remove as example' : 'Mark as example'}
                        innerHTML={isExample() ? octicons['star-fill'].toSVG() : octicons.star.toSVG()}
                    />
                    <button
                        class={styles.popoverActionBtn}
                        onClick={() => setShowCodePicker(!showCodePicker())}
                        title="Change code"
                        innerHTML={octicons['arrow-switch'].toSVG()}
                    />
                    <button
                        class={styles.popoverActionBtn}
                        onClick={handleRemoveCode}
                        title="Remove this code"
                        innerHTML={octicons.trash.toSVG()}
                    />
                </div>
            </div>
            <Show when={props.selection.creatingUser}>
                <div class={styles.popoverUser}>
                    <span class={styles.popoverUserLabel}>Created by:</span>
                    <span class={styles.popoverUserName}>{props.selection.creatingUser}</span>
                </div>
            </Show>
            <Show when={showCodePicker()}>
                <div class={styles.popoverCodePicker}>
                    <For each={codebookGroups()}>
                        {(group) => (
                            <>
                                <div class={styles.popoverCodePickerHeading}>{group.codebook.name}</div>
                                <For each={group.codes}>
                                    {(item) => (
                                        <button
                                            class={styles.popoverCodePickerItem}
                                            style={{ "padding-left": `${8 + item.depth * 14}px` }}
                                            onClick={() => handleChangeCode(item.code, group.codebook)}
                                        >
                                            <ColorChip color={item.code.color} />
                                            <span>{item.code.name}</span>
                                        </button>
                                    )}
                                </For>
                            </>
                        )}
                    </For>
                </div>
            </Show>
            <textarea
                class={styles.popoverNote}
                placeholder="Add a note..."
                value={props.selection.note || ''}
                onInput={handleNoteChange}
                rows={3}
            />
        </div>
    );
};

export default HighlightPopover;