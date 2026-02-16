// .mcc codebook file

interface Codebook {
    guid: string;
    name: string;
    codes: Code[];
}

interface Code {
    guid: string;
    name: string;
    color: string;
    description: string;
    examples?: TextSelectionReference[];
    subcodes: Code[];
}

interface TextSelectionReference {
    sourceGuid: string;
    textSelectionGuid: string;
}
