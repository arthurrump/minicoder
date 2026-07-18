#!/usr/bin/env node
// Generates a static HTML report of which codes have been applied to each
// "case" (top-level folder) in a minicoder data directory. The report only
// shows whether a case was coded with a given code (via a text selection or
// a source-level code) -- it never shows counts or raw source text.
//
// Optionally, a curated quotes sidecar (quotes.json, see --quotes) lets you
// surface cleaned/translated/de-identified excerpts on code and case pages.
// Each quote references a TextSelection guid from an .mcs file; the script
// resolves the case, code, and source path from that guid automatically, so
// only the curated text ever reaches the report (never raw source content).
//
// Output: <outDir>/index.html (one table per codebook, codes x cases, similar
// to the in-app Dashboard) plus <outDir>/codes/<code>.html (one page per code)
// and <outDir>/cases/<case>.html (one page per case).

import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);

const DEFAULT_QUOTES_FILE = 'quotes.json';

function printUsage() {
  console.log('Usage: node scripts/generate-case-report.mjs [dataDir] [--out outDir] [--codebooks patterns] [--quotes file]');
  console.log();
  console.log('Recursively scans dataDir for .mcc codebooks and .mcs coded sources, groups');
  console.log('sources by the top-level folder they live in (their "case"), and writes a');
  console.log('static HTML report to outDir: an index.html with one table per codebook');
  console.log('(codes x cases, similar to the in-app Dashboard) plus one page per code and');
  console.log('one page per case. Only whether a case was coded with a code is shown -- no');
  console.log('counts or raw source text.');
  console.log();
  console.log('  dataDir            Directory to scan (default: current directory)');
  console.log('  --out, -o          Output directory (default: <dataDir>/report)');
  console.log('  --codebooks, -c    Comma-separated list of globs to limit which codebooks');
  console.log('                     are included, matched against each codebook\'s name and');
  console.log('                     its .mcc path relative to dataDir (default: all codebooks).');
  console.log('                     A pattern ending in "/" matches every codebook under that');
  console.log('                     folder. Cases with no coding under the selected codebooks');
  console.log('                     are left out of the tables.');
  console.log('  --quotes file      Path to a curated quotes sidecar (default: <dataDir>/quotes.json).');
  console.log('                     Each entry is { "selection": <TextSelection guid>, "quote": <string>,');
  console.log('                     "translation"?: <string>, "note"?: <string> }. The selection guid');
  console.log('                     resolves the case, code, and source path automatically; only your');
  console.log('                     curated text reaches the report. Pass "" or --no-quotes to disable.');
  console.log('                     Only selection-level codes can carry quotes (source-level codes have');
  console.log('                     no guid to reference).');
  console.log('  --help, -h         Show this help message');
  console.log();
  console.log('Example: node scripts/generate-case-report.mjs ./data --out ./data/report');
  console.log('Example: node scripts/generate-case-report.mjs ./data --codebooks "./analytic/"');
  console.log('Example: node scripts/generate-case-report.mjs ./data -c "Themes,rubrics/**"');
}

function parseArgs(argv) {
  let dataDir;
  let outDir;
  let codebooksFilter;
  let quotesFile;
  let noQuotes = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--out' || arg === '-o') {
      outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--codebooks' || arg === '-c') {
      codebooksFilter = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--no-quotes') {
      noQuotes = true;
      continue;
    }
    if (arg === '--quotes' || arg === '-q') {
      quotesFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (!dataDir) {
      dataDir = arg;
    }
  }

  dataDir = dataDir || '.';
  outDir = outDir || path.join(dataDir, 'report');
  return { dataDir, outDir, codebooksFilter, quotesFile, noQuotes };
}

// ---------- Filesystem helpers ----------

function walkFiles(dir, extension, skipAbsDirs, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`Could not read directory ${dir}: ${error.message}`);
    return results;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (skipAbsDirs.has(path.resolve(full))) continue;
      walkFiles(full, extension, skipAbsDirs, results);
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      results.push(full);
    }
  }

  return results;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toRelativePath(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

// ---------- Validation (ported from src/helpers.ts) ----------

function validateCodebook(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.guid !== 'string' || !obj.guid) return null;
  if (typeof obj.name !== 'string') return null;
  if (!Array.isArray(obj.codes)) return null;
  return obj;
}

function validateSource(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.guid !== 'string' || !obj.guid) return null;
  if (typeof obj.fileHash !== 'string') return null;
  if (!Array.isArray(obj.selections)) return null;
  return obj;
}

// ---------- Codebook filtering (glob matching ported from src/utils/query.ts) ----------

