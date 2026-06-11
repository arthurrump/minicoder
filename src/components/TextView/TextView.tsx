import { createMemo, createSignal, For, Show, type Component, createEffect } from 'solid-js';
import styles from './TextView.module.css';
import { SelectionPopover } from '../Popover';
import ColorChip from '../ColorChip';
import TextSegment from './TextSegment';
import SelectionHandles from './SelectionHandles';
import { useStore } from '../../store';
import { buildSegments } from '../../helpers';
import { computeSelectionLayers } from '../../utils/selections';
import {
    UNDERLINE_HEIGHT,
    UNDERLINE_GAP,
    getHoveredLayer,
    getSelectionAtLayer,
    getTextOffset,
} from '../../utils/textLayout';
import type { Code, Codebook, TextSelection } from '../../models/files';

interface TextViewProps {
    content: string;
    selections: TextSelection[];
    sourcePath: string;
    onSelectionCreate?: (start: number, end: number) => void;
    onSelectionUpdate?: (selectionGuid: string, start: number, end: number) => void;
    onSelectionClear?: () => void;
    selectedCode?: { code: Code; codebook: Codebook } | null;
    selectionUnderlineStyles?: Record<string, string>;
    /** GUIDs of selections that should not show resize handles (e.g. clipped or boundary selections) */
    nonResizableGuids?: Set<string>;
}

