import octicons from '@primer/octicons';
import { type Component, Show, createMemo } from 'solid-js';
import styles from './HighlightPopover.module.css';
import ColorChip from './ColorChip';
import { findCode } from '../helpers';

interface HighlightPopoverProps {
    x: number;
    y: number;
    selection: TextSelection;
    codebooks: Codebook[];
    isExample: boolean;
    onRemoveCode: (selectionGuid: string) => void;
    onToggleExample: (selectionGuid: string) => void;
    onNoteChange: (selectionGuid: string, note: string) => void;
    onClick: (e: MouseEvent) => void;
}

const HighlightPopover: Component<HighlightPopoverProps> = (props) => {
    const codeInfo = createMemo(() => {
        const code = findCode(props.selection.code.codebookGuid, props.selection.code.codeGuid, props.codebooks);
        const codebook = props.codebooks.find(cb => cb.guid === props.selection.code.codebookGuid);
        return { code, codebook };
    });

    const handleRemoveCode = () => {
        props.onRemoveCode(props.selection.guid);
    };

    const handleToggleExample = () => {
        props.onToggleExample(props.selection.guid);
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
                    <ColorChip color={codeInfo().code?.color || '#888'} class={styles.popoverCodeColor} />
                    <span class={styles.popoverCodeName}>{codeInfo().code?.name || 'Unknown'}</span>
                    <Show when={codeInfo().codebook}>
                        <span class={styles.popoverCodeCodebook}>({codeInfo().codebook!.name})</span>
                    </Show>
                </div>
                <div class={styles.popoverActions}>
                    <button
                        class={styles.popoverActionBtn}
                        onClick={handleToggleExample}
                        title={props.isExample ? 'Remove as example' : 'Mark as example'}
                        innerHTML={props.isExample ? octicons['star-fill'].toSVG() : octicons.star.toSVG()}
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