function parseFilterList(filter) {
  if (!filter) return [];
  return filter
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

// A trailing "/" unambiguously means "everything under this folder", so we
// expand it to the "/**" glob suffix. A leading "./" is stripped since our
// relative paths never carry one. Bare names (no slash, no wildcard) are left
// as literal, exact (case-insensitive) matches -- same convention as the
// app's own file-filter globs (see QueryEditor's "e.g. interviews/**/*.txt").
function normalizeCodebookFilterPattern(pattern) {
  let p = pattern;
  if (p.startsWith('./')) p = p.slice(2);
  if (p.endsWith('/')) p = `${p}**`;
  return p;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withDoubleStar = escaped.replace(/\*\*/g, '___DOUBLE_STAR___');
  const withSingleStar = withDoubleStar.replace(/\*/g, '[^/]*');
  const withQuestion = withSingleStar.replace(/\?/g, '.');
  const finalPattern = withQuestion.replace(/___DOUBLE_STAR___/g, '.*');
  return new RegExp(`^${finalPattern}$`, 'i');
}

function compileGlobs(patterns) {
  return patterns.map((p) => globToRegExp(normalizeCodebookFilterPattern(p)));
}

function matchesAnyGlob(value, compiled) {
  if (compiled.length === 0) return true;
  return compiled.some((re) => re.test(value));
}

// A codebook is included if no filter is set, or if any pattern matches
// either its display name ("Themes") or its .mcc path relative to the data
// directory ("analytic/themes.mcc").
function codebookMatchesFilter(codebook, relPath, compiledPatterns) {
  return matchesAnyGlob(relPath, compiledPatterns) || matchesAnyGlob(codebook.name, compiledPatterns);
}

// ---------- Loading ----------

function loadCodebooks(dataDir, skipAbsDirs) {
  const files = walkFiles(dataDir, '.mcc', skipAbsDirs);
  const codebooks = new Map(); // guid -> Codebook
  const codebookPath = new Map(); // guid -> relative path (for sort order)
  let invalid = 0;

  for (const absPath of files) {
    const relPath = toRelativePath(dataDir, absPath);
    let parsed = null;
    try {
      parsed = validateCodebook(readJson(absPath));
    } catch {
      parsed = null;
    }

    if (!parsed) {
      console.warn(`Skipping invalid codebook file: ${relPath}`);
      invalid += 1;
      continue;
    }
    if (codebooks.has(parsed.guid)) {
      console.warn(`Duplicate codebook guid in ${relPath} (keeping ${codebookPath.get(parsed.guid)})`);
      continue;
    }

    codebooks.set(parsed.guid, parsed);
    codebookPath.set(parsed.guid, relPath);
  }

  return { codebooks, codebookPath, invalid };
}

function loadSources(dataDir, skipAbsDirs) {
  const files = walkFiles(dataDir, '.mcs', skipAbsDirs);
  const sources = new Map(); // relative source path (".mcs" stripped) -> Source
  let invalid = 0;

  for (const absPath of files) {
    const relMcsPath = toRelativePath(dataDir, absPath);
    let parsed = null;
    try {
      parsed = validateSource(readJson(absPath));
    } catch {
      parsed = null;
    }

    if (!parsed) {
      console.warn(`Skipping invalid source file: ${relMcsPath}`);
      invalid += 1;
      continue;
    }

    const relSourcePath = relMcsPath.slice(0, -4); // strip trailing ".mcs"
    sources.set(relSourcePath, parsed);
  }

  return { sources, invalid };
}

// ---------- Selection index (for curated quotes resolution) ----------

// Build a map of every TextSelection guid across all loaded sources to its
// { sourcePath, caseId, code, start, end }. Used to resolve curated quote
// entries (which only carry a selection guid) to the case + code + source
// path they belong to -- without ever reading the source file's content.
function buildSelectionIndex(sources) {
  const index = new Map(); // selectionGuid -> { sourcePath, caseId, code, start, end }
  let duplicateCount = 0;

  for (const [sourcePath, source] of sources.entries()) {
    const caseId = caseIdForSourcePath(sourcePath);
    for (const sel of source.selections ?? []) {
      if (typeof sel?.guid !== 'string') continue;
      if (index.has(sel.guid)) {
        duplicateCount += 1;
        continue;
      }
      index.set(sel.guid, {
        sourcePath,
        caseId,
        code: sel.code, // { codebookGuid, codeGuid }
        start: typeof sel.start === 'number' ? sel.start : null,
        end: typeof sel.end === 'number' ? sel.end : null,
      });
    }
  }

  if (duplicateCount > 0) {
    console.warn(`${duplicateCount} duplicate TextSelection guid(s) found across .mcs files (keeping first).`);
  }
  return index;
}

// ---------- Curated quotes sidecar ----------

function validateQuoteEntry(obj, idx) {
  if (!obj || typeof obj !== 'object') return { valid: false, reason: `entry ${idx}: not an object` };
  if (typeof obj.selection !== 'string' || !obj.selection) return { valid: false, reason: `entry ${idx}: missing or non-string "selection"` };
  if (typeof obj.quote !== 'string' || !obj.quote) return { valid: false, reason: `entry ${idx}: missing or empty "quote"` };
  if (obj.translation != null && typeof obj.translation !== 'string') return { valid: false, reason: `entry ${idx}: "translation" must be a string if present` };
  if (obj.note != null && typeof obj.note !== 'string') return { valid: false, reason: `entry ${idx}: "note" must be a string if present` };
  return { valid: true };
}

// Load raw quotes.json entries (no resolution yet). Returns { entries, invalid }.
// Missing file is NOT an error here -- returns { entries: [], invalid: 0 } with
// a flag so the caller can distinguish "no file" from "had a file with errors".
function loadQuoteEntries(quotesFilePath) {
  if (!quotesFilePath || !fs.existsSync(quotesFilePath)) {
    return { entries: [], invalid: 0, fileExists: false };
  }

  let parsed;
  try {
    parsed = readJson(quotesFilePath);
  } catch (error) {
    console.warn(`Could not parse quotes file ${quotesFilePath}: ${error.message}`);
    return { entries: [], invalid: 0, fileExists: true, parseError: true };
  }

  if (!Array.isArray(parsed)) {
    console.warn(`Quotes file ${quotesFilePath} is not a JSON array; ignoring quotes.`);
    return { entries: [], invalid: 0, fileExists: true, parseError: true };
  }

  const entries = [];
  let invalid = 0;
  for (let i = 0; i < parsed.length; i += 1) {
    const result = validateQuoteEntry(parsed[i], i);
    if (!result.valid) {
      console.warn(`Quotes file: ${result.reason}; skipping entry.`);
      invalid += 1;
      continue;
    }
    entries.push(parsed[i]);
  }

  return { entries, invalid, fileExists: true };
}

// Resolve a quote entry to a renderable object. Returns { status, quote }:
//   status: 'ok' | 'unknown' | 'filtered'
//   quote: the resolved quote (only when status === 'ok')
// `allCodeByGuid` is the index of ALL loaded codebooks (for distinguishing
// "unknown code" from "filtered-out codebook"); `visibleCodeByGuid` is the
// filtered index used for rendering.
function resolveQuoteEntry(entry, selectionIndex, allCodeByGuid, visibleCodeByGuid, idx) {
  const sel = selectionIndex.get(entry.selection);
  if (!sel) {
    console.warn(`Quotes file: selection guid "${entry.selection}" not found in any .mcs file; skipping entry ${idx}.`);
    return { status: 'unknown' };
  }

  const codeGuid = sel.code?.codeGuid;
  if (!codeGuid) {
    console.warn(`Quotes file: selection guid "${entry.selection}" has no code reference; skipping entry ${idx}.`);
    return { status: 'unknown' };
  }

  if (!allCodeByGuid.has(codeGuid)) return { status: 'unknown' };
  if (!visibleCodeByGuid.has(codeGuid)) return { status: 'filtered' };

  const codeEntry = visibleCodeByGuid.get(codeGuid);

  return {
    status: 'ok',
    quote: {
      caseId: sel.caseId,
      code: codeEntry, // { code, codebook, depth, parentGuid }
      quote: entry.quote,
      translation: typeof entry.translation === 'string' ? entry.translation : null,
      note: typeof entry.note === 'string' ? entry.note : null,
    },
  };
}

// Group resolved quotes for efficient rendering:
//   byCodeCase -> Map<codeGuid, Map<caseId, ResolvedQuote[]>>
//   byCaseCode -> Map<caseId, Map<codeGuid, ResolvedQuote[]>>
function groupResolvedQuotes(resolvedQuotes) {
  const byCodeCase = new Map();
  const byCaseCode = new Map();
  for (const q of resolvedQuotes) {
    if (!byCodeCase.has(q.code.code.guid)) byCodeCase.set(q.code.code.guid, new Map());
    const codeMap = byCodeCase.get(q.code.code.guid);
    if (!codeMap.has(q.caseId)) codeMap.set(q.caseId, []);
    codeMap.get(q.caseId).push(q);

    if (!byCaseCode.has(q.caseId)) byCaseCode.set(q.caseId, new Map());
    const caseMap = byCaseCode.get(q.caseId);
    if (!caseMap.has(q.code.code.guid)) caseMap.set(q.code.code.guid, []);
    caseMap.get(q.code.code.guid).push(q);
  }
  return { byCodeCase, byCaseCode };
}

// ---------- Sorting (ported from src/helpers.ts / src/utils/paths.ts) ----------

function fileTreeCompare(pathA, pathB) {
  const partsA = pathA.split('/');
  const partsB = pathB.split('/');
  const minLen = Math.min(partsA.length, partsB.length);

  for (let i = 0; i < minLen; i += 1) {
    const isLastA = i === partsA.length - 1;
    const isLastB = i === partsB.length - 1;

    // A file at this level comes before a subdirectory
    if (isLastA && !isLastB) return -1;
    if (!isLastA && isLastB) return 1;

    const cmp = partsA[i].localeCompare(partsB[i], undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
  }

  return partsA.length - partsB.length;
}

// ---------- Case grouping ----------

const UNCATEGORIZED_CASE_ID = 'Uncategorized';

function caseIdForSourcePath(relSourcePath) {
  const idx = relSourcePath.indexOf('/');
  return idx === -1 ? UNCATEGORIZED_CASE_ID : relSourcePath.slice(0, idx);
}

function compareCaseIds(a, b) {
  if (a === UNCATEGORIZED_CASE_ID && b !== UNCATEGORIZED_CASE_ID) return 1;
  if (b === UNCATEGORIZED_CASE_ID && a !== UNCATEGORIZED_CASE_ID) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// A case is included as a table/page column if at least one of its source
// files has a selection or source-level code that resolves to a code within
// the currently visible (post-filter) set of codebooks. This intentionally
// excludes cases whose only coding lives in a codebook that was filtered out
// (or, without any filter, that references no known codebook at all) -- an
// all-dash column wouldn't be useful.
function computeVisibleCaseIds(sources, visibleCodeByGuid) {
  const caseIds = new Set();
  for (const [sourcePath, source] of sources.entries()) {
    const caseId = caseIdForSourcePath(sourcePath);
    if (caseIds.has(caseId)) continue;
    const applied = [...(source.selections ?? []), ...(source.sourceCodes ?? [])];
    for (const item of applied) {
      const codeGuid = item?.code?.codeGuid;
      if (codeGuid && visibleCodeByGuid.has(codeGuid)) {
        caseIds.add(caseId);
        break;
      }
    }
  }
  return caseIds;
}

// ---------- Code hierarchy (ported from store.tsx indices) ----------

function buildCodeIndex(codebooks) {
  const codeByGuid = new Map(); // guid -> { code, codebook, depth, parentGuid }

  function collect(code, codebook, depth, parentGuid) {
    codeByGuid.set(code.guid, { code, codebook, depth, parentGuid });
    if (Array.isArray(code.subcodes)) {
      for (const sub of code.subcodes) {
        collect(sub, codebook, depth + 1, code.guid);
      }
    }
  }

  for (const codebook of codebooks.values()) {
    for (const code of codebook.codes) {
      collect(code, codebook, 0, null);
    }
  }

  return { codeByGuid };
}

// Preorder flatten of a codebook's code tree (depth-first, parent immediately
// followed by its children) -- matches how CodeRow renders when expanded.
function flattenCodes(codes, codebook, depth = 0, parentGuid = null, out = []) {
  for (const code of codes) {
    out.push({ code, codebook, depth, parentGuid });
    if (Array.isArray(code.subcodes) && code.subcodes.length > 0) {
      flattenCodes(code.subcodes, codebook, depth + 1, code.guid, out);
    }
  }
  return out;
}

// ---------- Presence (which case a code was applied in) ----------

function computePresence(sources, codeByGuid) {
  const directPresence = new Map(); // codeGuid -> Set<caseId>
  let unknownApplications = 0;

  function markApplied(codeGuid, caseId) {
    if (!codeGuid || !codeByGuid.has(codeGuid)) {
      unknownApplications += 1;
      return;
    }
    if (!directPresence.has(codeGuid)) directPresence.set(codeGuid, new Set());
    directPresence.get(codeGuid).add(caseId);
  }

  for (const [sourcePath, source] of sources.entries()) {
    const caseId = caseIdForSourcePath(sourcePath);
    for (const sel of source.selections ?? []) {
      if (sel?.code?.codeGuid) markApplied(sel.code.codeGuid, caseId);
    }
    for (const sc of source.sourceCodes ?? []) {
      if (sc?.code?.codeGuid) markApplied(sc.code.codeGuid, caseId);
    }
  }

  return { directPresence, unknownApplications };
}

// A code is considered "coded" for a case only if that exact code was
// directly applied (via a selection or a source-level code) in that case.
// A subcode being applied does NOT imply its parent code also applies --
// parent and subcode presence are tracked and displayed independently.
function isCodedInCase(codeGuid, caseId, directPresence) {
  return directPresence.get(codeGuid)?.has(caseId) ?? false;
}

// ---------- HTML helpers ----------

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function assignCodeFileNames(sortedCodebooks) {
  const codeFileNames = new Map(); // code guid -> file name (inside codes/)
  const usedNames = new Set();

  for (const codebook of sortedCodebooks) {
    for (const { code } of flattenCodes(codebook.codes, codebook)) {
      const base = slugify(code.name) || 'code';
      let fileName = `${base}-${code.guid.slice(0, 8)}.html`;
      if (usedNames.has(fileName)) {
        fileName = `${base}-${code.guid}.html`;
      }
      usedNames.add(fileName);
      codeFileNames.set(code.guid, fileName);
    }
  }

  return codeFileNames;
}

// Case IDs are already unique top-level folder names, so collisions are rare
// (only possible via case-insensitive slugification, e.g. "Data" vs "DATA").
// Guard against that the same way assignCodeFileNames guards against
// same-named codes: fall back to a disambiguating numeric suffix.
function assignCaseFileNames(sortedCaseIds) {
  const caseFileNames = new Map(); // case id -> file name (inside cases/)
  const usedNames = new Set();

  for (const caseId of sortedCaseIds) {
    const base = slugify(caseId) || 'case';
    let fileName = `${base}.html`;
    let suffix = 2;
    while (usedNames.has(fileName)) {
      fileName = `${base}-${suffix}.html`;
      suffix += 1;
    }
    usedNames.add(fileName);
    caseFileNames.set(caseId, fileName);
  }

  return caseFileNames;
}

function pageShell({ title, relRoot, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${relRoot}assets/style.css">
</head>
<body>
<div class="page">
${bodyHtml}
</div>
</body>
</html>
`;
}

const STYLE_CSS = `:root {
  --bg-color: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-color: #111111;
  --border-color: #cccccc;
  --accent-color: #007acc;
  --font-system: system-ui, -apple-system, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-color: #121212;
    --bg-secondary: #1e1e1e;
    --text-color: #e0e0e0;
    --border-color: #555555;
    --accent-color: #0098ff;
  }
}

* {
  box-sizing: border-box;
}

body {
  font-family: var(--font-system);
  margin: 0;
  background-color: var(--bg-color);
  color: var(--text-color);
  line-height: 1.5;
}

.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 32px 64px;
}

h1 {
  font-size: 1.5rem;
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

h2 {
  font-size: 1.15rem;
  margin: 32px 0 10px;
}

.subtitle {
  opacity: 0.7;
  font-size: 0.875rem;
  margin: 0 0 20px;
}

a {
  color: var(--accent-color);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

.toc {
  margin: 0 0 24px;
  font-size: 0.875rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
}

.toc span {
  opacity: 0.7;
}

.top-nav {
  font-size: 0.875rem;
  margin-bottom: 16px;
}

.breadcrumb {
  font-size: 0.8125rem;
  opacity: 0.75;
  margin-bottom: 8px;
}

.breadcrumb .sep {
  opacity: 0.5;
  margin: 0 2px;
}

.codebook-section {
  margin-bottom: 40px;
}

.empty-message {
  color: #888888;
  font-style: italic;
  font-size: 0.875rem;
  margin: 4px 0 16px;
}

.description {
  margin: 8px 0 16px;
  max-width: 65ch;
}

.table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

table.report-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.8125rem;
}

table.report-table th,
table.report-table td {
  border: 1px solid var(--border-color);
  padding: 6px 10px;
  text-align: center;
  white-space: nowrap;
}

table.report-table th {
  background-color: var(--bg-secondary);
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

table.report-table td:first-child,
table.report-table th:first-child {
  text-align: left;
  position: sticky;
  left: 0;
  background-color: var(--bg-color);
  z-index: 1;
  min-width: 200px;
  max-width: 280px;
}

table.report-table th:first-child {
  background-color: var(--bg-secondary);
  z-index: 2;
}

table.report-table tbody tr:hover td {
  background-color: rgba(128, 128, 128, 0.08);
}

.code-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.code-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.code-chip {
  display: inline-block;
  width: 1.1em;
  height: 1.1em;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
  vertical-align: middle;
}

.dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.15);
  vertical-align: middle;
}

td.absent {
  opacity: 0.35;
}

.case-list,
.subcode-list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  max-width: 420px;
}

.case-list li,
.subcode-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--border-color);
}

