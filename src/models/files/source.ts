// .mcs coded source file

export interface Source {
    guid: string;
    fileHash: string;
    selections: TextSelection[];
    sourceCodes?: AppliedCode[];
}

export interface TextSelection extends AppliedCode {
    guid: string;
    start: number;
    end: number;
}

export interface AppliedCode {
    code: CodeReference;
    creatingUser?: string;
    note?: string;
}

export interface CodeReference {
    codebookGuid: string;
    codeGuid: string;
}
