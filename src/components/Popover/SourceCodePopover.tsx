import { type Component } from 'solid-js';
import Popover from './Popover';
import { useStore } from '../../store';
import type { AppliedCode, Code, Codebook, CodeReference } from '../../models/files';

interface SourceCodePopoverProps {
    sourcePath: string;
    appliedCode: AppliedCode;
    x: number;
    y: number;
    onClose: () => void;
}

const SourceCodePopover: Component<SourceCodePopoverProps> = (props) => {
    const { store, actions } = useStore();

    const handleRemove = () => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        actions.updateSourceCodes(
            props.sourcePath,
            (source.sourceCodes ?? []).filter(sc => sc.code.codeGuid !== props.appliedCode.code.codeGuid),
        );
        props.onClose();
    };

    const handleChangeCode = (code: Code, codebook: Codebook) => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        const newRef: CodeReference = { codebookGuid: codebook.guid, codeGuid: code.guid };
        actions.updateSourceCodes(
            props.sourcePath,
            (source.sourceCodes ?? []).map(sc =>
                sc.code.codeGuid === props.appliedCode.code.codeGuid ? { ...sc, code: newRef } : sc
            ),
        );
    };

    const handleNoteChange = (note: string | undefined) => {
        const source = store.sources[props.sourcePath];
        if (!source) return;
        actions.updateSourceCodes(
            props.sourcePath,
            (source.sourceCodes ?? []).map(sc =>
                sc.code.codeGuid === props.appliedCode.code.codeGuid ? { ...sc, note } : sc
            ),
        );
    };

    return (
        <Popover
            x={props.x}
            y={props.y}
            onClose={props.onClose}
            codeGuid={props.appliedCode.code.codeGuid}
            creatingUser={props.appliedCode.creatingUser}
            note={props.appliedCode.note}
            onRemove={handleRemove}
            onChangeCode={handleChangeCode}
            onNoteChange={handleNoteChange}
        />
    );
};

export default SourceCodePopover;
