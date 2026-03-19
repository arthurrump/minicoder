import { For, Show } from "solid-js";
import styles from "./CodePicker.module.css";
import ColorChip from "../ColorChip";
import Icon from "../Icon";
import type { Code, Codebook } from "../../models/files";

export interface CodeListProps {
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
                    <span>{code.name}</span>
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
                        ><Icon name="info" /></button>
                    </Show>
                </div>
                <Show when={code.subcodes && code.subcodes.length > 0}>
                    <div class={styles.subcodes}>
                        <CodeList 
                            codes={code.subcodes} 
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

export default CodeList;
