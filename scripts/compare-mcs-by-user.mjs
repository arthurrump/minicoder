#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function printUsage() {
  console.log('Usage: node scripts/compare-mcs-by-user.mjs <source-or-mcs-file> [usersCsv] [codebookDir]');
  console.log('Example: node scripts/compare-mcs-by-user.mjs ./data/interview.txt alice,bob ./data');
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    usersCsv: undefined,
    codebookDir: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--users' || arg === '-u') {
      options.usersCsv = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--codebooks' || arg === '-c') {
      options.codebookDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    positional.push(arg);
  }

  const sourceOrMcs = positional[0];
  if (!sourceOrMcs) {
    printUsage();
    process.exit(1);
  }

  if (!options.usersCsv && positional[1]) {
    options.usersCsv = positional[1];
  }
  if (!options.codebookDir && positional[2]) {
    options.codebookDir = positional[2];
  }

  return {
    sourceOrMcs,
    usersCsv: options.usersCsv,
    codebookDir: options.codebookDir,
  };
}

function normalizePaths(sourceOrMcs) {
  const abs = path.resolve(sourceOrMcs);
  if (abs.endsWith('.mcs')) {
    return {
      mcsPath: abs,
      sourcePath: abs.slice(0, -4),
    };
  }
  return {
    sourcePath: abs,
    mcsPath: `${abs}.mcs`,
  };
}

function readJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text);
}

function walkFiles(dir, extension, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, extension, results);
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      results.push(full);
    }
  }
  return results;
}

function fileTreeCompare(pathA, pathB) {
  const partsA = pathA.split('/');
  const partsB = pathB.split('/');
  const minLen = Math.min(partsA.length, partsB.length);

  for (let i = 0; i < minLen; i += 1) {
    const isLastA = i === partsA.length - 1;
    const isLastB = i === partsB.length - 1;

    if (isLastA && !isLastB) return -1;
    if (!isLastA && isLastB) return 1;

    const cmp = partsA[i].localeCompare(partsB[i], undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
  }

  return partsA.length - partsB.length;
}

function buildCodeNameMap(codebookDir) {
  const codeNameMap = new Map();
  const codebookMetaByGuid = new Map();
  if (!codebookDir || !fs.existsSync(codebookDir)) {
    return { codeNameMap, codebookMetaByGuid };
  }

  const resolvedCodebookDir = path.resolve(codebookDir);
  const mccFiles = walkFiles(resolvedCodebookDir, '.mcc');
  for (const filePath of mccFiles) {
    try {
      const codebook = readJson(filePath);
      if (!codebook || typeof codebook.guid !== 'string' || !Array.isArray(codebook.codes)) {
        continue;
      }
      const codebookName = typeof codebook.name === 'string' ? codebook.name : codebook.guid;
      const relativePath = path.relative(resolvedCodebookDir, filePath).replace(/\\/g, '/');
      codebookMetaByGuid.set(codebook.guid, {
        guid: codebook.guid,
        name: codebookName,
        relativePath,
      });

      const visit = (codes, parents) => {
        for (const code of codes) {
          if (!code || typeof code.guid !== 'string') continue;
          const name = typeof code.name === 'string' ? code.name : code.guid;
          const lineage = [...parents, name];
          codeNameMap.set(`${codebook.guid}:${code.guid}`, `${codebookName} > ${lineage.join(' > ')}`);
          if (Array.isArray(code.subcodes) && code.subcodes.length > 0) {
            visit(code.subcodes, lineage);
          }
        }
      };
      visit(codebook.codes, []);
    } catch (error) {
      console.warn(`Skipping invalid codebook file: ${filePath}`);
    }
  }

  return { codeNameMap, codebookMetaByGuid };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function codeKey(selection) {
  return `${selection.code.codebookGuid}:${selection.code.codeGuid}`;
}

function buildAdjacency(items, relation) {
  const edges = new Map();
  for (const item of items) {
    edges.set(item.guid, new Set());
  }
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (relation(a, b)) {
        edges.get(a.guid).add(b.guid);
        edges.get(b.guid).add(a.guid);
      }
    }
  }
  return edges;
}

function collectNodesWithEdges(adjacency) {
  const nodes = new Set();
  for (const [guid, neighbors] of adjacency.entries()) {
    if (neighbors.size > 0) {
      nodes.add(guid);
      for (const other of neighbors) nodes.add(other);
    }
  }
  return nodes;
}

