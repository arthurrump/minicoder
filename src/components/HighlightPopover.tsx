import octicons from '@primer/octicons';
import { type Component, Show, createMemo } from 'solid-js';
import styles from './HighlightPopover.module.css';
import ColorChip from './ColorChip';

interface CodeWithCodebook {
    code: Code;
    codebook: Codebook;
}

interface HighlightPopoverProps {
    x: number;
    y: number;
    selection: TextSelection;
    codeMap: Map<string, CodeWithCodebook>;
    onRemoveCode: (selectionGuid: string) => void;
    onNoteChange: (selectionGuid: string, note: string) => void;
    onClick: (e: MouseEvent) => void;
}

const HighlightPopover: Component<HighlightPopoverProps> = (props) => {
    const codeInfo = createMemo(() => props.codeMap.get(props.selection.code.codeGuid));

    const handleRemoveCode = () => {
        props.onRemoveCode(props.selection.guid);
    };

    const handleNoteChange = (e: Event) => {
        const target = e.currentTarget as HTMLTextAreaElement;
        props.onNoteChange(props.selection.guid, target.value);
    };

    return (
        <div
            class={styles.highlightPopover}
            style={{ left: `${props.x}px`, top: `${props.y}px` }}
            onClick={props.onClick}
        >
            <div class={styles.popoverHeader}>
                <div class={styles.popoverCodeItem}>
                    <ColorChip color={codeInfo()?.code.color || '#888'} class={styles.popoverCodeColor} />
                    <span class={styles.popoverCodeName}>{codeInfo()?.code.name || 'Unknown'}</span>
                    <Show when={codeInfo()?.codebook}>
                        <span class={styles.popoverCodeCodebook}>({codeInfo()!.codebook.name})</span>
                    </Show>
                </div>
                <button
                    class={styles.popoverRemoveBtn}
                    onClick={handleRemoveCode}
                    title="Remove this code"
                    innerHTML={octicons.trash.toSVG()}
                />
            </div>
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