.case-list li:last-child,
.subcode-list li:last-child {
  border-bottom: none;
}

/* List of codes applied in a case, each optionally followed by quotes */
.applied-codes {
  list-style: none;
  padding: 0;
  margin: 0;
}

.applied-codes > li {
  margin-bottom: 10px;
}

.applied-codes > li > .code-chip {
  margin-right: 6px;
}

/* One case's subheading on a code page, optionally followed by quotes */
.case-section {
  margin-bottom: 24px;
}

.case-section h3 {
  margin: 0 0 6px;
  font-size: 1rem;
}

/* List of curated quotes under a code (case page) or a case (code page) */
.quotes {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
}

.quotes > li {
  padding: 4px 0 2px;
}

blockquote.curated-quote {
  margin: 0 0 4px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--border-color);
  background-color: var(--bg-secondary);
  border-radius: 0 4px 4px 0;
  font-family: var(--font-system);
  font-size: 0.875rem;
}

blockquote.curated-quote .translation {
  display: block;
  margin-top: 4px;
  font-style: italic;
  opacity: 0.85;
}

blockquote.curated-quote .note {
  display: block;
  margin-top: 4px;
  font-size: 0.75rem;
  opacity: 0.6;
}
`;

// ---------- Page rendering ----------

function renderQuoteBlockquote(q) {
  const translationHtml = q.translation
    ? `<span class="translation">${escapeHtml(q.translation)}</span>`
    : '';
  const noteHtml = q.note
    ? `<span class="note">${escapeHtml(q.note)}</span>`
    : '';
  return `<blockquote class="curated-quote">${escapeHtml(q.quote)}${translationHtml}${noteHtml}</blockquote>`;
}

function renderQuotesList(quotes) {
  if (!quotes || quotes.length === 0) return '';
  const items = quotes.map((q) => `<li>${renderQuoteBlockquote(q)}</li>`);
  return `<ul class="quotes">${items.join('\n')}</ul>`;
}

function renderCodebookSection(codebook, sortedCaseIds, directPresence, codeFileNames, caseFileNames) {
  const flat = flattenCodes(codebook.codes, codebook);

  let inner;
  if (sortedCaseIds.length === 0) {
    inner = '<p class="empty-message">No coded cases</p>';
  } else if (flat.length === 0) {
    inner = '<p class="empty-message">No codes defined in this codebook</p>';
  } else {
    const headerCells = sortedCaseIds
      .map((caseId) => `<th><a href="cases/${caseFileNames.get(caseId)}">${escapeHtml(caseId)}</a></th>`)
      .join('');
    const rows = flat.map(({ code, depth }) => {
      const color = code.color || '#888888';
      const cells = sortedCaseIds.map((caseId) => {
        const present = isCodedInCase(code.guid, caseId, directPresence);
        return present
          ? `<td><span class="dot" style="background-color:${escapeHtml(color)}" title="Coded"></span></td>`
          : `<td class="absent">&ndash;</td>`;
      }).join('');
      return `<tr><td><div class="code-cell" style="padding-left:${depth * 20}px"><span class="code-chip" style="background-color:${escapeHtml(color)}"></span><a class="code-name" href="codes/${codeFileNames.get(code.guid)}">${escapeHtml(code.name)}</a></div></td>${cells}</tr>`;
    }).join('\n');

    inner = `<div class="table-wrapper">
