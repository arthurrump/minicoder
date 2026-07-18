import Icon from '../Icon';
import { type Component, type JSX, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import ColorChip from '../ColorChip';
import InlineCodePicker, { type InlineCodePickerGroup } from '../InlineCodePicker';
import { useStore } from '../../store';
import { flattenCodesWithDepth } from '../../utils/codeTree';
import type { Code, Codebook } from '../../models/files';
import styles from './Popover.module.css';

interface PopoverProps {
    x: number;
    y: number;
    onClose: () => void;
    codeGuid: string;
    creatingUser?: string;
    note?: string;
    onRemove: () => void;
    onChangeCode: (code: Code, codebook: Codebook) => void;
    onNoteChange: (note: string | undefined) => void;
    extraActions?: JSX.Element;
}

const Popover: Component<PopoverProps> = (props) => {
    const { indices } = useStore();
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

    // Close on scroll outside the popover (fixed positioning breaks on scroll)
    const onScroll = (e: Event) => {
        if (popoverRef && e.target instanceof Node && popoverRef.contains(e.target)) return;
        props.onClose();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    onCleanup(() => window.removeEventListener('scroll', onScroll, { capture: true }));

    const codeInfo = createMemo(() => {
        const info = indices.codeByGuid()[props.codeGuid];
        return info ? { code: info.code, codebook: info.codebook } : { code: null, codebook: undefined };
    });

    const handleChangeCode = (code: Code, codebook: Codebook) => {
        props.onChangeCode(code, codebook);
        setShowCodePicker(false);
    };

    const handleNoteChange = (e: Event) => {
        const target = e.currentTarget as HTMLTextAreaElement;
        const note = target.value.trim() === '' ? undefined : target.value;
        props.onNoteChange(note);
    };

    /** Codebook groups for the change-code picker, excluding the current code */
    const codebookGroups = createMemo(() => {
        const groups: InlineCodePickerGroup[] = [];
        for (const cb of indices.sortedCodebooks()) {
            const all = flattenCodesWithDepth(cb.codes);
            const filtered = all.filter(item => item.code.guid !== props.codeGuid);
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
            onClick={(e) => e.stopPropagation()}
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
                    {props.extraActions}
                    <button
                        class={styles.popoverActionBtn}
                        onClick={() => setShowCodePicker(!showCodePicker())}
                        title="Change code"
                    ><Icon name="arrow-switch" /></button>
                    <button
                        class={styles.popoverActionBtn}
                        onClick={() => props.onRemove()}
                        title="Remove this code"
                    ><Icon name="trash" /></button>
                </div>
            </div>
            <Show when={props.creatingUser}>
                <div class={styles.popoverUser}>
                    <span class={styles.popoverUserLabel}>Created by:</span>
                    <span class={styles.popoverUserName}>{props.creatingUser}</span>
                </div>
            </Show>
            <Show when={showCodePicker()}>
                <InlineCodePicker groups={codebookGroups()} mainCodebook={codeInfo().codebook} onSelect={handleChangeCode} />
            </Show>
            <textarea
                class={styles.popoverNote}
                placeholder="Add a note..."
                value={props.note || ''}
                onInput={handleNoteChange}
                rows={3}
            />
        </div>
    );
};

export default Popover;
