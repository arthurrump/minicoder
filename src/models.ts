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

type QueryOperator = 'AND' | 'OR' | 'NOT';
type QueryNode =
    | { type: 'operator'; operator: QueryOperator; children: QueryNode[] }
    | { type: 'code'; codeGuid: string };

interface Query {
    guid: string;
    name: string;
    query: QueryNode | null;
}
