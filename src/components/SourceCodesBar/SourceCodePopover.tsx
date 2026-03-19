import Icon from '../Icon';
import { type Component, Show, createMemo, createSignal, For, onCleanup } from 'solid-js';
import ColorChip from '../ColorChip';
import { useStore } from '../../store';
import { flattenCodesWithDepth } from '../../utils/codeTree';
import type { AppliedCode, Code, Codebook, CodeReference } from '../../models/files';
import styles from './SourceCodesBar.module.css';

interface SourceCodePopoverProps {
    sourcePath: string;
    appliedCode: AppliedCode;
    x: number;
    y: number;
    onClose: () => void;
}

const SourceCodePopover: Component<SourceCodePopoverProps> = (props) => {
    const { store, actions, indices } = useStore();
    const [showCodePicker, setShowCodePicker] = createSignal(false);
    let popoverRef: HTMLDivElement | undefined;

    // Close on outside click
    const onMouseDown = (e: MouseEvent) => {
        if (popoverRef && !popoverRef.contains(e.target as Node)) {
            props.onClose();
        }
    };
    document.addEventListener('mousedown', onMouseDown);
    onCleanup(() => document.removeEventListener('mousedown', onMouseDown));

    // Close on Escape
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            props.onClose();
            e.preventDefault();
        }
    };
    document.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown, true));

    const codeInfo = createMemo(() => {
        const info = indices.codeByGuid()[props.appliedCode.code.codeGuid];
        return info ? { code: info.code, codebook: info.codebook } : { code: null, codebook: undefined };
    });

    const handleRemove = () => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        actions.updateSourceCodes(
            props.sourcePath,
            (source.sourceCodes ?? []).filter(sc => sc.code.codeGuid !== props.appliedCode.code.codeGuid),
        );
        props.onClose();
    };

    const handleChangeCode = (code: Code, codebook: Codebook) => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        const newRef: CodeReference = { codebookGuid: codebook.guid, codeGuid: code.guid };
        actions.updateSourceCodes(
            props.sourcePath,
            (source.sourceCodes ?? []).map(sc =>
                sc.code.codeGuid === props.appliedCode.code.codeGuid ? { ...sc, code: newRef } : sc
            ),
        );
        setShowCodePicker(false);
    };

    const handleNoteChange = (e: Event) => {
        const target = e.currentTarget as HTMLTextAreaElement;
        const note = target.value.trim() === '' ? undefined : target.value;
        const source = store.sources[props.sourcePath];
        if (!source) return;
        actions.updateSourceCodes(
            props.sourcePath,
            (source.sourceCodes ?? []).map(sc =>
                sc.code.codeGuid === props.appliedCode.code.codeGuid ? { ...sc, note } : sc
            ),
        );
    };

    /** Codebook groups for the change-code picker, excluding the current code */
    const codebookGroups = createMemo(() => {
        const groups: { codebook: Codebook; codes: { code: Code; depth: number }[] }[] = [];
        for (const cb of indices.sortedCodebooks()) {
            const all = flattenCodesWithDepth(cb.codes);
            const filtered = all.filter(item => item.code.guid !== props.appliedCode.code.codeGuid);
            if (filtered.length > 0) {
                groups.push({ codebook: cb, codes: filtered });
            }
        }
        return groups;
    });

    return (
        <div
            ref={(el) => {
                popoverRef = el;
                requestAnimationFrame(() => {
                    const rect = el.getBoundingClientRect();
                    const margin = 8;
                    if (rect.right > window.innerWidth - margin) {
                        el.style.left = `${Math.max(margin, props.x - rect.width)}px`;
                    }
                    if (rect.bottom > window.innerHeight - margin) {
                        el.style.top = `${Math.max(margin, props.y - rect.height)}px`;
                    }
                });
            }}
            class={styles.popover}
            style={{ left: `${props.x}px`, top: `${props.y}px` }}
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
                        onClick={() => setShowCodePicker(!showCodePicker())}
                        title="Change code"
                    ><Icon name="arrow-switch" /></button>
                    <button
                        class={styles.popoverActionBtn}
                        onClick={handleRemove}
                        title="Remove this code"
                    ><Icon name="trash" /></button>
                </div>
            </div>
            <Show when={props.appliedCode.creatingUser}>
                <div class={styles.popoverUser}>
                    <span class={styles.popoverUserLabel}>Created by:</span>
                    <span class={styles.popoverUserName}>{props.appliedCode.creatingUser}</span>
                </div>
            </Show>
            <Show when={showCodePicker()}>
                <div class={styles.popoverCodePicker}>
                    <For each={codebookGroups()}>
                        {(group) => (
                            <>
                                <div class={styles.pickerHeading}>{group.codebook.name}</div>
                                <For each={group.codes}>
                                    {(item) => (
                                        <button
                                            class={styles.pickerItem}
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
                value={props.appliedCode.note || ''}
                onInput={handleNoteChange}
                rows={3}
            />
        </div>
    );
};

export default SourceCodePopover;
