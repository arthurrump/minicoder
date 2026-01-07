import { createMemo, createSignal, For, Show, type Component } from 'solid-js';

interface TextViewProps {
    content: string;
    selections: TextSelection[];
    codes: Code[];
    onSelectionCreate?: (start: number, end: number) => void;
    onSelectionRemove?: (selectionGuid: string) => void;
    onSelectionUpdate?: (selectionGuid: string, start: number, end: number) => void;
}

interface Segment {
    start: number;
    end: number;
    text: string;
    selections: TextSelection[];
}

/**
 * Build a list of atomic segments from overlapping selections.
 * Each segment has a unique combination of applied codes.
 */
function buildSegments(content: string, selections: TextSelection[]): Segment[] {
    if (!content) return [];
    
    // Collect all boundary points
    const points = new Set<number>();
    points.add(0);
    points.add(content.length);
    
    for (const sel of selections) {
        if (sel.start >= 0 && sel.start <= content.length) {
            points.add(sel.start);
        }
        if (sel.end >= 0 && sel.end <= content.length) {
            points.add(sel.end);
        }
    }
    
    // Sort points
    const sortedPoints = Array.from(points).sort((a, b) => a - b);
    
    // Build segments between consecutive points
    const segments: Segment[] = [];
    for (let i = 0; i < sortedPoints.length - 1; i++) {
        const start = sortedPoints[i];
        const end = sortedPoints[i + 1];
        
        // Find which selections cover this segment
        const coveringSelections = selections.filter(
            sel => sel.start <= start && sel.end >= end
        );
        
        segments.push({
            start,
            end,
            text: content.slice(start, end),
            selections: coveringSelections
        });
    }
    
    return segments;
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
    
    // Sort by start position, then by end position for stability
    const sorted = [...selections].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return a.end - b.end;
    });
    
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
    codeMap: Map<string, Code>,
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
        const code = codeMap.get(sel.code_guid);
        let color = code?.color || '#888';
        
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
    };
}

interface TextSegmentProps {
    segment: Segment;
    selectionLayers: Map<string, number>;
    codeMap: Map<string, Code>;
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
            class="text-segment"
            data-segment-start={props.segment.start}
            data-segment-end={props.segment.end}
            style={getUnderlineStyle(
                props.segment.selections,
                props.selectionLayers,
                props.codeMap,
                props.totalLayers,
                props.hoveredSelectionGuid
            )}
        >
            {props.segment.text}
        </span>
    );
};

const TextView: Component<TextViewProps> = (props) => {
    const [popover, setPopover] = createSignal<{ x: number; y: number; selection: TextSelection } | null>(null);
    const [hoveredSelectionGuid, setHoveredSelectionGuid] = createSignal<string | null>(null);
    
    // Store refs to all segment elements, keyed by segment index
    const segmentElements = new Map<number, HTMLSpanElement>();
    
    const segments = createMemo(() => buildSegments(props.content, props.selections));
    
    // Compute global layer assignments for consistent underline offsets
    const layerInfo = createMemo(() => computeSelectionLayers(props.selections));
    const selectionLayers = createMemo(() => layerInfo().layers);
    const totalLayers = createMemo(() => layerInfo().maxLayer);
    
    // Build a map of code_guid -> Code for quick lookup
    const codeMap = createMemo(() => {
        const map = new Map<string, Code>();
        const collectCodes = (codeList: Code[]) => {
            for (const code of codeList) {
                map.set(code.guid, code);
                if (code.subcodes) {
                    collectCodes(code.subcodes);
                }
            }
        };
        collectCodes(props.codes);
        return map;
    });
    
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
    }
    
    function handleContainerMouseLeave() {
        setHoveredSelectionGuid(null);
    }
    
    function handleContainerClick(e: MouseEvent) {
        const selection = findHoveredSelection(e.clientX, e.clientY);
        if (selection) {
            e.stopPropagation();
            setPopover({
                x: e.clientX,
                y: e.clientY,
                selection
            });
        }
    }
    
    function handleBackgroundClick() {
        setPopover(null);
    }
    
    function handleMouseUp() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        
        const range = selection.getRangeAt(0);
        const container = document.getElementById('text-view-content');
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
    }
    
    return (
        <div id="textDisplay" onClick={handleBackgroundClick}>
            <div 
                id="text-view-content" 
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
                            codeMap={codeMap()}
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
            </div>
        
            <Show when={popover()}>
                {(p) => {
                    const code = codeMap().get(p().selection.code_guid);
                    return (
                        <div
                            class="highlight-popover"
                            style={{
                                left: `${p().x}px`,
                                top: `${p().y}px`
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div class="popover-header">Applied Code</div>
                            <div class="popover-code-item">
                                <span
                                    class="popover-code-color"
                                    style={{ 'background-color': code?.color || '#888' }}
                                />
                                <span class="popover-code-name">{code?.name || 'Unknown'}</span>
                                <button
                                    class="popover-remove-btn"
                                    onClick={() => handleRemoveCode(p().selection.guid)}
                                    title="Remove this code"
                                >
                                    ×
                                </button>
                            </div>
                        </div>
                    );
                }}
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
