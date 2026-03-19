// Utilities for traversing and manipulating hierarchical code trees
import type { Code, Codebook } from '../models/files';

/** Flatten all codes in a code tree into a list with depth info */
export function flattenCodesWithDepth(codes: Code[], depth: number = 0): { code: Code; depth: number }[] {
  const result: { code: Code; depth: number }[] = [];
  for (const code of codes) {
    result.push({ code, depth });
    if (code.subcodes) {
      result.push(...flattenCodesWithDepth(code.subcodes, depth + 1));
    }
  }
  return result;
}

/** Flatten all codes from all codebooks into a list with codebook and path info */
export function flattenCodesWithPath(codebooks: Codebook[]): { code: Code; codebook: Codebook; path: string[] }[] {
  const results: { code: Code; codebook: Codebook; path: string[] }[] = [];
  
  function traverse(codes: Code[], codebook: Codebook, path: string[]) {
    for (const code of codes) {
      results.push({ code, codebook, path: [...path, code.name] });
      if (code.subcodes) {
        traverse(code.subcodes, codebook, [...path, code.name]);
      }
    }
  }
  
  for (const codebook of codebooks) {
    traverse(codebook.codes, codebook, [codebook.name]);
  }
  
  return results;
}

/** Recursively update a code in a code tree by GUID */
export function updateCodeInTree(codes: Code[], guid: string, updates: Partial<Code>): Code[] {
  return codes.map(code => {
    if (code.guid === guid) return { ...code, ...updates };
    if (code.subcodes?.length) {
      return { ...code, subcodes: updateCodeInTree(code.subcodes, guid, updates) };
    }
    return code;
  });
}
