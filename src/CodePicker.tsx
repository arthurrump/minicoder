import { For, Show } from "solid-js";

export const CodePicker = (props: { codes: Code[], onCodeClick: (code: Code) => void }) => (
    <For each={props.codes}>
        {(code) => (
            <>
                <div
                    class="code-item"
                    style={{ "background-color": code.color }}
                    onClick={() => props.onCodeClick(code)}
                >
                    {code.name}
                </div>
                <Show when={code.subcodes}>
                    <div class="subcodes">
                        <CodePicker codes={code.subcodes!} onCodeClick={props.onCodeClick} />
                    </div>
                </Show>
            </>
        )}
    </For>
);

export default CodePicker;
