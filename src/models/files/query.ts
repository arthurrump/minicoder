// .mcq query file

interface Query {
    guid: string;
    name: string;
    query: QueryNode | null;
    fileFilter?: string; // Comma-seperated list of globs
    userFilter?: string; // Comma-separated list of user IDs
}

type QueryNode =
    | { type: 'operator'; operator: QueryOperator; children: QueryNode[] }
    | { type: 'code'; codeGuid: string; includeSubcodes?: boolean };

type QueryOperator = 'AND' | 'OR' | 'NOT';
