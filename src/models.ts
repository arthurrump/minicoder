interface Code {
    guid: string;
    name: string;
    color: string;
    description: string;
    examples?: TextSelectionReference[];
    subcodes: Code[];
}

interface Codebook {
    guid: string;
    name: string;
    codes: Code[];
}

interface CodeReference {
    codebookGuid: string;
    codeGuid: string;
}

interface TextSelection {
    guid: string;
    start: number;
    end: number;
    code: CodeReference;
    creatingUser?: string;
    note?: string;
}

interface Source {
    guid: string;
    fileHash: string;
    selections: TextSelection[];
}

interface TextSelectionReference {
    sourceGuid: string;
    textSelectionGuid: string;
}

type QueryOperator = 'AND' | 'OR' | 'NOT';
type QueryNode =
    | { type: 'operator'; operator: QueryOperator; children: QueryNode[] }
    | { type: 'code'; codeGuid: string; includeSubcodes?: boolean };

interface Query {
    guid: string;
    name: string;
    query: QueryNode | null;
    fileFilter?: string;
    userFilter?: string; // Comma-separated list of user IDs
}

interface UserSettings {
    userId: string;
}
