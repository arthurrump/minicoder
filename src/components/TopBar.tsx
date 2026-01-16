import { For, Show } from "solid-js";

import styles from "./TopBar.module.css"

export type ViewType = "coding" | "codebooks" | "selections";

interface TopBarProps {
    currentDir: string;
    onChangeDir: () => void;
    currentView: ViewType;
    onViewChange: (view: ViewType) => void;
}

const views: { id: ViewType; label: string }[] = [
    { id: "codebooks", label: "Codebooks" },
    { id: "coding", label: "Coding" },
    { id: "selections", label: "Selections" },
];

export function TopBar(props: TopBarProps) {
    return (
        <div class={styles.topbar}>
            <div class={styles.topbarLeft}>
                <h1 class={styles.title}>minicoder</h1>
                <Show when={props.currentDir}>
                    <nav class={styles.nav}>
                        <For each={views}>
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