const TextView: Component<TextViewProps> = (props) => {
    const { indices } = useStore();
    const codeIndex = () => indices.codeByGuid();
    const [popover, setPopover] = createSignal<{ x: number; y: number; selection: TextSelection } | null>(null);
    const [hoveredSelectionGuid, setHoveredSelectionGuid] = createSignal<string | null>(null);
    const [activeSelectionGuid, setActiveSelectionGuid] = createSignal<string | null>(null);
    const [draggingHandle, setDraggingHandle] = createSignal<'start' | 'end' | null>(null);
    const [mousePosition, setMousePosition] = createSignal<{ x: number; y: number } | null>(null);
    
    let containerRef: HTMLElement | null = null;
    
    // Store refs to all segment elements, keyed by segment index
    const segmentElements = new Map<number, HTMLSpanElement>();
    
    const segments = createMemo(() => buildSegments(props.selections, props.content));
    
    // Close popover if the active selection disappears from the selections list
    // (e.g. when toggling example status moves a selection between groups)
    createEffect(() => {
        const p = popover();
        if (p && !props.selections.some(s => s.guid === p.selection.guid)) {
            setPopover(null);
            setActiveSelectionGuid(null);
        }
    });


    // Compute global layer assignments for consistent underline offsets
    const layerInfo = createMemo(() => computeSelectionLayers(props.selections));
    const selectionLayers = createMemo(() => layerInfo().layers);
    const totalLayers = createMemo(() => layerInfo().maxLayer);
    
    /**
     * Find which segment and selection (if any) is under the mouse at the given underline position.
     * Checks all segments' rects to handle overlapping inline elements correctly.
     */
    function findHoveredSelection(clientX: number, clientY: number): TextSelection | null {
        const paddingHeight = totalLayers() * (UNDERLINE_HEIGHT + UNDERLINE_GAP);
        const segs = segments();
        
        for (let segIdx = 0; segIdx < segs.length; segIdx++) {
            const segment = segs[segIdx];
            if (segment.selections.length === 0) continue;
            
            const element = segmentElements.get(segIdx);
            if (!element) continue;
            
            const rects = element.getClientRects();
            
            for (const rect of rects) {
                // Check horizontal bounds
                if (clientX < rect.left || clientX > rect.right) continue;
                
                // Check if in underline area (bottom paddingHeight pixels of rect)
                const underlineTop = rect.bottom - paddingHeight;
                if (clientY >= underlineTop && clientY <= rect.bottom) {
                    const yFromBottom = rect.bottom - clientY;
                    const hoveredLayer = getHoveredLayer(yFromBottom, totalLayers());
                    
                    if (hoveredLayer >= 0) {
                        const selection = getSelectionAtLayer(segment.selections, selectionLayers(), hoveredLayer);
                        if (selection) {
                            return selection;
                        }
                    }
                }
            }
        }
        
        return null;
    }
    
    function handleContainerMouseMove(e: MouseEvent) {
        const selection = findHoveredSelection(e.clientX, e.clientY);
        setHoveredSelectionGuid(selection?.guid ?? null);
        setMousePosition({ x: e.clientX, y: e.clientY });
    }
    
    function handleContainerMouseLeave() {
        setHoveredSelectionGuid(null);
        setMousePosition(null);
    }
    
    function handleContainerClick(e: MouseEvent) {
        const selection = findHoveredSelection(e.clientX, e.clientY);
        if (selection) {
            e.stopPropagation();
            // Set this selection as active (shows handles)
            setActiveSelectionGuid(selection.guid);
            // Always update popover, even if clicking a different selection
            setPopover({
                x: e.clientX,
                y: e.clientY,
                selection
            });
        } else {
            // Check if there's a text selection being made - don't clear it
            const browserSelection = window.getSelection();
            if (browserSelection && !browserSelection.isCollapsed) {
                // User just finished selecting text, don't propagate to background
                e.stopPropagation();
            }
            // Clicked outside any underline, close popover and deactivate
            setPopover(null);
            setActiveSelectionGuid(null);
        }
    }
    
    function handleBackgroundClick() {
        setPopover(null);
        setActiveSelectionGuid(null);
        props.onSelectionClear?.();
    }
    
    function handleMouseUp() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            props.onSelectionClear?.();
            return;
        }
        
        const range = selection.getRangeAt(0);
        const container = containerRef;
        if (!container) return;
        
        // Calculate the character offsets within the text content
        const start = getTextOffset(container, range.startContainer, range.startOffset);
        const end = getTextOffset(container, range.endContainer, range.endOffset);
        
        if (start !== null && end !== null && start !== end) {
            props.onSelectionCreate?.(Math.min(start, end), Math.max(start, end));
            // Don't clear the selection - keep it visible until user clicks a code
        }
    }
    
    // Get the active selection object
    const activeSelection = createMemo(() => {
        const guid = activeSelectionGuid();
        if (!guid) return null;
        return props.selections.find(s => s.guid === guid) ?? null;
    });

    const hoveredSelection = createMemo(() => {
        const guid = hoveredSelectionGuid();
        if (!guid) return null;
        return props.selections.find(s => s.guid === guid) ?? null;
    });

    const hoveredSelectionDetails = createMemo(() => {
        const selection = hoveredSelection();
        if (!selection) return null;

        const info = codeIndex()[selection.code.codeGuid];
        return {
            codeName: info?.code.name ?? 'Unknown code',
            codebookName: info?.codebook.name ?? 'Unknown codebook',
            note: selection.note?.trim(),
        };
    });
    
    // Handle resize drag
    function handleDragStart(handle: 'start' | 'end') {
        setDraggingHandle(handle);
        setPopover(null); // Close popover while dragging
    }
    
    function handleDragMove(charIndex: number) {
        const sel = activeSelection();
        const handle = draggingHandle();
        if (!sel || !handle) return;
        
        // Limit jump distance to prevent wild jumps from bad caret detection
        // Allow larger jumps only if moving in a consistent direction
        const currentPos = handle === 'start' ? sel.start : sel.end;
        const maxJump = 50; // Maximum characters to jump in one move
        
        if (Math.abs(charIndex - currentPos) > maxJump) {
            // If jump is too large, only move by maxJump in that direction
            if (charIndex > currentPos) {
                charIndex = currentPos + maxJump;
            } else {
                charIndex = currentPos - maxJump;
            }
        }
        
        let newStart = sel.start;
        let newEnd = sel.end;
        
        if (handle === 'start') {
            newStart = Math.min(charIndex, sel.end - 1);
            newStart = Math.max(0, newStart);
        } else {
            newEnd = Math.max(charIndex, sel.start + 1);
            newEnd = Math.min(props.content.length, newEnd);
        }
        
        if (newStart !== sel.start || newEnd !== sel.end) {
            props.onSelectionUpdate?.(sel.guid, newStart, newEnd);
        }
    }
    
    function handleDragEnd() {
        setDraggingHandle(null);
    }
    
    return (
        <div class={styles.textDisplay} onClick={handleBackgroundClick}>
            <div 
                class={styles.textViewContent}
                ref={(el) => containerRef = el}
                style={{
                    cursor: hoveredSelectionGuid() ? 'pointer' : 'inherit',
                    'padding-bottom': `${totalLayers() * (UNDERLINE_HEIGHT + UNDERLINE_GAP)}px`,
                }}
                onMouseUp={handleMouseUp}
                onMouseMove={handleContainerMouseMove}
                onMouseLeave={handleContainerMouseLeave}
                onClick={handleContainerClick}
            >
                <For each={segments()}>
                    {(segment, index) => (
                        <TextSegment
                            segment={segment}
                            selectionLayers={selectionLayers()}
                            codeIndex={codeIndex()}
                            totalLayers={totalLayers()}
                            hoveredSelectionGuid={hoveredSelectionGuid()}
                            selectionUnderlineStyles={props.selectionUnderlineStyles}
                            segmentRef={(el) => {
                                if (el) {
                                    segmentElements.set(index(), el);
                                } else {
                                    segmentElements.delete(index());
                                }
                            }}
                        />
                    )}
                </For>
                
                {/* Render handles for active selection (if resizable) */}
                <Show when={(() => {
                    const sel = activeSelection();
                    if (!sel) return null;
                    if (props.nonResizableGuids?.has(sel.guid)) return null;
                    return sel;
                })()}>
                    {(sel) => (
                        <SelectionHandles
                            selection={sel()}
                            segments={segments()}
                            segmentElements={segmentElements}
                            containerRef={containerRef}
                            codeIndex={codeIndex()}
                            onDragStart={handleDragStart}
                            onDragMove={handleDragMove}
                            onDragEnd={handleDragEnd}
                            draggingHandle={draggingHandle()}
                        />
                    )}
                </Show>
            </div>
        
            <Show when={popover()}>
                {(p) => {
                    const liveSelection = createMemo(() =>
                        props.selections.find(s => s.guid === p().selection.guid) ?? p().selection
                    );
                    return (
                        <SelectionPopover
                            x={p().x}
                            y={p().y}
                            onClose={() => {
                                setPopover(null);
                                if (!draggingHandle()) setActiveSelectionGuid(null);
                            }}
                            sourcePath={props.sourcePath}
                            selection={liveSelection()}
                        />
                    );
                }}
            </Show>

            <Show when={hoveredSelectionDetails()}>
                {(details) => (
                    <Show when={mousePosition()}>
                        {(mousePos) => (
                            <div
                                class={styles.hoverTooltip}
                                style={{
                                    left: `${mousePos().x + 12}px`,
                                    top: `${mousePos().y + 12}px`
                                }}
                            >
                                <div class={styles.hoverTooltipMain}>{details().codeName}</div>
                                <div class={styles.hoverTooltipMeta}>{details().codebookName}</div>
                                <Show when={details().note}>
                                    <div class={styles.hoverTooltipNote}>{details().note}</div>
                                </Show>
                            </div>
                        )}
                    </Show>
                )}
            </Show>
            
            {/* Cursor chip when a code is selected and mouse is in this TextView */}
            <Show when={props.selectedCode && mousePosition()}>
                <div
                    class={styles.cursorChip}
                    style={{
                        left: `${mousePosition()!.x - 16}px`,
                        top: `${mousePosition()!.y}px`
                    }}
                >
                    <ColorChip color={props.selectedCode!.code.color} class={styles.cursorChipInner} />
                </div>
            </Show>
        </div>
    );
};

export default TextView;
