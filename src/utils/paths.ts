// Path disambiguation utilities

// Column tree types for collapsible column groups in Dashboard

export interface ColumnNode {
  /** Display name for this node (folder name or file name) */
  name: string;
  /** Full relative path from directory root */
  path: string;
  /** Whether this node represents a folder */
  isFolder: boolean;
  /** Child nodes (empty for files) */
  children: ColumnNode[];
  /** All descendant file paths (for files, just [path]) */
  leafPaths: string[];
}

export interface HeaderCell {
  node: ColumnNode;
  colspan: number;
  rowspan: number;
}

export interface ColumnGrid {
  headerRows: HeaderCell[][];
  leafColumns: ColumnNode[];
  depth: number;
}

/**
 * Build a column tree from a sorted list of source paths.
 * Groups paths by directory levels, creating folder nodes and leaf file nodes.
 */
export function buildColumnTree(paths: string[], prefix = ''): ColumnNode[] {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  const order: { key: string; isFolder: boolean }[] = [];

  for (const path of paths) {
    const slashIdx = path.indexOf('/');
    const key = slashIdx === -1 ? path : path.substring(0, slashIdx);
    const isFolder = slashIdx !== -1;
    if (isFolder) {
      const rest = path.substring(slashIdx + 1);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rest);
    }
    if (!seen.has(key)) {
      seen.add(key);
      order.push({ key, isFolder });
    }
  }

  const nodes: ColumnNode[] = [];
  for (const { key, isFolder } of order) {
    const fullPath = prefix ? `${prefix}/${key}` : key;
    if (isFolder) {
      const children = buildColumnTree(groups.get(key)!, fullPath);
      const leafPaths: string[] = [];
      for (const child of children) leafPaths.push(...child.leafPaths);
      nodes.push({ name: key, path: fullPath, isFolder: true, children, leafPaths });
    } else {
      nodes.push({ name: key, path: fullPath, isFolder: false, children: [], leafPaths: [fullPath] });
    }
  }
  return nodes;
}

/**
 * Compute the header grid layout for the column tree given which folders are expanded.
 * Returns header rows (with colspan/rowspan) and the ordered leaf columns for tbody.
 */
export function computeColumnGrid(tree: ColumnNode[], expandedColumns: Set<string>): ColumnGrid {
  if (tree.length === 0) return { headerRows: [], leafColumns: [], depth: 0 };

  function computeDepth(nodes: ColumnNode[], level: number): number {
    let maxDepth = level + 1;
    for (const node of nodes) {
      if (node.isFolder && expandedColumns.has(node.path)) {
        maxDepth = Math.max(maxDepth, computeDepth(node.children, level + 1));
      }
    }
    return maxDepth;
  }

  const depth = computeDepth(tree, 0);
  const headerRows: HeaderCell[][] = Array.from({ length: depth }, () => []);
  const leafColumns: ColumnNode[] = [];

  function walk(nodes: ColumnNode[], level: number) {
    for (const node of nodes) {
      const isExpanded = node.isFolder && expandedColumns.has(node.path);
      if (isExpanded) {
        const startIdx = leafColumns.length;
        walk(node.children, level + 1);
        const colspan = leafColumns.length - startIdx;
        headerRows[level].push({ node, colspan, rowspan: 1 });
      } else {
        leafColumns.push(node);
        headerRows[level].push({ node, colspan: 1, rowspan: depth - level });
      }
    }
  }

  walk(tree, 0);
  return { headerRows, leafColumns, depth };
}

/**
 * Compute disambiguated display names for a list of file paths.
 * Shows the minimum number of path segments needed to uniquely identify each path.
 * For example, given ["a/b/file.txt", "c/d/file.txt"], returns
 * "b/file.txt" and "d/file.txt" instead of just "file.txt".
 */
export function disambiguatePaths(paths: string[]): Map<string, string> {
  const result = new Map<string, string>();
  
  // Group paths by their filename
  const fileNameGroups = new Map<string, string[]>();
  for (const path of paths) {
    const fileName = path.split('/').pop() || path;
    if (!fileNameGroups.has(fileName)) {
      fileNameGroups.set(fileName, []);
    }
    fileNameGroups.get(fileName)!.push(path);
  }
  
  // For each group, determine the minimum path segments needed to disambiguate
  for (const [fileName, group] of fileNameGroups) {
    if (group.length === 1) {
      // No disambiguation needed
      result.set(group[0], fileName);
    } else {
      // Need to find unique prefixes
      const pathParts = group.map(p => p.split('/').reverse());
      
      for (let i = 0; i < group.length; i++) {
        let segmentsNeeded = 1;
        const currentParts = pathParts[i];
        
        // Compare with all other paths to find minimum segments needed
        for (let j = 0; j < group.length; j++) {
          if (i === j) continue;
          const otherParts = pathParts[j];
          
          // Find how many segments from the end we need to differentiate
          let k = 0;
          while (k < currentParts.length && k < otherParts.length && currentParts[k] === otherParts[k]) {
            k++;
          }
          segmentsNeeded = Math.max(segmentsNeeded, k + 1);
        }
        
        // Build the display name with required segments
        const displayParts = currentParts.slice(0, Math.min(segmentsNeeded, currentParts.length)).reverse();
        result.set(group[i], displayParts.join('/'));
      }
    }
  }
  
  return result;
}