function connectedComponents(itemsByGuid, adjacency, guids) {
  const groups = [];
  const visited = new Set();

  for (const guid of guids) {
    if (visited.has(guid)) continue;
    const stack = [guid];
    visited.add(guid);
    const group = [];

    while (stack.length > 0) {
      const current = stack.pop();
      const currentSelection = itemsByGuid.get(current);
      if (currentSelection) group.push(currentSelection);

      const neighbors = adjacency.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }

    group.sort((a, b) => a.start - b.start || a.end - b.end || a.guid.localeCompare(b.guid));
    groups.push(group);
  }

  groups.sort((a, b) => a[0].start - b[0].start || a[0].end - b[0].end);
  return groups;
}

function compactText(text, maxLen = 80) {
  const compact = text.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ');
  if (compact.length < maxLen) return compact;
  return `${compact.slice(0, maxLen - 3)}...`;
}

function getSnippet(sourceText, start, end) {
  if (typeof sourceText !== 'string') {
    return '(source text unavailable)';
  }
  const safeStart = Math.max(0, Math.min(start, sourceText.length));
  const safeEnd = Math.max(safeStart, Math.min(end, sourceText.length));
  return sourceText.slice(safeStart, safeEnd).trim();
}

function resolveCodeName(selection, codeNameMap) {
  const key = codeKey(selection);
  return codeNameMap.get(key) || `${selection.code.codebookGuid}:${selection.code.codeGuid}`;
}

