import { type Component, createMemo, createSignal, For, Show, onCleanup } from 'solid-js';
import ColorChip from '../ColorChip';
import { SourceCodePopover } from '../Popover';
import { useStore } from '../../store';
import { useSettings } from '../../settings';
import { flattenCodesWithDepth } from '../../utils/codeTree';
import type { AppliedCode, Code, Codebook } from '../../models/files';
import styles from './SourceCodesBar.module.css';

interface SourceCodesBarProps {
    sourcePath: string;
}

const SourceCodesBar: Component<SourceCodesBarProps> = (props) => {
    const { store, actions, indices } = useStore();
    const { settings } = useSettings();
    const [showPicker, setShowPicker] = createSignal(false);
    const [popover, setPopover] = createSignal<{ appliedCode: AppliedCode; x: number; y: number } | null>(null);

    const sourceCodes = createMemo(() =>
        store.sources[props.sourcePath]?.sourceCodes ?? []
    );

    const resolvedCodes = createMemo(() => {
        const index = indices.codeByGuid();
        return sourceCodes()
            .map(sc => {
                const info = index[sc.code.codeGuid];
                return info ? { appliedCode: sc, code: info.code, codebook: info.codebook } : null;
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);
    });

    const handleAddCode = (code: Code, codebook: Codebook) => {
        const current = sourceCodes();
        // Prevent duplicate
        if (current.some(sc => sc.code.codeGuid === code.guid)) {
            setShowPicker(false);
            return;
        }
        actions.updateSourceCodes(props.sourcePath, [
            ...current,
            {
                code: { codebookGuid: codebook.guid, codeGuid: code.guid },
                creatingUser: settings().userId || undefined,
            },
        ]);
        setShowPicker(false);
    };

    const handleChipClick = (appliedCode: AppliedCode, e: MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPopover({ appliedCode, x: rect.left, y: rect.bottom + 4 });
    };

    // Close picker on Escape
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            if (popover()) setPopover(null);
            else if (showPicker()) setShowPicker(false);
        }
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));

    // Close picker on outside click
    let barRef: HTMLDivElement | undefined;
    const onClickOutside = (e: MouseEvent) => {
        if (barRef && !barRef.contains(e.target as Node)) {
            if (showPicker()) setShowPicker(false);
        }
    };
    document.addEventListener('mousedown', onClickOutside);
    onCleanup(() => document.removeEventListener('mousedown', onClickOutside));

    /** Codebook groups for the picker dropdown */
    const codebookGroups = createMemo(() => {
        const groups: { codebook: Codebook; items: { code: Code; depth: number }[] }[] = [];
        for (const cb of indices.sortedCodebooks()) {
            const items = flattenCodesWithDepth(cb.codes);
            if (items.length > 0) {
                groups.push({ codebook: cb, items });
            }
        }
        return groups;
    });

    return (
        <div class={styles.bar} ref={barRef}>
            <For each={resolvedCodes()}>
                {(item) => (
                    <span
                        class={styles.chip}
                        onClick={(e) => handleChipClick(item.appliedCode, e)}
                    >
                        <ColorChip color={item.code.color} />
                        <span class={styles.chipName}>{item.code.name}</span>
                        <span class={styles.chipCodebook}>({item.codebook.name})</span>
                    </span>
                )}
            </For>
            <Show when={popover()}>
                {(p) => (
                    <SourceCodePopover
                        sourcePath={props.sourcePath}
                        appliedCode={p().appliedCode}
                        x={p().x}
                        y={p().y}
                        onClose={() => setPopover(null)}
                    />
                )}
            </Show>
            <div class={styles.pickerAnchor}>
                <button
                    class={styles.addBtn}
                    onClick={() => setShowPicker(!showPicker())}
                    title="Add source code"
                >+ Add Code</button>
                <Show when={showPicker()}>
                    <div class={styles.pickerDropdown}>
                        <For each={codebookGroups()}>
                            {(group) => (
                                <>
                                    <div class={styles.pickerHeading}>{group.codebook.name}</div>
                                    <For each={group.items}>
                                        {(item) => (
                                            <button
                                                class={styles.pickerItem}
                                                style={{ "padding-left": `${8 + item.depth * 14}px` }}
                                                onClick={() => handleAddCode(item.code, group.codebook)}
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
                </Show>
            </div>
        </div>
    );
};

export default SourceCodesBar;