<table class="report-table">
<thead><tr><th>Code</th>${headerCells}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
  }

  return `<section class="codebook-section" id="codebook-${codebook.guid}">
<h2>${escapeHtml(codebook.name)}</h2>
${inner}
</section>`;
}

// Renders one codebook's contribution to a case page: a header (linked back
// to the codebook's section on the index page) followed by a list of the
// codes from this codebook that were applied in this case, each with any
// curated quotes nested underneath. Codebooks with no applied codes in this
// case are skipped entirely (returns '').
function renderCaseCodebookSection(codebook, caseId, directPresence, codeFileNames, quotesByCaseCode) {
  const flat = flattenCodes(codebook.codes, codebook);
  const caseQuotes = quotesByCaseCode?.get(caseId);

  const appliedCodes = flat.filter(({ code }) => isCodedInCase(code.guid, caseId, directPresence));
  if (appliedCodes.length === 0) return '';

  const codeItems = appliedCodes.map(({ code }) => {
    const color = code.color || '#888888';
    const quotes = caseQuotes?.get(code.guid) ?? [];
    return `<li><span class="code-chip" style="background-color:${escapeHtml(color)}"></span><a href="../codes/${codeFileNames.get(code.guid)}">${escapeHtml(code.name)}</a>${renderQuotesList(quotes)}</li>`;
  });

  return `<section class="codebook-section">
<h2><a href="../index.html#codebook-${codebook.guid}">${escapeHtml(codebook.name)}</a></h2>
<ul class="applied-codes">
${codeItems.join('\n')}
</ul>
</section>`;
}

