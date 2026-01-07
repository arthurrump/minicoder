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
const UNDERLINE_GAP = 0.5;

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
 * Generate stacked underline styles using background layers.
 * Each underline is a discrete band of fixed height at a specific offset.
 * Uses global layer assignments for consistent offsets across segments.
 */
function getUnderlineStyle(
    segmentSelections: TextSelection[],
    selectionLayers: Map<string, number>,
    codeMap: Map<string, Code>,
    totalLayers: number
): Record<string, string> {
    if (segmentSelections.length === 0) {
        return {
            'padding-bottom': `${totalLayers * (UNDERLINE_HEIGHT + UNDERLINE_GAP)}px`,
        };
    }
    
    // Build background layers for each selection
    const images: string[] = [];
    const sizes: string[] = [];
    const positions: string[] = [];
    
    for (const sel of segmentSelections) {
        const code = codeMap.get(sel.code_guid);
        const color = code?.color || '#888';
        const layer = selectionLayers.get(sel.guid) ?? 0;
        // Offset from bottom: layer 0 (earliest) gets largest offset (furthest from text)
        const offsetFromBottom = (totalLayers - layer - 1) * (UNDERLINE_HEIGHT + UNDERLINE_GAP);
        
        // Each layer is a solid color gradient positioned as a discrete band
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

const TextView: Component<TextViewProps> = (props) => {
    const [popover, setPopover] = createSignal<{ x: number; y: number; segment: Segment } | null>(null);
    
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
    
    function handleSegmentClick(e: MouseEvent, segment: Segment) {
        if (segment.selections.length === 0) return;
        
        e.stopPropagation();
        setPopover({
            x: e.clientX,
            y: e.clientY,
            segment
        });
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
            <div id="text-view-content" onMouseUp={handleMouseUp}>
                <For each={segments()}>
                    {(segment) => (
                        <span
                            class={segment.selections.length > 0 ? 'highlighted-segment' : ''}
                            style={getUnderlineStyle(segment.selections, selectionLayers(), codeMap(), totalLayers())}
                            onClick={(e) => handleSegmentClick(e, segment)}
                        >
                            {segment.text}
                        </span>
                    )}
                </For>
            </div>
            
            <Show when={popover()}>
                {(p) => (
                    <div
                        class="highlight-popover"
                        style={{
                            left: `${p().x}px`,
                            top: `${p().y}px`
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div class="popover-header">Applied Codes</div>
                        <For each={p().segment.selections}>
                            {(sel) => {
                                const code = codeMap().get(sel.code_guid);
                                return (
                                    <div class="popover-code-item">
                                        <span
                                            class="popover-code-color"
                                            style={{ 'background-color': code?.color || '#888' }}
                                        />
                                        <span class="popover-code-name">{code?.name || 'Unknown'}</span>
                                        <button
                                            class="popover-remove-btn"
                                            onClick={() => handleRemoveCode(sel.guid)}
                                            title="Remove this code"
                                        >
                                            ×
                                        </button>
                                    </div>
                                );
                            }}
                        </For>
                    </div>
                )}
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
