import Icon from '../Icon';
import { type Component, createMemo } from 'solid-js';
import Popover from './Popover';
import { useStore } from '../../store';
import type { Code, Codebook, CodeReference, TextSelection } from '../../models/files';
import styles from './Popover.module.css';

interface SelectionPopoverProps {
    x: number;
    y: number;
    onClose: () => void;
    sourcePath: string;
    selection: TextSelection;
}

const SelectionPopover: Component<SelectionPopoverProps> = (props) => {
    const { store, actions, indices } = useStore();

    const isExample = createMemo(() => {
        const info = indices.codeByGuid()[props.selection.code.codeGuid];
        return info?.code?.examples?.some(ex => ex.textSelectionGuid === props.selection.guid) ?? false;
    });

    const handleRemove = () => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        const sel = source.selections.find(s => s.guid === props.selection.guid);
        if (sel) {
            actions.removeExample(props.sourcePath, sel.guid, sel.code.codebookGuid, sel.code.codeGuid);
        }
        actions.updateSourceSelections(props.sourcePath, source.selections.filter(s => s.guid !== props.selection.guid));
    };

    const handleToggleExample = () => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        const sel = source.selections.find(s => s.guid === props.selection.guid);
        if (!sel) return;
        actions.toggleExample(props.sourcePath, sel.guid, sel.code.codebookGuid, sel.code.codeGuid);
    };

    const handleChangeCode = (code: Code, codebook: Codebook) => {
        const newCode: CodeReference = { codebookGuid: codebook.guid, codeGuid: code.guid };
        const source = store.sources[props.sourcePath];
        if (!source) return;
        actions.updateSourceSelections(
            props.sourcePath,
            source.selections.map(s => s.guid === props.selection.guid ? { ...s, code: newCode } : s)
        );
    };

    const handleNoteChange = (note: string | undefined) => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        actions.updateSourceSelections(
            props.sourcePath,
            source.selections.map(s => s.guid === props.selection.guid ? { ...s, note } : s)
        );
    };

    return (
        <Popover
            x={props.x}
            y={props.y}
            onClose={props.onClose}
            codeGuid={props.selection.code.codeGuid}
            creatingUser={props.selection.creatingUser}
            note={props.selection.note}
            onRemove={handleRemove}
            onChangeCode={handleChangeCode}
            onNoteChange={handleNoteChange}
            extraActions={<>
                <button
                    class={styles.popoverActionBtn}
                    onClick={() => {
                        const copy = async () => navigator.clipboard.writeText(props.selection.guid);
                        copy().catch(err => console.warn("Copying selection guid failed:", err));
                    }}
                    title="Copy selection guid"
                ><Icon name="copy" /></button>
                <button
                    class={styles.popoverActionBtn}
                    onClick={handleToggleExample}
                    title={isExample() ? 'Remove as example' : 'Mark as example'}
                ><Icon name={isExample() ? "star-fill" : "star"} /></button>
            </>}
        />
    );
};

export default SelectionPopover;
