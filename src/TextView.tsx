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

/**
 * Generate stacked underline styles using box-shadows
 */
function getUnderlineStyle(selections: TextSelection[], codes: Code[]): Record<string, string> {
    if (selections.length === 0) return {};
    
    const codeMap = new Map<string, Code>();
    const collectCodes = (codeList: Code[]) => {
        for (const code of codeList) {
            codeMap.set(code.guid, code);
            if (code.subcodes) {
                collectCodes(code.subcodes);
            }
        }
    };
    collectCodes(codes);
    
    // Sort by start position: later starts get smaller offsets (bottom), earlier starts get larger offsets (top)
    const sortedSelections = [...selections].sort((a, b) => b.start - a.start);
    
    // Build stacked underlines using box-shadow
    const underlineHeight = 3;
    const gap = 1;
    const shadows: string[] = [];
    
    for (let i = 0; i < sortedSelections.length; i++) {
        const sel = sortedSelections[i];
        const code = codeMap.get(sel.code_guid);
        const color = code?.color || '#888';
        const offset = (i + 1) * (underlineHeight + gap);
        shadows.push(`inset 0 -${offset}px 0 0 ${color}`);
    }
    
    return {
        'box-shadow': shadows.join(', '),
        'padding-bottom': `${selections.length * (underlineHeight + gap)}px`,
    };
}

const TextView: Component<TextViewProps> = (props) => {
    const [popover, setPopover] = createSignal<{ x: number; y: number; segment: Segment } | null>(null);
    
    const segments = createMemo(() => buildSegments(props.content, props.selections));
    
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
                            style={getUnderlineStyle(segment.selections, props.codes)}
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
