import { Show, createSignal, onMount } from "solid-js";
import { useSettings } from "../settings";

import styles from "./TopBar.module.css"
import octicons from "@primer/octicons";

interface TopBarProps {
    currentDir: string;
    onChangeDir: () => void;
}

export function TopBar(props: TopBarProps) {
    const { settings, setUserId } = useSettings();
    const [showSettings, setShowSettings] = createSignal(false);
    const [editingUserId, setEditingUserId] = createSignal("");

    // Auto-open settings dialog if userId is not set
    onMount(() => {
        if (!settings().userId) {
            setEditingUserId("");
            setShowSettings(true);
        }
    });

    const openSettings = () => {
        setEditingUserId(settings().userId);
        setShowSettings(true);
    };

    const saveUserId = () => {
        setUserId(editingUserId().trim());
        setShowSettings(false);
    };

    return (
        <div class={styles.topbar}>
            <div class={styles.topbarLeft}>
                <h1 class={styles.title}>minicoder</h1>
            </div>
            <div class={styles.actions}>
                <Show when={settings().userId}>
                    <span class={styles.userId} title="Current user ID">
                        {settings().userId}
                    </span>
                </Show>
                <span>{props.currentDir}</span>
                <button onClick={props.onChangeDir}>
                    <Show when={props.currentDir} fallback="Open Directory">Change Directory</Show>
                </button>
                <button onClick={openSettings} title="Settings" innerHTML={octicons.gear.toSVG()} />
            </div>
            <Show when={showSettings()}>
                <div class={styles.settingsOverlay} onClick={() => setShowSettings(false)}>
                    <div class={styles.settingsModal} onClick={(e) => e.stopPropagation()}>
                        <h3>Settings</h3>
                        <div class={styles.settingRow}>
                            <label for="userId">User ID</label>
                            <input
                                id="userId"
                                type="text"
                                placeholder="Enter your user ID"
                                value={editingUserId()}
                                onInput={(e) => setEditingUserId(e.target.value)}
                            />
                        </div>
                        <p class={styles.settingHint}>
                            This ID will be recorded as the creator of new text selections.
                        </p>
                        <div class={styles.settingsActions}>
                            <button onClick={() => setShowSettings(false)}>Cancel</button>
                            <button class={styles.primaryBtn} onClick={saveUserId}>Save</button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    )
}
