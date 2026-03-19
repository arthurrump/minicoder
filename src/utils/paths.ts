// Path disambiguation utilities

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
