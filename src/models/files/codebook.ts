// .mcc codebook file

export interface Codebook {
    guid: string;
    name: string;
    codes: Code[];
}

export interface Code {
    guid: string;
    name: string;
    color: string;
    description: string;
    examples?: TextSelectionReference[];
    subcodes: Code[];
}

export interface TextSelectionReference {
    sourceGuid: string;
    textSelectionGuid: string;
}