function renderIndexPage({ sortedCodebooks, sortedCaseIds, directPresence, codeFileNames, caseFileNames, filterDescription, totalCodebookCount }) {
  const totalCodes = sortedCodebooks.reduce((sum, cb) => sum + flattenCodes(cb.codes, cb).length, 0);
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const codebookToc = sortedCodebooks.length > 1
    ? `<nav class="toc">${sortedCodebooks.map((cb) => `<a href="#codebook-${cb.guid}">${escapeHtml(cb.name)}</a>`).join('')}</nav>`
    : '';

  const caseToc = sortedCaseIds.length > 0
    ? `<nav class="toc"><span>Cases:</span> ${sortedCaseIds.map((caseId) => `<a href="cases/${caseFileNames.get(caseId)}">${escapeHtml(caseId)}</a>`).join('')}</nav>`
    : '';

  let sections;
  if (sortedCodebooks.length > 0) {
    sections = sortedCodebooks.map((codebook) => renderCodebookSection(codebook, sortedCaseIds, directPresence, codeFileNames, caseFileNames)).join('\n');
  } else if (filterDescription && totalCodebookCount > 0) {
    sections = `<p class="empty-message">No codebooks matched the --codebooks filter (${escapeHtml(filterDescription)}).</p>`;
  } else {
    sections = '<p class="empty-message">No codebooks found.</p>';
  }

  const filterNote = filterDescription
    ? ` &middot; codebooks filtered to: ${escapeHtml(filterDescription)}`
    : '';

  const body = `<h1>Coding Overview</h1>
${codebookToc}
${caseToc}
${sections}`;

  return pageShell({ title: 'Coding Overview', relRoot: '', bodyHtml: body });
}

