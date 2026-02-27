import octicons from '@primer/octicons';
import { createMemo, createSignal, For, Show, type Component, onMount, onCleanup, createEffect } from 'solid-js';
import styles from './TextView.module.css';
import HighlightPopover from './HighlightPopover';
import ColorChip from './ColorChip';
import { useStore } from '../store';
import { buildSegments, type Segment } from '../helpers';

interface TextViewProps {
    content: string;
    selections: TextSelection[];
    onSelectionCreate?: (start: number, end: number) => void;
    onSelectionRemove?: (selectionGuid: string) => void;
    onSelectionUpdate?: (selectionGuid: string, start: number, end: number, note?: string) => void;
    onToggleExample?: (selectionGuid: string) => void;
    onChangeCode?: (selectionGuid: string, newCode: CodeReference) => void;
    onSelectionClear?: () => void;
    selectedCode?: { code: Code; codebook: Codebook } | null;
}

interface HandlePosition {
    x: number;
    y: number;
    height: number;
}

const UNDERLINE_HEIGHT = 4;
const UNDERLINE_GAP = 1;

/**
 * Compute a global layer index for each selection using greedy interval coloring.
 * Each selection gets the lowest layer index that doesn't conflict with overlapping selections.
 * This minimizes the total number of layers needed.
 */
function computeSelectionLayers(selections: TextSelection[]): { layers: Map<string, number>; maxLayer: number } {
    if (selections.length === 0) {
        return { layers: new Map(), maxLayer: 0 };
    }
    
    // Selections are kept sorted by start position in the store
    const sorted = selections;
    
    const layers = new Map<string, number>();
    // Track which selections are assigned to each layer (for overlap checking)
    const layerAssignments: TextSelection[][] = [];
    
    for (const sel of sorted) {
        // Find the lowest layer where this selection doesn't overlap with existing assignments
        let assignedLayer = 0;
        
        while (true) {
            // Ensure layer array exists
            if (!layerAssignments[assignedLayer]) {
                layerAssignments[assignedLayer] = [];
            }
            
            // Check if this selection overlaps with any selection already in this layer
            const hasConflict = layerAssignments[assignedLayer].some(
                existing => sel.start < existing.end && sel.end > existing.start
            );
            
            if (!hasConflict) {
                // Found a free layer
                break;
            }
            
            // Try next layer
            assignedLayer++;
        }
        
        layers.set(sel.guid, assignedLayer);
        layerAssignments[assignedLayer].push(sel);
    }
    
    return { 
        layers, 
        maxLayer: layerAssignments.length 
    };
}

/**
 * Lighten a color by mixing it with white.
 */
function lightenColor(color: string, amount: number = 0.3): string {
    // Handle hex colors
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        
        const lightenChannel = (c: number) => Math.round(c + (255 - c) * amount);
        
        const lr = lightenChannel(r).toString(16).padStart(2, '0');
        const lg = lightenChannel(g).toString(16).padStart(2, '0');
        const lb = lightenChannel(b).toString(16).padStart(2, '0');
        
        return `#${lr}${lg}${lb}`;
    }
    return color;
}

/**
 * Given mouse Y position relative to element bottom, determine which layer is being hovered.
 * Returns the layer index, or -1 if not over any underline.
 */
function getHoveredLayer(yFromBottom: number, totalLayers: number): number {
    if (yFromBottom < 0) return -1;
    
    const layerHeight = UNDERLINE_HEIGHT + UNDERLINE_GAP;
    const totalHeight = totalLayers * layerHeight;
    
    if (yFromBottom > totalHeight) return -1;
    
    // Layer 0 is at the top (furthest from text), higher layers are closer to text
    const layerFromBottom = Math.floor(yFromBottom / layerHeight);
    // Convert to layer index (0 = furthest from text)
    return totalLayers - 1 - layerFromBottom;
}

/**
 * Find which selection is at the given layer within a segment's selections.
 */
function getSelectionAtLayer(
    segmentSelections: TextSelection[],
    selectionLayers: Map<string, number>,
    targetLayer: number
): TextSelection | null {
    for (const sel of segmentSelections) {
        if (selectionLayers.get(sel.guid) === targetLayer) {
            return sel;
        }
    }
    return null;
}

/**
 * Generate stacked underline styles using background layers.
 * Each underline is a discrete band of fixed height at a specific offset.
 * Applies hover lightening to the hovered selection.
 */
