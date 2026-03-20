import { describe, it, expect } from 'vitest';
import { buildColumnTree, computeColumnGrid } from '../utils/paths';

describe('buildColumnTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildColumnTree([])).toEqual([]);
  });

  it('creates leaf nodes for root-level files', () => {
    const tree = buildColumnTree(['a.txt', 'b.txt']);
    expect(tree).toEqual([
      { name: 'a.txt', path: 'a.txt', isFolder: false, children: [], leafPaths: ['a.txt'] },
      { name: 'b.txt', path: 'b.txt', isFolder: false, children: [], leafPaths: ['b.txt'] },
    ]);
  });

  it('creates folder nodes with children', () => {
    const tree = buildColumnTree(['docs/a.txt', 'docs/b.txt']);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('docs');
    expect(tree[0].isFolder).toBe(true);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].leafPaths).toEqual(['docs/a.txt', 'docs/b.txt']);
  });

  it('handles mixed root files and folders', () => {
    const tree = buildColumnTree(['docs/a.txt', 'readme.md']);
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe('docs');
    expect(tree[0].isFolder).toBe(true);
    expect(tree[1].name).toBe('readme.md');
    expect(tree[1].isFolder).toBe(false);
  });

  it('handles nested folders', () => {
    const tree = buildColumnTree(['a/b/c.txt', 'a/b/d.txt', 'a/e.txt']);
    expect(tree).toHaveLength(1);
    const a = tree[0];
    expect(a.name).toBe('a');
    expect(a.children).toHaveLength(2);
    expect(a.children[0].name).toBe('b');
    expect(a.children[0].isFolder).toBe(true);
    expect(a.children[0].leafPaths).toEqual(['a/b/c.txt', 'a/b/d.txt']);
    expect(a.children[1].name).toBe('e.txt');
    expect(a.children[1].isFolder).toBe(false);
    expect(a.leafPaths).toEqual(['a/b/c.txt', 'a/b/d.txt', 'a/e.txt']);
  });

  it('maintains input order', () => {
    const tree = buildColumnTree(['b/x.txt', 'a/y.txt', 'c.txt']);
    expect(tree.map(n => n.name)).toEqual(['b', 'a', 'c.txt']);
  });

  it('handles single file in folder', () => {
    const tree = buildColumnTree(['folder/file.txt']);
    expect(tree).toHaveLength(1);
    expect(tree[0].isFolder).toBe(true);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe('file.txt');
    expect(tree[0].leafPaths).toEqual(['folder/file.txt']);
  });
});

