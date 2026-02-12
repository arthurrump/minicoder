import { createEffect, createSignal, For, Show, on } from "solid-js";
import styles from "./CodePicker.module.css";
import codebookStyles from "./CodebookList.module.css";
import ColorChip from "./ColorChip";
import octicons from "@primer/octicons";

interface CodePickerProps {
    codebooks: Codebook[];
    onCodeClick: (code: Code, codebook: Codebook) => void;
    onInfoClick?: (code: Code, codebook: Codebook) => void;
}

interface CodeListProps {
    codes: Code[];
    codebook: Codebook;
    onCodeClick: (code: Code, codebook: Codebook) => void;
    onInfoClick?: (code: Code, codebook: Codebook) => void;
}

const CodeList = (props: CodeListProps) => (
    <For each={props.codes}>
        {(code) => (
            <>
                <div
                    class={styles.codeItem}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        props.onCodeClick(code, props.codebook);
                    }}
                >
                    <ColorChip class={styles.colorChip} color={code.color} />
                    <span class={styles.codeName}>{code.name}</span>
                    <Show when={props.onInfoClick}>
                        <button
                            class={styles.infoBtn}
                            title="View selections"
                            onClick={(e) => {
                                e.stopPropagation();
                                props.onInfoClick!(code, props.codebook);
                            }}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            innerHTML={octicons.info.toSVG()}
                        />
                    </Show>
                </div>
                <Show when={code.subcodes && code.subcodes.length > 0}>
                    <div class={styles.subcodes}>
                        <CodeList 
                            codes={code.subcodes!} 
                            codebook={props.codebook}
                            onCodeClick={props.onCodeClick}
                            onInfoClick={props.onInfoClick}
                        />
                    </div>
                </Show>
            </>
        )}
    </For>
);

export const CodePicker = (props: CodePickerProps) => {
    // Track expanded state for each codebook by filename
    const [expandedCodebooks, setExpandedCodebooks] = createSignal<Set<string>>(new Set());

    // Update expanded state when codebooks change
    createEffect(on(() => props.codebooks, (codebooks) => {
        // If only one codebook, expand it by default
        if (codebooks.length === 1) {
            setExpandedCodebooks(new Set([codebooks[0].guid]));
        } else {
            // Multiple codebooks: collapse all
            setExpandedCodebooks(new Set<string>());
        }
    }));

    const toggleCodebook = (filename: string) => {
        setExpandedCodebooks(prev => {
            const newSet = new Set(prev);
            if (newSet.has(filename)) {
                newSet.delete(filename);
            } else {
                newSet.add(filename);
            }
            return newSet;
        });
    };

    const isExpanded = (guid: string) => expandedCodebooks().has(guid);

    return (
        <div class={codebookStyles.codebookList}>
            <For each={props.codebooks}>
                {(codebook) => (
                    <div class={codebookStyles.codebookSection}>
                        <div 
                            class={codebookStyles.codebookHeader}
                            onClick={() => toggleCodebook(codebook.guid)}
                        >
                            <span class={codebookStyles.codebookToggle}>
                                {isExpanded(codebook.guid) ? '▼' : '▶'}
                            </span>
                            <span class={codebookStyles.codebookName}>{codebook.name}</span>
                        </div>
                        <Show when={isExpanded(codebook.guid)}>
                            <div class={codebookStyles.codebookCodes}>
                                <CodeList 
                                    codes={codebook.codes} 
                                    codebook={codebook}
                                    onCodeClick={props.onCodeClick}
                                    onInfoClick={props.onInfoClick}
                                />
                            </div>
                        </Show>
                    </div>
                )}
            </For>
        </div>
    );
};

export default CodePicker;