function getUnderlineStyle(
    segmentSelections: TextSelection[],
    selectionLayers: Map<string, number>,
    codeIndex: Record<string, { code: Code; codebook: Codebook }>,
    totalLayers: number,
    hoveredSelectionGuid: string | null
): Record<string, string> {
    if (segmentSelections.length === 0) {
        return {
            'padding-bottom': `${totalLayers * (UNDERLINE_HEIGHT + UNDERLINE_GAP)}px`,
        };
    }
    
    // Build background layers for each selection, sorted by layer for consistent ordering
    const layerData: { layer: number; sel: TextSelection }[] = [];
    for (const sel of segmentSelections) {
        const layer = selectionLayers.get(sel.guid) ?? 0;
        layerData.push({ layer, sel });
    }
    // Sort by layer ascending
    layerData.sort((a, b) => a.layer - b.layer);
    
    const images: string[] = [];
    const sizes: string[] = [];
    const positions: string[] = [];
    
    for (const { layer, sel } of layerData) {
        const info = codeIndex[sel.code.codeGuid];
        let color = info?.code.color || '#888';
        
        // Apply hover effect
        if (sel.guid === hoveredSelectionGuid) {
            color = lightenColor(color);
        }
        
        // Offset from bottom: layer 0 gets largest offset (furthest from text)
        const offsetFromBottom = (totalLayers - layer - 1) * (UNDERLINE_HEIGHT + UNDERLINE_GAP);
        
        images.push(`linear-gradient(${color}, ${color})`);
        sizes.push(`100% ${UNDERLINE_HEIGHT}px`);
        positions.push(`bottom ${offsetFromBottom}px left`);
    }
    
    return {
        'background-image': images.join(', '),
        'background-size': sizes.join(', '),
        'background-position': positions.join(', '),
        'background-repeat': 'no-repeat',
        'padding-bottom': `${totalLayers * (UNDERLINE_HEIGHT + UNDERLINE_GAP)}px`,
        'line-height': `calc(1.2em + ${layerData.length * (UNDERLINE_HEIGHT + UNDERLINE_GAP)}px)`
    };
}

interface TextSegmentProps {
    segment: Segment;
    selectionLayers: Map<string, number>;
    codeIndex: Record<string, { code: Code; codebook: Codebook }>;
    totalLayers: number;
    hoveredSelectionGuid: string | null;
    segmentRef: (el: HTMLSpanElement) => void;
}

/**
 * A text segment with background-based underlines.
 * Hit detection is handled at the container level.
 */
const TextSegment: Component<TextSegmentProps> = (props) => {
    return (
        <span
            ref={props.segmentRef}
            class={styles.textSegment}
            data-segment-start={props.segment.start}
            data-segment-end={props.segment.end}
            style={getUnderlineStyle(
                props.segment.selections,
                props.selectionLayers,
                props.codeIndex,
                props.totalLayers,
                props.hoveredSelectionGuid
            )}
        >
            {props.segment.text}
        </span>
    );
};

interface SelectionHandlesProps {
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
 * Calculate positions for start and end handles of a selection.
 */
function getHandlePositions(
    selection: TextSelection,
    segments: Segment[],
    segmentElements: Map<number, HTMLSpanElement>,
    containerRef: HTMLElement | null
): { start: HandlePosition | null; end: HandlePosition | null } {
    if (!containerRef) return { start: null, end: null };
    
    const containerRect = containerRef.getBoundingClientRect();
    
    let startPos: HandlePosition | null = null;
    let endPos: HandlePosition | null = null;
    
    // Find segments containing this selection
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const el = segmentElements.get(i);
        if (!el) continue;
        
        const containsSelection = segment.selections.some(s => s.guid === selection.guid);
        if (!containsSelection) continue;
        
        const rects = el.getClientRects();
        if (rects.length === 0) continue;
        
        // Check if this segment contains the start of the selection
        if (segment.start === selection.start) {
            const firstRect = rects[0];
            startPos = {
                x: firstRect.left - containerRect.left,
                y: firstRect.top - containerRect.top,
                height: firstRect.height
            };
        }
        
        // Check if this segment contains the end of the selection
        if (segment.end === selection.end) {
            const lastRect = rects[rects.length - 1];
            endPos = {
                x: lastRect.right - containerRect.left,
                y: lastRect.top - containerRect.top,
                height: lastRect.height
            };
        }
    }
    
