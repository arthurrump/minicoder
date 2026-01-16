import { For, Show } from "solid-js";

import styles from "./TopBar.module.css"

interface TopBarProps<ViewType> {
    currentDir: string;
    onChangeDir: () => void;
    currentView: ViewType;
    onViewChange: (view: ViewType) => void;
    views: { id: ViewType; label: string }[];
}

export function TopBar<ViewType>(props: TopBarProps<ViewType>) {
    return (
        <div class={styles.topbar}>
            <div class={styles.topbarLeft}>
                <h1 class={styles.title}>minicoder</h1>
                <Show when={props.currentDir}>
                    <nav class={styles.nav}>
                        <For each={props.views}>
                            {(view) => (
                                <button
                                class={props.currentView === view.id ? styles.navButtonActive : styles.navButton}
                                onClick={() => props.onViewChange(view.id)}
                                >
                                    {view.label}
                                </button>
                            )}
                        </For>
                    </nav>
                </Show>
            </div>
            <div class={styles.actions}>
                <span>{props.currentDir}</span>
                <button onClick={props.onChangeDir}>
                    <Show when={props.currentDir} fallback="Open Directory">Change Directory</Show>
                </button>
            </div>
        </div>
    )
}
