// .mcq query file

export interface Query {
    guid: string;
    name: string;
    // Base query constraint applied to all matches, including clause evaluation.
    query: QueryNode | null;
    // Additional styled constraints. Each clause is evaluated with the base query.
    clauses?: QueryClause[];
    // Base file filter constraint applied to all matches.
    fileFilter: string; // Comma separated list of globs
    // Base user filter constraint applied to all matches.
    userFilter: (string | undefined)[]; // List of user IDs
    showOnlyMatching?: boolean;
}

export interface QueryClause {
    guid: string;
    // Additional query constraint combined with Query.query (AND semantics).
    query: QueryNode | null;
    style?: QueryUnderlineStyle;
    // Optional extra file filter; combined with Query.fileFilter.
    fileFilter?: string; // Comma separated list of globs
    // Optional extra user filter; combined with Query.userFilter.
    userFilter?: (string | undefined)[]; // List of user IDs
}

export type QueryNode =
    | { type: 'operator'; operator: QueryOperator; children: QueryNode[] }
    | { type: 'code'; codeGuid: string; includeSubcodes?: boolean }
    | { type: 'codebook'; codebookGuid: string };

export type QueryOperator = 'AND' | 'OR' | 'NOT';

export type QueryUnderlineStyle = 'solid' | 'dashed' | 'dotted' | 'double';
