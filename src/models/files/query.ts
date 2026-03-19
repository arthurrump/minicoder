// .mcq query file

export interface Query {
    guid: string;
    name: string;
    query: QueryNode | null;
    fileFilter: string; // Comma separated list of globs
    userFilter: (string | undefined)[]; // List of user IDs
    showOnlyMatching?: boolean;
}

export type QueryNode =
    | { type: 'operator'; operator: QueryOperator; children: QueryNode[] }
    | { type: 'code'; codeGuid: string; includeSubcodes?: boolean }
    | { type: 'codebook'; codebookGuid: string };

export type QueryOperator = 'AND' | 'OR' | 'NOT';
