import { createSignal, Show, onMount, onCleanup, type Component } from 'solid-js';
import styles from './MatchingSelections.module.css';
import SelectionMatchItem, { type SelectionMatchItemProps } from './SelectionMatchItem';

/**
 * Lazy wrapper around MatchItem that only mounts the full component
 * when it's near the viewport. Off-screen items render as lightweight
 * placeholders, so expand/collapse and other state changes only
 * trigger re-renders for visible items.
 */
const LazyMatchItem: Component<SelectionMatchItemProps> = (props) => {
  let wrapperRef: HTMLDivElement | undefined;
  const [isNearViewport, setIsNearViewport] = createSignal(false);
  const [lastHeight, setLastHeight] = createSignal(80);

  onMount(() => {
    if (!wrapperRef) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsNearViewport(true);
        } else {
          // Capture height before unmounting so the placeholder keeps the same size
          if (wrapperRef) {
            const h = wrapperRef.getBoundingClientRect().height;
            if (h > 0) setLastHeight(h);
          }
          setIsNearViewport(false);
        }
      },
      { rootMargin: '600px 0px' },
    );

    observer.observe(wrapperRef);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={wrapperRef}>
      <Show
        when={isNearViewport()}
        fallback={
          <div
            class={styles.matchItemPlaceholder}
            style={{ height: `${lastHeight()}px` }}
          />
        }
      >
        <SelectionMatchItem
          group={props.group}
          isExpanded={props.isExpanded}
          onToggleExpand={props.onToggleExpand}
          onEnsureExpanded={props.onEnsureExpanded}
          onOpenSource={props.onOpenSource}
          onSelectionCreate={props.onSelectionCreate}
          onSelectionUpdate={props.onSelectionUpdate}
          onSelectionClear={props.onSelectionClear}
          selectedCode={props.selectedCode}
        />
      </Show>
    </div>
  );
};

export default LazyMatchItem;
