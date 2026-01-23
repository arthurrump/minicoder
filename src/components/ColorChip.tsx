import { type Component } from 'solid-js';
import styles from './ColorChip.module.css';

interface ColorChipProps {
    color: string;
    class?: string;
}

const ColorChip: Component<ColorChipProps> = (props) => {
    return (
        <span
            class={`${styles.colorChip} ${props.class || ''}`}
            style={{ 'background-color': props.color }}
        />
    );
};

export default ColorChip;