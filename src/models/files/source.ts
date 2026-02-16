// .mcs coded source file

interface Source {
    guid: string;
    fileHash: string;
    selections: TextSelection[];
}

interface TextSelection {
    guid: string;
    start: number;
    end: number;
    code: CodeReference;
    creatingUser?: string;
    note?: string;
}

interface CodeReference {
    codebookGuid: string;
    codeGuid: string;
}
