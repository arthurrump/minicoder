#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function printUsage() {
  console.log('Usage: node scripts/compare-mcs-by-user.mjs <source-or-mcs-file-or-dir> [...more] [--users usersCsv] [--codebooks dir]');
  console.log('Example: node scripts/compare-mcs-by-user.mjs ./data/interview.txt ./data/other.txt --users alice,bob --codebooks ./data');
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

  if (positional.length === 0) {
    printUsage();
    process.exit(1);
  }

  let sourceInputs = positional;

  // Backward compatibility for old positional form:
  // <source> [usersCsv] [codebookDir]
  if (
    !options.usersCsv
    && positional.length >= 2
    && !fs.existsSync(path.resolve(positional[1]))
  ) {
    sourceInputs = [positional[0]];
    options.usersCsv = positional[1];
    if (!options.codebookDir && positional[2]) {
      options.codebookDir = positional[2];
    }
  }

  return {
    sourceInputs,
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

function unique(values) {
  return [...new Set(values)];
}

function expandSourceInputs(sourceInputs) {
  const expanded = [];
  for (const input of sourceInputs) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      expanded.push(resolved);
      continue;
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      const mcsFiles = walkFiles(resolved, '.mcs');
      for (const mcsPath of mcsFiles) {
        expanded.push(mcsPath);
      }
      continue;
    }

    expanded.push(resolved);
  }

  return unique(expanded);
}

