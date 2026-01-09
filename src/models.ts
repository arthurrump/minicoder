interface Code {
    guid: string;
    name: string;
    color: string;
    description: string;
    subcodes: Code[];
}

interface Codebook {
    guid: string;
    name: string;
    codes: Code[];
}

interface TextSelection {
    guid: string;
    start: number;
    end: number;
    code_guid: string;
    note?: string;
}

interface Source {
    fileHash: string;
    selections: TextSelection[];
}
