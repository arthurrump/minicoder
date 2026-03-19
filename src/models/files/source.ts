// .mcs coded source file

export interface Source {
    guid: string;
    fileHash: string;
    selections: TextSelection[];
}

export interface TextSelection {
    guid: string;
    start: number;
    end: number;
    code: CodeReference;
    creatingUser?: string;
    note?: string;
}

export interface CodeReference {
    codebookGuid: string;
    codeGuid: string;
}
