import { lightenColor } from './colors';
import type { Segment } from '../helpers';

export const UNDERLINE_HEIGHT = 4;
export const UNDERLINE_GAP = 1;

export interface HandlePosition {
    x: number;
    y: number;
    height: number;
}

/**
 * Given mouse Y position relative to element bottom, determine which layer is being hovered.
 * Returns the layer index, or -1 if not over any underline.
 */
export function getHoveredLayer(yFromBottom: number, totalLayers: number): number {
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
export function getSelectionAtLayer(
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
export function getUnderlineStyle(
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

/**
 * Calculate positions for start and end handles of a selection.
 */
export function getHandlePositions(
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
 * Get the character index at a given screen position.
 * Tries multiple Y positions to handle cases where the cursor is in padding/margins.
 */
export function getCharIndexFromPoint(clientX: number, clientY: number, container: HTMLElement | null): number | null {
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

/**
 * Calculate the character offset from the start of the container to the given node/offset
 */
export function getTextOffset(container: Node, targetNode: Node, targetOffset: number): number | null {
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

/**
 * Scroll a container so that the text at `charOffset` is visible.
 * Finds the segment span whose range contains the offset using the
 * data-segment-start/end attributes already on each span, then
 * scrolls it into view near the top of the container.
 */
export function scrollToCharOffset(container: HTMLElement, _content: string, charOffset: number) {
  // Find the segment span that contains this character offset
  const spans = container.querySelectorAll<HTMLSpanElement>('[data-segment-start]');
  let target: HTMLSpanElement | null = null;
  for (const span of spans) {
    const start = Number(span.dataset.segmentStart);
    const end = Number(span.dataset.segmentEnd);
    if (charOffset >= start && charOffset < end) {
      target = span;
      break;
    }
  }
  // Fall back to the nearest span before the offset
  if (!target && spans.length > 0) {
    for (const span of spans) {
      const start = Number(span.dataset.segmentStart);
      if (start <= charOffset) target = span;
      else break;
    }
  }
  if (target) {
    target.scrollIntoView({ block: 'start' });
    // Nudge up so the target isn't pinned to the very top edge
    container.scrollTop = Math.max(0, container.scrollTop - container.clientHeight / 4);
  }
}
