import { type Component, For, createMemo, createSignal, onMount } from 'solid-js';
import ColorChip from '../ColorChip';
import type { Code, Codebook } from '../../models/files';
import styles from './Popover.module.css';

interface InlineCodePickerProps {
    groups: { codebook: Codebook; codes: { code: Code; depth: number }[] }[];
    mainCodebook?: Codebook;
    onSelect: (code: Code, codebook: Codebook) => void;
}

const InlineCodePicker: Component<InlineCodePickerProps> = (props) => {
    const [filter, setFilter] = createSignal('');
    const [activeIndex, setActiveIndex] = createSignal(0);
    let inputRef: HTMLInputElement | undefined;

    onMount(() => inputRef?.focus());

    const sortedGroups = createMemo(() => {
        if (!props.mainCodebook) return props.groups;
        const mainGuid = props.mainCodebook.guid;
        return [...props.groups].sort((a, b) => {
            if (a.codebook.guid === mainGuid) return -1;
            if (b.codebook.guid === mainGuid) return 1;
            return 0;
        });
    });

    /** Filtered groups with per-group start index into the flat selectable list */
    const filteredGroups = createMemo(() => {
        const query = filter().toLowerCase();
        const result: { codebook: Codebook; codes: { code: Code; depth: number }[]; startIndex: number }[] = [];
        let idx = 0;
        for (const group of sortedGroups()) {
            const codes = query
                ? group.codes.filter(item => item.code.name.toLowerCase().includes(query))
                : group.codes;
            if (codes.length > 0) {
                result.push({ codebook: group.codebook, codes, startIndex: idx });
                idx += codes.length;
            }
        }
        return result;
    });

    /** Flat list for keyboard nav (index lookup + length) */
    const flatItems = createMemo(() => {
        const result: { code: Code; codebook: Codebook }[] = [];
        for (const group of filteredGroups()) {
            for (const item of group.codes) {
                result.push({ code: item.code, codebook: group.codebook });
            }
        }
        return result;
    });

    const handleFilterInput = (e: Event) => {
        setFilter((e.currentTarget as HTMLInputElement).value);
        setActiveIndex(0);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        const items = flatItems();
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(i => Math.min(i + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const item = items[activeIndex()];
            if (item) props.onSelect(item.code, item.codebook);
        }
    };

    return (
        <div class={styles.popoverCodePicker}>
            <div class={styles.pickerFilterRow}>
                <input
                    ref={inputRef}
                    class={styles.pickerFilter}
                    type="text"
                    placeholder="Filter codes..."
                    value={filter()}
                    onInput={handleFilterInput}
                    onKeyDown={handleKeyDown}
                />
            </div>
            <For each={filteredGroups()}>
                {(group) => (
                    <>
                        <div class={styles.pickerHeading}>{group.codebook.name}</div>
                        <For each={group.codes}>
                            {(item, localIndex) => (
                                <button
                                    class={styles.pickerItem}
                                    classList={{ [styles.pickerItemActive]: group.startIndex + localIndex() === activeIndex() }}
                                    style={{ "padding-left": `${8 + item.depth * 14}px` }}
                                    onClick={() => props.onSelect(item.code, group.codebook)}
                                    onMouseEnter={() => setActiveIndex(group.startIndex + localIndex())}
                                >
                                    <ColorChip color={item.code.color} />
                                    <span>{item.code.name}</span>
                                </button>
                            )}
                        </For>
                    </>
                )}
            </For>
        </div>
    );
};

export default InlineCodePicker;
