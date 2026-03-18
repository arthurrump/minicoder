import { createMemo, createSignal, Show, type Component, onMount, onCleanup, createEffect } from 'solid-js';
import styles from './TextView.module.css';
import { type Segment } from '../../helpers';
import { type HandlePosition, getHandlePositions, getCharIndexFromPoint } from '../../utils/textLayout';
import type { Code, Codebook, TextSelection } from '../../models/files';

export interface SelectionHandlesProps {
    selection: TextSelection;
    segments: Segment[];
    segmentElements: Map<number, HTMLSpanElement>;
    containerRef: HTMLElement | null;
    codeIndex: Record<string, { code: Code; codebook: Codebook }>;
    onDragStart: (handle: 'start' | 'end') => void;
    onDragMove: (charIndex: number) => void;
    onDragEnd: () => void;
    draggingHandle: 'start' | 'end' | null;
}

/**
 * Renders draggable handles at the start and end of an active selection.
 */
const SelectionHandles: Component<SelectionHandlesProps> = (props) => {
    const [positions, setPositions] = createSignal<{ start: HandlePosition | null; end: HandlePosition | null }>({ start: null, end: null });
    
    // Get the color for this selection's code
    const codeColor = createMemo(() => {
        const info = props.codeIndex[props.selection.code.codeGuid];
        return info?.code.color ?? '#007acc';
    });
    
    // Update handle positions when selection or layout changes
    const updatePositions = () => {
        const pos = getHandlePositions(
            props.selection,
            props.segments,
            props.segmentElements,
            props.containerRef
        );
        setPositions(pos);
    };
    
    // Update on mount and when dependencies change
    createEffect(() => {
        // Track dependencies
        props.selection;
        props.segments;
        updatePositions();
    });
    
    // Also update on resize
    onMount(() => {
        window.addEventListener('resize', updatePositions);
        onCleanup(() => window.removeEventListener('resize', updatePositions));
    });
    
    const handlePointerDown = (handle: 'start' | 'end', e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
        props.onDragStart(handle);
    };
    
    const handlePointerMove = (e: PointerEvent) => {
        if (!props.draggingHandle) return;
        
        // Find character index at mouse position
        const charIndex = getCharIndexFromPoint(e.clientX, e.clientY, props.containerRef);
        if (charIndex !== null) {
            props.onDragMove(charIndex);
        }
    };
    
    const handlePointerUp = (e: PointerEvent) => {
        if (props.draggingHandle) {
            (e.target as Element).releasePointerCapture(e.pointerId);
            props.onDragEnd();
        }
    };
    
    return (
        <>
            <Show when={positions().start}>
                {(pos) => (
                    <div
                        class={`${styles.selectionHandle} ${props.draggingHandle === 'start' ? styles.dragging : ''} ${styles.selectionHandleStart}`}
                        style={{
                            left: `${pos().x}px`,
                            top: `${pos().y}px`,
                            height: `${pos().height}px`,
                            'background-color': codeColor()
                        }}
                        onPointerDown={(e) => handlePointerDown('start', e)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                    />
                )}
            </Show>
            <Show when={positions().end}>
                {(pos) => (
                    <div
                        class={`${styles.selectionHandle} ${props.draggingHandle === 'end' ? styles.dragging : ''}`}
                        style={{
                            left: `${pos().x}px`,
                            top: `${pos().y}px`,
                            height: `${pos().height}px`,
                            'background-color': codeColor()
                        }}
                        onPointerDown={(e) => handlePointerDown('end', e)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                    />
                )}
            </Show>
        </>
    );
};

export default SelectionHandles;
