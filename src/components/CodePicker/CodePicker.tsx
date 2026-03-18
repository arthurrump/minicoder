import { createEffect, createSignal, For, Show, on, createMemo } from "solid-js";
import codebookStyles from "./CodebookList.module.css";
import CodeList from "./CodeList";
import Icon from "../Icon";
import octicons from "@primer/octicons";
import type { Code, Codebook } from "../../models/files";

interface CodePickerProps {
    codebooks: Codebook[];
    onCodeClick: (code: Code, codebook: Codebook) => void;
    onInfoClick?: (code: Code, codebook: Codebook) => void;
    onEditClick?: (codebook: Codebook) => void;
}

export const CodePicker = (props: CodePickerProps) => {
    // Track expanded state for each codebook by guid
    const [expandedCodebooks, setExpandedCodebooks] = createSignal<Set<string>>(new Set());

    // Track the set of codebook guids to detect additions/removals (not content changes)
    const codebookGuids = createMemo(() =>
        props.codebooks.map(cb => cb.guid).sort().join(',')
    );

    // Only reset expanded state when codebooks are added/removed, not on content changes
    createEffect(on(codebookGuids, () => {
        const codebooks = props.codebooks;
        if (codebooks.length === 1) {
            // Single codebook: expand it by default
            setExpandedCodebooks(new Set([codebooks[0].guid]));
        } else {
            // Multiple codebooks: keep existing expanded state, expand any newly added ones
            setExpandedCodebooks(prev => {
                const currentGuids = new Set(codebooks.map(cb => cb.guid));
                const newSet = new Set<string>();
                // Retain expansion for codebooks that still exist
                for (const guid of prev) {
                    if (currentGuids.has(guid)) newSet.add(guid);
                }
                // Expand newly added codebooks
                for (const cb of codebooks) {
                    if (!prev.has(cb.guid) && prev.size > 0) newSet.add(cb.guid);
                }
                return newSet;
            });
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
                            <Show when={props.onEditClick}>
                                <button
                                    class={codebookStyles.codebookEditBtn}
                                    title="Edit codebook"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        props.onEditClick!(codebook);
                                    }}
                                ><Icon icon={octicons.pencil} width={14} /></button>
                            </Show>
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
