import { type Component, For, Show, createMemo, createSignal, onMount } from 'solid-js';
import ColorChip from './ColorChip';
import type { Code, Codebook } from '../models/files';
import styles from './InlineCodePicker.module.css';

export interface InlineCodePickerItem {
  code: Code;
  depth: number;
  label?: string;
}

export interface InlineCodePickerGroup {
  codebook: Codebook;
  codes: InlineCodePickerItem[];
}

interface InlineCodePickerProps {
  groups: InlineCodePickerGroup[];
  mainCodebook?: Codebook;
  onSelect: (code: Code, codebook: Codebook) => void;
  onSelectCodebook?: (codebook: Codebook) => void;
  filterPlaceholder?: string;
}

type FlatItem =
  | { kind: 'codebook'; codebook: Codebook }
  | { kind: 'code'; code: Code; codebook: Codebook };

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

  const filteredGroups = createMemo(() => {
    const query = filter().toLowerCase();
    const result: {
      codebook: Codebook;
      codes: InlineCodePickerItem[];
      codebookFlatIndex: number | null;
      firstCodeFlatIndex: number;
    }[] = [];
    let idx = 0;

    for (const group of sortedGroups()) {
      const includeCodebook = !!props.onSelectCodebook && (!query || group.codebook.name.toLowerCase().includes(query));
      const codes = query
        ? group.codes.filter((item) => {
            const label = item.label ?? item.code.name;
            return label.toLowerCase().includes(query);
          })
        : group.codes;

      if (codes.length > 0 || includeCodebook) {
        const codebookFlatIndex = includeCodebook ? idx++ : null;
        const firstCodeFlatIndex = idx;
        result.push({
          codebook: group.codebook,
          codes,
          codebookFlatIndex,
          firstCodeFlatIndex,
        });
        idx += codes.length;
      }
    }

    return result;
  });

  const flatItems = createMemo(() => {
    const result: FlatItem[] = [];
    for (const group of filteredGroups()) {
      if (group.codebookFlatIndex !== null) {
        result.push({ kind: 'codebook', codebook: group.codebook });
      }
      for (const item of group.codes) {
        result.push({ kind: 'code', code: item.code, codebook: group.codebook });
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
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[activeIndex()];
      if (!item) return;
      if (item.kind === 'code') {
        props.onSelect(item.code, item.codebook);
      } else if (props.onSelectCodebook) {
        props.onSelectCodebook(item.codebook);
      }
    }
  };

  return (
    <div class={styles.inlineCodePicker}>
      <div class={styles.pickerFilterRow}>
        <input
          ref={inputRef}
          class={styles.pickerFilter}
          type="text"
          placeholder={props.filterPlaceholder ?? 'Filter codes...'}
          value={filter()}
          onInput={handleFilterInput}
          onKeyDown={handleKeyDown}
        />
      </div>
      <Show when={filteredGroups().length > 0} fallback={<div class={styles.noResults}>No matching codes.</div>}>
        <For each={filteredGroups()}>
          {(group) => (
            <>
              <Show
                when={group.codebookFlatIndex !== null}
                fallback={<div class={styles.pickerHeading}>{group.codebook.name}</div>}
              >
                <button
                  class={styles.pickerHeadingButton}
                  classList={{ [styles.pickerItemActive]: group.codebookFlatIndex === activeIndex() }}
                  onClick={() => props.onSelectCodebook?.(group.codebook)}
                  onMouseEnter={() => {
                    if (group.codebookFlatIndex !== null) {
                      setActiveIndex(group.codebookFlatIndex);
                    }
                  }}
                >
                  {group.codebook.name}
                  <span class={styles.pickerHeadingAction}>Select codebook</span>
                </button>
              </Show>
              <For each={group.codes}>
                {(item, localIndex) => (
                  <button
                    class={styles.pickerItem}
                    classList={{ [styles.pickerItemActive]: group.firstCodeFlatIndex + localIndex() === activeIndex() }}
                    style={{ 'padding-left': `${8 + item.depth * 14}px` }}
                    onClick={() => props.onSelect(item.code, group.codebook)}
                    onMouseEnter={() => setActiveIndex(group.firstCodeFlatIndex + localIndex())}
                  >
                    <ColorChip color={item.code.color} />
                    <span>{item.label ?? item.code.name}</span>
                  </button>
                )}
              </For>
            </>
          )}
        </For>
      </Show>
    </div>
  );
};

export default InlineCodePicker;