function disambiguatePaths(paths) {
  const result = new Map();
  const byFileName = new Map();

  for (const p of paths) {
    const fileName = p.split('/').pop() || p;
    if (!byFileName.has(fileName)) byFileName.set(fileName, []);
    byFileName.get(fileName).push(p);
  }

  for (const [fileName, group] of byFileName) {
    if (group.length === 1) {
      result.set(group[0], fileName);
      continue;
    }

    const parts = group.map((p) => p.split('/').reverse());
    for (let i = 0; i < group.length; i += 1) {
      const current = parts[i];
      let segmentsNeeded = 1;

      for (let j = 0; j < group.length; j += 1) {
        if (i === j) continue;
        const other = parts[j];
        let k = 0;
        while (k < current.length && k < other.length && current[k] === other[k]) {
          k += 1;
        }
        segmentsNeeded = Math.max(segmentsNeeded, k + 1);
      }

      const label = current.slice(0, Math.min(segmentsNeeded, current.length)).reverse().join('/');
      result.set(group[i], label);
    }
  }

  return result;
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

function analyzeSingleSource(sourceOrMcs, usersCsv, codebookDir) {
  const { sourcePath, mcsPath } = normalizePaths(sourceOrMcs);

  if (!fs.existsSync(mcsPath)) {
    console.error(`Missing .mcs file: ${mcsPath}`);
    return null;
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

  return {
    sourcePath,
    mcsPath,
    resolvedCodebookDir: path.resolve(codebookDir || path.dirname(sourcePath)),
    filteredCount: filtered.length,
    matched: matchedGuids.size,
    conflicted: conflictGuids.size,
    lonely: lonelySelections.length,
    sortedUsers,
    sourceText,
    codeNameMap,
    matchGroups,
    conflictGroups,
    lonelyGroups,
    sortedCodebooks,
    codebookMetaByGuid,
    matchingByCodebook,
    conflictingByCodebook,
    lonelyByCodebook,
    lonelyByCodebookAndUser,
  };
}

function printCombinedSummary(analyses, failedCount) {
  const users = unique(analyses.flatMap((a) => a.sortedUsers)).sort((a, b) => a.localeCompare(b));
  const codebookMetaByGuid = new Map();
  const matchingByCodebook = new Map();
  const conflictingByCodebook = new Map();
  const lonelyByCodebook = new Map();
  const lonelyByCodebookAndUser = new Map();

  let matched = 0;
  let conflicted = 0;
  let lonely = 0;
  let considered = 0;

  for (const analysis of analyses) {
    matched += analysis.matched;
    conflicted += analysis.conflicted;
    lonely += analysis.lonely;
    considered += analysis.filteredCount;

    for (const [guid, meta] of analysis.codebookMetaByGuid.entries()) {
      if (!codebookMetaByGuid.has(guid)) codebookMetaByGuid.set(guid, meta);
    }

    for (const [guid, count] of analysis.matchingByCodebook.entries()) incrementCount(matchingByCodebook, guid, count);
    for (const [guid, count] of analysis.conflictingByCodebook.entries()) incrementCount(conflictingByCodebook, guid, count);
    for (const [guid, count] of analysis.lonelyByCodebook.entries()) incrementCount(lonelyByCodebook, guid, count);

    for (const [guid, byUser] of analysis.lonelyByCodebookAndUser.entries()) {
      if (!lonelyByCodebookAndUser.has(guid)) lonelyByCodebookAndUser.set(guid, new Map());
      for (const [user, count] of byUser.entries()) {
        incrementCount(lonelyByCodebookAndUser.get(guid), user, count);
      }
    }
  }

  const sortedCodebooks = [...codebookMetaByGuid.values()].sort((a, b) => {
    const byTree = fileTreeCompare(a.relativePath, b.relativePath);
    if (byTree !== 0) return byTree;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  console.log(`- Files processed: ${analyses.length}`);
  console.log(`- Files failed: ${failedCount}`);
  console.log(`- Users: ${users.join(', ') || '(none)'}`);
  console.log(`- Selections considered: ${considered}`);

  console.log('\nCounts');
  console.log(`- Matching selections: ${matched}`);
  console.log(`- Conflicting selections: ${conflicted}`);
  console.log(`- Lonely selections: ${lonely}`);
  for (const user of users) {
    const lonelyByUser = analyses.reduce((sum, analysis) => {
      let fileCount = 0;
      for (const byUser of analysis.lonelyByCodebookAndUser.values()) {
        fileCount += byUser.get(user) ?? 0;
      }
      return sum + fileCount;
    }, 0);
    console.log(`  - By ${user}: ${lonelyByUser}`);
  }

  console.log('\nPer codebook');
  console.log(`| Codebook | Matching | Conflicting | Lonely | ${users.map(u => `Lonely by ${u}`).join(' | ')} |`);
  console.log(`|----------|----------|-------------|--------|${users.map(u => '-'.repeat(`Lonely by ${u}`.length + 2)).join('|')}|`);
  for (const codebook of sortedCodebooks) {
    const lonelyByUser = lonelyByCodebookAndUser.get(codebook.guid) ?? new Map();
    const lonelyUserCols = users.map((user) => lonelyByUser.get(user) ?? 0);
    console.log(
      `| ${codebook.name} | ${matchingByCodebook.get(codebook.guid) ?? 0} | ${conflictingByCodebook.get(codebook.guid) ?? 0} | ${lonelyByCodebook.get(codebook.guid) ?? 0} | ${lonelyUserCols.join(' | ')} |`
    );
  }
}

function printFileDetails(analyses) {
  const labels = disambiguatePaths(analyses.map((a) => a.sourcePath));

  for (const analysis of analyses) {
    console.log(`\n\n# ${labels.get(analysis.sourcePath)}`);
    console.log(`- Source file: ${analysis.sourcePath}`);
    console.log(`- MCS file: ${analysis.mcsPath}`);
    console.log(`- Codebook directory: ${analysis.resolvedCodebookDir}`);
    console.log(`- Selections considered: ${analysis.filteredCount}`);

    printGroupSection('Matching', 'Match', analysis.matchGroups, analysis.sourceText, analysis.codeNameMap);
    printGroupSection('Conflicting', 'Conflict', analysis.conflictGroups, analysis.sourceText, analysis.codeNameMap);
    printGroupSection('Lonely', 'Lonely', analysis.lonelyGroups, analysis.sourceText, analysis.codeNameMap);
  }
}

function main() {
  const { sourceInputs, usersCsv, codebookDir } = parseArgs(process.argv.slice(2));
  const expandedInputs = expandSourceInputs(sourceInputs);

  if (expandedInputs.length === 0) {
    console.error('No source files found.');
    process.exit(1);
  }

  const analyses = [];
  let failed = 0;

  for (let i = 0; i < expandedInputs.length; i += 1) {
    const input = expandedInputs[i];

    const result = analyzeSingleSource(input, usersCsv, codebookDir);
    if (!result) {
      failed += 1;
      continue;
    }

    analyses.push(result);
  }

  if (analyses.length === 0) {
    process.exit(1);
  }

  printCombinedSummary(analyses, failed);
  printFileDetails(analyses);
}

main();
