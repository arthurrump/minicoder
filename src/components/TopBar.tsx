import { Show } from "solid-js";

import styles from "./TopBar.module.css"

interface TopBarProps {
    currentDir: string;
    onChangeDir: () => void;
}

export function TopBar(props: TopBarProps) {
    return (
        <div class={styles.topbar}>
            <div class={styles.topbarLeft}>
                <h1 class={styles.title}>minicoder</h1>
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