function renderCodePage({ entry, codeByGuid, directPresence, sortedCaseIds, codeFileNames, caseFileNames, quotesByCodeCase }) {
  const { code, codebook } = entry;
  const color = code.color || '#888888';

  const chain = [];
  let cur = entry;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentGuid ? codeByGuid.get(cur.parentGuid) : null;
  }

  const breadcrumbHtml = [
    `<a href="../index.html#codebook-${codebook.guid}">${escapeHtml(codebook.name)}</a>`,
    ...chain.map((c, i) => (i === chain.length - 1
      ? `<strong>${escapeHtml(c.code.name)}</strong>`
      : `<a href="${codeFileNames.get(c.code.guid)}">${escapeHtml(c.code.name)}</a>`)),
  ].join(' <span class="sep">&rsaquo;</span> ');

  const subcodes = Array.isArray(code.subcodes) ? code.subcodes : [];
  const casesCoded = sortedCaseIds.filter((caseId) => isCodedInCase(code.guid, caseId, directPresence));

  const descriptionHtml = code.description
    ? `<p class="description">${escapeHtml(code.description)}</p>`
    : '';

  const subcodesHtml = subcodes.length > 0
    ? `<h2>Subcodes</h2>
<ul class="subcode-list">
${subcodes.map((sub) => `<li><span class="code-chip" style="background-color:${escapeHtml(sub.color || '#888888')}"></span><a href="${codeFileNames.get(sub.guid)}">${escapeHtml(sub.name)}</a></li>`).join('\n')}
</ul>`
    : '';

  const caseSections = casesCoded.map((caseId) => {
    const quotes = quotesByCodeCase?.get(code.guid)?.get(caseId) ?? [];
    return `<section class="case-section">
<h3><a href="../cases/${caseFileNames.get(caseId)}">${escapeHtml(caseId)}</a></h3>
${renderQuotesList(quotes)}
</section>`;
  }).join('\n');

  const casesHtml = caseSections.length > 0
    ? caseSections
    : '<p class="empty-message">No cases coded with this code yet.</p>';

  const body = `<p class="top-nav"><a href="../index.html">&larr; Back to overview</a></p>
<div class="breadcrumb">${breadcrumbHtml}</div>
<h1><span class="code-chip" style="background-color:${escapeHtml(color)}"></span>${escapeHtml(code.name)}</h1>
${descriptionHtml}
${subcodesHtml}
<h2>Cases coded</h2>
${casesHtml}`;

  return pageShell({ title: `${code.name} - Coding Overview`, relRoot: '../', bodyHtml: body });
}