    return { start: startPos, end: endPos };
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
                        class={`${styles.selectionHandle} ${props.draggingHandle === 'end' ? styles.dragging : ''} ${styles.selectionHandleEnd}`}
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

/**
 * Get the character index at a given screen position.
 * Tries multiple Y positions to handle cases where the cursor is in padding/margins.
 */
function getCharIndexFromPoint(clientX: number, clientY: number, container: HTMLElement | null): number | null {
    if (!container) return null;
    
    const containerRect = container.getBoundingClientRect();
    
    // Clamp X to container bounds
    const clampedX = Math.max(containerRect.left + 1, Math.min(containerRect.right - 1, clientX));
    
    // Try multiple Y positions - the cursor might be in padding/underline area
    const yPositionsToTry = [
        clientY,
        clientY - 10,  // Try a bit higher (in case we're in underline area)
        clientY - 20,
        clientY + 10,  // Try a bit lower
    ];
    
    for (const tryY of yPositionsToTry) {
        // Clamp Y to container bounds
        const clampedY = Math.max(containerRect.top + 1, Math.min(containerRect.bottom - 1, tryY));
        
        const result = getCaretPositionAt(clampedX, clampedY, container);
        if (result !== null) {
            return result;
        }
    }
    
    return null;
}

/**
 * Get caret position at exact coordinates.
 */
function getCaretPositionAt(clientX: number, clientY: number, container: HTMLElement): number | null {
    // Use caretPositionFromPoint (standard) or caretRangeFromPoint (WebKit)
    let range: Range | null = null;
    
    if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(clientX, clientY);
        if (pos && container.contains(pos.offsetNode)) {
            range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
        }
    } else if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(clientX, clientY);
        // Verify the range is within our container
        if (range && !container.contains(range.startContainer)) {
            range = null;
        }
    }
    
    if (!range) return null;
    
    // Calculate offset from container start
    return getTextOffset(container, range.startContainer, range.startOffset);
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
    let lastValidDragPosition: number | null = null;
    
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
        // Track mouse position for cursor chip when a code is selected
        if (props.selectedCode) {
            setMousePosition({ x: e.clientX, y: e.clientY });
        }
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
    
    function handleRemoveCode(selectionGuid: string) {
        props.onSelectionRemove?.(selectionGuid);
        setPopover(null);
        setActiveSelectionGuid(null);
    }
    
    // Get the active selection object
    const activeSelection = createMemo(() => {
        const guid = activeSelectionGuid();
        if (!guid) return null;
        return props.selections.find(s => s.guid === guid) ?? null;
    });
    
    // Handle resize drag
    function handleDragStart(handle: 'start' | 'end') {
        setDraggingHandle(handle);
        setPopover(null); // Close popover while dragging
        
        // Initialize last valid position based on which handle we're dragging
        const sel = activeSelection();
        if (sel) {
            lastValidDragPosition = handle === 'start' ? sel.start : sel.end;
        }
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
            lastValidDragPosition = handle === 'start' ? newStart : newEnd;
            props.onSelectionUpdate?.(sel.guid, newStart, newEnd, sel.note);
        }
    }
    
    function handleDragEnd() {
        setDraggingHandle(null);
        lastValidDragPosition = null;
    }
    
    function handleNoteChange(selectionGuid: string, note: string) {
        const sel = activeSelection();
        if (!sel) return;
        
        // Convert empty string to undefined
        const noteValue = note.trim() === '' ? undefined : note;
        props.onSelectionUpdate?.(selectionGuid, sel.start, sel.end, noteValue);
    }
    
    return (
        <div class={styles.textDisplay} onClick={handleBackgroundClick}>
            <div 
                class={styles.textViewContent}
                ref={(el) => containerRef = el}
                style={{ cursor: hoveredSelectionGuid() ? 'pointer' : 'inherit' }}
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
                
                {/* Render handles for active selection */}
                <Show when={activeSelection()}>
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
                    const isExample = createMemo(() => {
                        const sel = liveSelection();
                        const info = codeIndex()[sel.code.codeGuid];
                        return info?.code.examples?.some(ex => ex.textSelectionGuid === sel.guid) ?? false;
                    });
                    return (
                        <HighlightPopover
                            x={p().x}
                            y={p().y}
                            selection={liveSelection()}
                            isExample={isExample()}
                            onRemoveCode={handleRemoveCode}
                            onToggleExample={(selectionGuid) => props.onToggleExample?.(selectionGuid)}
                            onNoteChange={handleNoteChange}
                            onChangeCode={(selectionGuid, newCode) => props.onChangeCode?.(selectionGuid, newCode)}
                            onClick={(e: MouseEvent) => e.stopPropagation()}
                        />
                    );
                }}
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

/**
 * Calculate the character offset from the start of the container to the given node/offset
 */
function getTextOffset(container: Node, targetNode: Node, targetOffset: number): number | null {
    let offset = 0;
    
    function walk(node: Node): boolean {
        if (node === targetNode) {
            if (node.nodeType === Node.TEXT_NODE) {
                offset += targetOffset;
            }
            return true;
        }
        
        if (node.nodeType === Node.TEXT_NODE) {
            offset += node.textContent?.length || 0;
        } else {
            for (const child of Array.from(node.childNodes)) {
                if (walk(child)) return true;
            }
        }
        
        return false;
    }
    
    if (walk(container)) {
        return offset;
    }
    return null;
}

export default TextView;
