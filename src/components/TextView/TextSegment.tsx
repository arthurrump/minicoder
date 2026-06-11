import { type Component } from 'solid-js';
import styles from './TextView.module.css';
import { type Segment } from '../../helpers';
import { getUnderlineStyle } from '../../utils/textLayout';
import type { Code, Codebook } from '../../models/files';

export interface TextSegmentProps {
    segment: Segment;
    selectionLayers: Map<string, number>;
    codeIndex: Record<string, { code: Code; codebook: Codebook }>;
    totalLayers: number;
    hoveredSelectionGuid: string | null;
    selectionUnderlineStyles?: Record<string, string>;
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
                props.hoveredSelectionGuid,
                props.selectionUnderlineStyles
            )}
        >
            {props.segment.text}
        </span>
    );
};

export default TextSegment;
