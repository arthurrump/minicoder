interface Code {
    guid: string;
    name: string;
    color: string;
    description: string;
    subcodes: Code[];
}

interface Codebook {
    name: string;
    codes: Code[];
}

interface Selection {
    guid: string;
    start: number;
    end: number;
    text: string;
    code_guid: string;
}

interface Source {
    fileHash: string;
    selections: Selection[];
}