function renderCasePage({ caseId, sortedCodebooks, directPresence, codeFileNames, quotesByCaseCode }) {
  const sections = sortedCodebooks
    .map((codebook) => renderCaseCodebookSection(codebook, caseId, directPresence, codeFileNames, quotesByCaseCode))
    .filter((s) => s.length > 0)
    .join('\n');

  const body = `<p class="top-nav"><a href="../index.html">&larr; Back to overview</a></p>
<h1>${escapeHtml(caseId)}</h1>
${sections || '<p class="empty-message">No codes applied in this case.</p>'}`;

  return pageShell({ title: `${caseId} - Coding Overview`, relRoot: '../', bodyHtml: body });
}

// ---------- Main ----------

function main() {
  const { dataDir, outDir, codebooksFilter, quotesFile, noQuotes } = parseArgs(process.argv.slice(2));
  const resolvedDataDir = path.resolve(dataDir);
  const resolvedOutDir = path.resolve(outDir);

  if (!fs.existsSync(resolvedDataDir) || !fs.statSync(resolvedDataDir).isDirectory()) {
    console.error(`Data directory not found: ${resolvedDataDir}`);
    process.exit(1);
  }

  const skipAbsDirs = new Set([resolvedOutDir]);

  const { codebooks: allCodebooks, codebookPath, invalid: invalidCodebookCount } = loadCodebooks(resolvedDataDir, skipAbsDirs);
  const { sources, invalid: invalidSourceCount } = loadSources(resolvedDataDir, skipAbsDirs);

  if (invalidCodebookCount > 0) console.warn(`Skipped ${invalidCodebookCount} invalid .mcc file(s).`);
  if (invalidSourceCount > 0) console.warn(`Skipped ${invalidSourceCount} invalid .mcs file(s).`);
  if (allCodebooks.size === 0) console.warn('No .mcc codebook files found under the data directory.');
  if (sources.size === 0) console.warn('No .mcs coded source files found under the data directory.');

  // Resolve the --codebooks filter against every loaded codebook (matched by
  // name or by its .mcc path relative to dataDir). An empty filter includes
  // everything, so unfiltered runs behave exactly as before.
  const filterPatterns = parseFilterList(codebooksFilter);
  const compiledFilterPatterns = compileGlobs(filterPatterns);
  const filteredCodebooks = new Map();
  for (const [guid, codebook] of allCodebooks.entries()) {
    const relPath = codebookPath.get(guid) ?? codebook.name;
    if (codebookMatchesFilter(codebook, relPath, compiledFilterPatterns)) {
      filteredCodebooks.set(guid, codebook);
    }
  }

  if (filterPatterns.length > 0) {
    console.log(`Codebook filter "${filterPatterns.join(', ')}" matched ${filteredCodebooks.size}/${allCodebooks.size} codebook(s).`);
    if (filteredCodebooks.size === 0 && allCodebooks.size > 0) {
      console.warn('No codebooks matched the --codebooks filter. Available codebooks:');
      for (const [guid, codebook] of allCodebooks.entries()) {
        console.warn(`  - ${codebook.name} (${codebookPath.get(guid) ?? '?'})`);
      }
    }
  }

  // Presence/orphan detection is always computed against *all* loaded
  // codebooks, so filtering out a codebook never gets misreported as a
  // dangling/unknown code reference.
  const { codeByGuid: allCodeByGuid } = buildCodeIndex(allCodebooks);
  const { directPresence, unknownApplications } = computePresence(sources, allCodeByGuid);

  if (unknownApplications > 0) {
    console.warn(
      `${unknownApplications} applied code reference(s) point to a code that wasn't found `
      + '(codebook missing from the data directory?) and were skipped.',
    );
  }

  // Rendering and case-visibility are scoped to the filtered set.
  const { codeByGuid } = buildCodeIndex(filteredCodebooks);
  const sortedCaseIds = [...computeVisibleCaseIds(sources, codeByGuid)].sort(compareCaseIds);

  const sortedCodebooks = [...filteredCodebooks.values()].sort((a, b) => {
    const pathA = codebookPath.get(a.guid) ?? a.name;
    const pathB = codebookPath.get(b.guid) ?? b.name;
    return fileTreeCompare(pathA, pathB);
  });

  // Curated quotes sidecar. Default path is <dataDir>/quotes.json; --no-quotes
  // disables entirely; --quotes "" also disables; --quotes <path> overrides.
  // Quotes are resolved against the selection index (built from all sources)
  // and the filtered codeByGuid, so quotes respect the --codebooks filter.
  const selectionIndex = buildSelectionIndex(sources);
  let quotesByCodeCase = null;
  let quotesByCaseCode = null;
  let quotesLoadedCount = 0;
  if (!noQuotes) {
    let resolvedQuotesPath = null;
    if (quotesFile != null && quotesFile !== '') {
      resolvedQuotesPath = path.resolve(quotesFile);
    } else if (quotesFile == null) {
      // No explicit flag: try default location.
      const defaultPath = path.join(resolvedDataDir, DEFAULT_QUOTES_FILE);
      if (fs.existsSync(defaultPath)) resolvedQuotesPath = defaultPath;
    }

    if (resolvedQuotesPath) {
      const loadResult = loadQuoteEntries(resolvedQuotesPath);
      if (!loadResult.fileExists) {
        console.warn(`Quotes file not found: ${resolvedQuotesPath} (continuing without quotes).`);
      } else if (loadResult.parseError) {
        console.warn('Continuing without curated quotes.');
      } else {
        if (loadResult.invalid > 0) console.warn(`Skipped ${loadResult.invalid} invalid quote entry/entries.`);
        const resolved = [];
        let skippedUnknown = 0;
        let skippedFiltered = 0;
        for (let i = 0; i < loadResult.entries.length; i += 1) {
          const result = resolveQuoteEntry(loadResult.entries[i], selectionIndex, allCodeByGuid, codeByGuid, i);
          if (result.status === 'ok') {
            resolved.push(result.quote);
          } else if (result.status === 'filtered') {
            skippedFiltered += 1;
          } else {
            skippedUnknown += 1;
          }
        }
        const grouped = groupResolvedQuotes(resolved);
        quotesByCodeCase = grouped.byCodeCase;
        quotesByCaseCode = grouped.byCaseCode;
        quotesLoadedCount = resolved.length;
        if (skippedUnknown > 0) console.warn(`${skippedUnknown} quote entry/entries referenced an unknown selection guid or code; skipped.`);
        if (skippedFiltered > 0) console.warn(`${skippedFiltered} quote entry/entries belong to a codebook excluded by the --codebooks filter; skipped.`);
        console.log(`Loaded ${quotesLoadedCount} curated quote(s) from ${resolvedQuotesPath}.`);
      }
    }
  }

  const codeFileNames = assignCodeFileNames(sortedCodebooks);
  const caseFileNames = assignCaseFileNames(sortedCaseIds);

  fs.mkdirSync(resolvedOutDir, { recursive: true });
  fs.mkdirSync(path.join(resolvedOutDir, 'codes'), { recursive: true });
  fs.mkdirSync(path.join(resolvedOutDir, 'cases'), { recursive: true });
  fs.mkdirSync(path.join(resolvedOutDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(resolvedOutDir, 'assets', 'style.css'), STYLE_CSS);

  const filterDescription = filterPatterns.length > 0 ? filterPatterns.join(', ') : null;
  const indexHtml = renderIndexPage({
    sortedCodebooks,
    sortedCaseIds,
    directPresence,
    codeFileNames,
    caseFileNames,
    filterDescription,
    totalCodebookCount: allCodebooks.size,
  });
  fs.writeFileSync(path.join(resolvedOutDir, 'index.html'), indexHtml);

  let pageCount = 0;
  for (const codebook of sortedCodebooks) {
    for (const entry of flattenCodes(codebook.codes, codebook)) {
      const html = renderCodePage({ entry, codeByGuid, directPresence, sortedCaseIds, codeFileNames, caseFileNames, quotesByCodeCase });
      fs.writeFileSync(path.join(resolvedOutDir, 'codes', codeFileNames.get(entry.code.guid)), html);
      pageCount += 1;
    }
  }

  let caseFileCount = 0;
  for (const caseId of sortedCaseIds) {
    const html = renderCasePage({
      caseId,
      sortedCodebooks,
      directPresence,
      codeFileNames,
      quotesByCaseCode,
    });
    fs.writeFileSync(path.join(resolvedOutDir, 'cases', caseFileNames.get(caseId)), html);
    caseFileCount += 1;
  }

  console.log(`Loaded ${allCodebooks.size} codebook(s) and ${sources.size} source file(s) with .mcs data.`);
  console.log(`Included in report: ${sortedCodebooks.length} codebook(s).`);
  console.log(`Cases with at least one applied code: ${sortedCaseIds.length ? sortedCaseIds.join(', ') : '(none)'}`);
  console.log(`Wrote index.html, ${pageCount} code page(s), and ${caseFileCount} case page(s) to ${resolvedOutDir}`);
  console.log(`Open ${path.join(resolvedOutDir, 'index.html')} in a browser to view it.`);
}

main();