describe('computeColumnGrid', () => {
  it('returns empty grid for empty tree', () => {
    const grid = computeColumnGrid([], new Set());
    expect(grid.depth).toBe(0);
    expect(grid.headerRows).toEqual([]);
    expect(grid.leafColumns).toEqual([]);
  });

  it('root files only: single row, all as leaf columns', () => {
    const tree = buildColumnTree(['a.txt', 'b.txt', 'c.txt']);
    const grid = computeColumnGrid(tree, new Set());
    expect(grid.depth).toBe(1);
    expect(grid.leafColumns).toHaveLength(3);
    expect(grid.headerRows).toHaveLength(1);
    expect(grid.headerRows[0]).toHaveLength(3);
    // All files get rowspan = 1 (depth - level = 1 - 0)
    expect(grid.headerRows[0][0].rowspan).toBe(1);
    expect(grid.headerRows[0][0].colspan).toBe(1);
  });

  it('all collapsed: folders as single leaf columns', () => {
    const tree = buildColumnTree(['docs/a.txt', 'docs/b.txt', 'readme.md']);
    const grid = computeColumnGrid(tree, new Set());
    expect(grid.depth).toBe(1);
    expect(grid.leafColumns).toHaveLength(2); // docs/ and readme.md
    expect(grid.headerRows).toHaveLength(1);
    expect(grid.headerRows[0]).toHaveLength(2);
    expect(grid.headerRows[0][0].node.name).toBe('docs');
    expect(grid.headerRows[0][0].colspan).toBe(1);
    expect(grid.headerRows[0][0].rowspan).toBe(1);
    expect(grid.headerRows[0][1].node.name).toBe('readme.md');
  });

  it('one folder expanded: two header rows', () => {
    const tree = buildColumnTree(['docs/a.txt', 'docs/b.txt', 'readme.md']);
    const grid = computeColumnGrid(tree, new Set(['docs']));
    expect(grid.depth).toBe(2);
    expect(grid.leafColumns).toHaveLength(3); // a.txt, b.txt, readme.md
    expect(grid.headerRows).toHaveLength(2);
    // Row 0: docs(cs=2, rs=1), readme.md(cs=1, rs=2)
    expect(grid.headerRows[0]).toHaveLength(2);
    expect(grid.headerRows[0][0].node.name).toBe('docs');
    expect(grid.headerRows[0][0].colspan).toBe(2);
    expect(grid.headerRows[0][0].rowspan).toBe(1);
    expect(grid.headerRows[0][1].node.name).toBe('readme.md');
    expect(grid.headerRows[0][1].colspan).toBe(1);
    expect(grid.headerRows[0][1].rowspan).toBe(2);
    // Row 1: a.txt, b.txt
    expect(grid.headerRows[1]).toHaveLength(2);
    expect(grid.headerRows[1][0].node.name).toBe('a.txt');
    expect(grid.headerRows[1][1].node.name).toBe('b.txt');
  });

  it('nested expansion: three header rows', () => {
    const tree = buildColumnTree([
      'docs/api/auth.txt',
      'docs/api/users.txt',
      'docs/readme.txt',
      'notes.md',
    ]);
    const grid = computeColumnGrid(tree, new Set(['docs', 'docs/api']));
    expect(grid.depth).toBe(3);
    expect(grid.leafColumns).toHaveLength(4);
    // Row 0: docs(cs=3, rs=1), notes.md(cs=1, rs=3)
    expect(grid.headerRows[0][0].node.name).toBe('docs');
    expect(grid.headerRows[0][0].colspan).toBe(3);
    expect(grid.headerRows[0][0].rowspan).toBe(1);
    expect(grid.headerRows[0][1].node.name).toBe('notes.md');
    expect(grid.headerRows[0][1].rowspan).toBe(3);
    // Row 1: api(cs=2, rs=1), readme.txt(cs=1, rs=2)
    expect(grid.headerRows[1][0].node.name).toBe('api');
    expect(grid.headerRows[1][0].colspan).toBe(2);
    expect(grid.headerRows[1][0].rowspan).toBe(1);
    expect(grid.headerRows[1][1].node.name).toBe('readme.txt');
    expect(grid.headerRows[1][1].rowspan).toBe(2);
    // Row 2: auth.txt, users.txt
    expect(grid.headerRows[2]).toHaveLength(2);
    expect(grid.headerRows[2][0].node.name).toBe('auth.txt');
    expect(grid.headerRows[2][1].node.name).toBe('users.txt');
  });

  it('leaf columns have correct leafPaths', () => {
    const tree = buildColumnTree(['docs/a.txt', 'docs/b.txt', 'readme.md']);
    // Collapsed: docs/ folder's leafPaths should include both files
    const collapsed = computeColumnGrid(tree, new Set());
    expect(collapsed.leafColumns[0].leafPaths).toEqual(['docs/a.txt', 'docs/b.txt']);
    expect(collapsed.leafColumns[1].leafPaths).toEqual(['readme.md']);
    // Expanded: individual files
    const expanded = computeColumnGrid(tree, new Set(['docs']));
    expect(expanded.leafColumns[0].leafPaths).toEqual(['docs/a.txt']);
    expect(expanded.leafColumns[1].leafPaths).toEqual(['docs/b.txt']);
    expect(expanded.leafColumns[2].leafPaths).toEqual(['readme.md']);
  });

  it('partially expanded: mix of collapsed and expanded folders', () => {
    const tree = buildColumnTree([
      'a/x.txt',
      'b/y.txt',
      'b/z.txt',
    ]);
    // Only expand 'b', leave 'a' collapsed
    const grid = computeColumnGrid(tree, new Set(['b']));
    expect(grid.depth).toBe(2);
    expect(grid.leafColumns).toHaveLength(3); // a/ (collapsed), y.txt, z.txt
    // Row 0: a(cs=1, rs=2), b(cs=2, rs=1)
    expect(grid.headerRows[0][0].node.name).toBe('a');
    expect(grid.headerRows[0][0].rowspan).toBe(2);
    expect(grid.headerRows[0][1].node.name).toBe('b');
    expect(grid.headerRows[0][1].colspan).toBe(2);
    // Row 1: y.txt, z.txt
    expect(grid.headerRows[1]).toHaveLength(2);
  });

  it('expanding non-existent folder has no effect', () => {
    const tree = buildColumnTree(['a.txt', 'b.txt']);
    const grid = computeColumnGrid(tree, new Set(['nonexistent']));
    expect(grid.depth).toBe(1);
    expect(grid.leafColumns).toHaveLength(2);
  });
});