function usersInGroup(group) {
  return [...new Set(group.map(s => s.creatingUser).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function codesByUser(group, codeNameMap) {
  const result = new Map();
  for (const selection of group) {
    const user = selection.creatingUser || '(unknown)';
    if (!result.has(user)) result.set(user, new Set());
    result.get(user).add(resolveCodeName(selection, codeNameMap));
  }
  return result;
}

function printGroupSection(title, type, groups, sourceText, codeNameMap) {
  console.log(`\n## ${title} (${groups.length} group${groups.length === 1 ? '' : 's'})`);
  if (groups.length === 0) {
    console.log('(none)');
    return;
  }

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const minStart = Math.min(...group.map(s => s.start));
    const maxEnd = Math.max(...group.map(s => s.end));
    const overlapSnippet = getSnippet(sourceText, minStart, maxEnd);

    console.log(`### ${type} ${i + 1}: [${minStart}, ${maxEnd})`);
    console.log()
    for (const line of overlapSnippet.split('\n')) console.log(`> ${line}`);
    console.log()
    
    const groupedCodes = codesByUser(group, codeNameMap);
    console.log('Coded by:');
    for (const [user, codes] of groupedCodes.entries()) {
      const sortedCodes = [...codes].sort((a, b) => a.localeCompare(b));
      console.log(`- __${user}__: ${sortedCodes.map(c => `*${c}*`).join(' | ')}`);
    }
    console.log()

    console.log('Selections:');
    for (const selection of group) {
      const snippet = getSnippet(sourceText, selection.start, selection.end, 80);
      const name = resolveCodeName(selection, codeNameMap);
      console.log(`- *${name}* by __${selection.creatingUser}__ at [${selection.start}, ${selection.end})`);
      console.log(`  > "${compactText(snippet)}"`);
    }
    console.log()
  }
}

function incrementCount(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function getCodebookGuid(selection) {
  return selection.code.codebookGuid;
}

function main() {
  const { sourceOrMcs, usersCsv, codebookDir } = parseArgs(process.argv.slice(2));
  const { sourcePath, mcsPath } = normalizePaths(sourceOrMcs);

  if (!fs.existsSync(mcsPath)) {
    console.error(`Missing .mcs file: ${mcsPath}`);
    process.exit(1);
  }

  let sourceText = null;
  if (fs.existsSync(sourcePath)) {
    sourceText = fs.readFileSync(sourcePath, 'utf8');
  }

  const source = readJson(mcsPath);
  const allSelections = Array.isArray(source?.selections) ? source.selections : [];

  const withUsers = allSelections.filter(
    s => s
      && typeof s.guid === 'string'
      && typeof s.start === 'number'
      && typeof s.end === 'number'
      && s.code
      && typeof s.code.codebookGuid === 'string'
      && typeof s.code.codeGuid === 'string'
      && typeof s.creatingUser === 'string'
      && s.creatingUser.trim().length > 0,
  );

  const requestedUsers = usersCsv
    ? usersCsv.split(',').map(u => u.trim()).filter(Boolean)
    : null;

  const activeUsers = requestedUsers
    ? new Set(requestedUsers)
    : new Set(withUsers.map(s => s.creatingUser));

  const filtered = withUsers
    .filter(s => activeUsers.has(s.creatingUser))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.guid.localeCompare(b.guid));

  const itemsByGuid = new Map(filtered.map(s => [s.guid, s]));
  const { codeNameMap, codebookMetaByGuid } = buildCodeNameMap(codebookDir || path.dirname(sourcePath));

  const matchAdjacency = buildAdjacency(filtered, (a, b) => {
    return overlaps(a, b)
      && a.creatingUser !== b.creatingUser
      && codeKey(a) === codeKey(b);
  });
  const matchedGuids = collectNodesWithEdges(matchAdjacency);
  const matchGroups = connectedComponents(itemsByGuid, matchAdjacency, matchedGuids);

  const remainingAfterMatch = filtered.filter(s => !matchedGuids.has(s.guid));
  const remainingByGuid = new Map(remainingAfterMatch.map(s => [s.guid, s]));

  const conflictAdjacency = buildAdjacency(remainingAfterMatch, (a, b) => {
    return overlaps(a, b)
      && a.creatingUser !== b.creatingUser
      && codeKey(a) !== codeKey(b);
  });
  const conflictGuids = collectNodesWithEdges(conflictAdjacency);
  const conflictGroups = connectedComponents(remainingByGuid, conflictAdjacency, conflictGuids);

  const lonelySelections = remainingAfterMatch.filter(s => !conflictGuids.has(s.guid));
  const lonelyGroups = lonelySelections.map(s => [s]);
  const sortedUsers = [...activeUsers].sort((a, b) => a.localeCompare(b));

  const matchingByCodebook = new Map();
  const conflictingByCodebook = new Map();
  const lonelyByCodebook = new Map();
  const lonelyByCodebookAndUser = new Map();

  for (const selection of filtered) {
    const codebookGuid = getCodebookGuid(selection);
    if (!codebookMetaByGuid.has(codebookGuid)) {
      codebookMetaByGuid.set(codebookGuid, {
        guid: codebookGuid,
        name: codebookGuid,
        relativePath: codebookGuid,
      });
    }

    if (matchedGuids.has(selection.guid)) {
      incrementCount(matchingByCodebook, codebookGuid);
    }
    if (conflictGuids.has(selection.guid)) {
      incrementCount(conflictingByCodebook, codebookGuid);
    }
  }

  for (const selection of lonelySelections) {
    const codebookGuid = getCodebookGuid(selection);
    incrementCount(lonelyByCodebook, codebookGuid);

    if (!lonelyByCodebookAndUser.has(codebookGuid)) {
      lonelyByCodebookAndUser.set(codebookGuid, new Map());
    }
    incrementCount(lonelyByCodebookAndUser.get(codebookGuid), selection.creatingUser);
  }

  const sortedCodebooks = [...codebookMetaByGuid.values()].sort((a, b) => {
    const byTree = fileTreeCompare(a.relativePath, b.relativePath);
    if (byTree !== 0) return byTree;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  console.log('# MCS User Comparison');
  console.log(`- Source file: ${sourcePath}`);
  console.log(`- MCS file: ${mcsPath}`);
  console.log(`- Codebook directory: ${path.resolve(codebookDir || path.dirname(sourcePath))}`);
  console.log(`- Users: ${sortedUsers.join(', ') || '(none)'}`);
  console.log(`- Selections considered: ${filtered.length}`);

  console.log('\nCounts');
  console.log(`- Matching selections: ${matchedGuids.size}`);
  console.log(`- Conflicting selections: ${conflictGuids.size}`);
  console.log(`- Lonely selections: ${lonelySelections.length}`);
  for (const user of sortedUsers) console.log(`  - By ${user}: ${lonelySelections.filter(s => s.creatingUser === user).length}`);

  console.log('\nPer codebook');
  console.log(`| Codebook | Matching | Conflicting | Lonely | ${sortedUsers.map(u => `Lonely by ${u}`).join(' | ')} |`);
  console.log(`|----------|----------|-------------|--------|${sortedUsers.map(u => '-'.repeat(`Lonely by ${u}`.length + 2)).join('|')}|`);
  for (const codebook of sortedCodebooks) {
    const lonelyByUser = lonelyByCodebookAndUser.get(codebook.guid) ?? new Map();
    const lonelyUserCols = sortedUsers.map((user) => lonelyByUser.get(user) ?? 0);
    console.log(
      `| ${codebook.name} | ${matchingByCodebook.get(codebook.guid) ?? 0} | ${conflictingByCodebook.get(codebook.guid) ?? 0} | ${lonelyByCodebook.get(codebook.guid) ?? 0} | ${lonelyUserCols.join(' | ')} |`
    );
  }

  printGroupSection('Matching', 'Match', matchGroups, sourceText, codeNameMap);
  printGroupSection('Conflicting', 'Conflict', conflictGroups, sourceText, codeNameMap);
  printGroupSection('Lonely', 'Lonely', lonelyGroups, sourceText, codeNameMap);
}

main();
