import { createEffect, createSignal, For, Show, on } from "solid-js";

interface CodePickerProps {
    codebooks: Codebook[];
    onCodeClick: (code: Code, codebook: Codebook) => void;
}

interface CodeListProps {
    codes: Code[];
    codebook: Codebook;
    onCodeClick: (code: Code, codebook: Codebook) => void;
}

const CodeList = (props: CodeListProps) => (
    <For each={props.codes}>
        {(code) => (
            <>
                <div
                    class="code-item"
                    style={{ "background-color": code.color }}
                    onClick={() => props.onCodeClick(code, props.codebook)}
                >
                    {code.name}
                </div>
                <Show when={code.subcodes && code.subcodes.length > 0}>
                    <div class="subcodes">
                        <CodeList 
                            codes={code.subcodes!} 
                            codebook={props.codebook}
                            onCodeClick={props.onCodeClick} 
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
        <div class="codebook-list">
            <For each={props.codebooks}>
                {(codebook) => (
                    <div class="codebook-section">
                        <div 
                            class="codebook-header"
                            onClick={() => toggleCodebook(codebook.guid)}
                        >
                            <span class="codebook-toggle">
                                {isExpanded(codebook.guid) ? '▼' : '▶'}
                            </span>
                            <span class="codebook-name">{codebook.name}</span>
                        </div>
                        <Show when={isExpanded(codebook.guid)}>
                            <div class="codebook-codes">
                                <CodeList 
                                    codes={codebook.codes} 
                                    codebook={codebook}
                                    onCodeClick={props.onCodeClick}
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
