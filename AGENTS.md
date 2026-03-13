# Minicoder AI Coding Agent Instructions

## Project Overview

**minicoder** is an in-browser qualitative data analysis tool for plain-text files. It enables researchers to code text selections using a hierarchical codebook system and persist annotations locally via the File System Access API.

**Key Constraint**: Works only in Chromium-based browsers that support `showDirectoryPicker()`.

## Architecture

### Technology Stack
- **Framework**: Solid.js (reactive, component-based UI)
- **Routing**: @solidjs/router with hash-based navigation
- **Build Tool**: Vite with solid-plugin
- **File System**: FileSystemAccessAPI (not Node.js filesystem)
- **Storage**: Browser-based, persisted via `.mcc`, `.mcs` and `.mcq` files

### Core Data Model

[src/models](src/models) defines the data model. There are four persistent file types in the selected directory:

1. **`.mcc` files (Codebooks)** - JSON files containing code hierarchies:
   ```typescript
   interface Codebook {
     guid: string;
     name: string;
     codes: Code[]; // hierarchical tree
   }
   ```

2. **`.mcs` files (Sources)** - JSON files tracking text annotations alongside source files:
   ```typescript
   interface Source {
     guid: string;
     fileHash: string;  // SHA-256 of source content for change detection
     selections: TextSelection[];
   }
   ```

3. **`.mcq` files (Queries)** - JSON files defining a query on coded selections:
   ```typescript
   interface Query {
     guid: string;
     name: string;
     query: QueryNode | null;
     fileFilter?: string;
   }
   ```

4. **Plain text files** - Any `.txt`, `.md`, etc. to be coded (sources)

### State Management Pattern

[src/store.tsx](src/store.tsx) uses Solid's `createStore` (immutable updates) with a centralized context:

- **Store shape**: `{ dirHandle, codebooks, sources, fileContents }`
- **Key actions**:
  - `setDirectory()` - resets state and eagerly loads codebooks + sources
  - `loadCodebooks()` / `loadAllSources()` - recursively scan directory for `.mcc` / `.mcs` files
  - `loadFileContent()` - cached lazy loading of text file contents
  - `updateSelections()` - triggers debounced save (1s delay)
  - `saveCodebook()` / `saveSource()` - persists to FileSystemAccessAPI

**Critical pattern**: Selection updates are debounced to avoid thrashing saves.

### View Architecture

Single-page application with file-based routing:

- **CodingView** - [src/views/CodingView.tsx](src/views/CodingView.tsx)
  - Left panel: FileBrowser (shows all files including `.mcc` codebooks)
  - Center panel: Content area with tabs
    - For text files: TextView (text display + selection capture) with CodePicker on right
    - For `.mcc` files: CodebookEditor (edit codebook structure)
  - Right panel: CodePicker (only shown when editing text files)
  - Handles "pending selection" → "code application" workflow
  - Warns on file hash mismatch (file changed since last coding)

- **CodebookEditor** - [src/components/CodebookEditor.tsx](src/components/CodebookEditor.tsx)
  - Embedded component for editing `.mcc` files
  - CRUD for codes (including nested subcodes)
  - Displayed in place of TextView when a codebook file is selected

**Routing**: Hash-based routes use only the file path (`/#/{encodedFilePath}`)

### Key Integration Points

**Text Selection Capture**: CodingView uses text selection events to set `pendingSelection` → user clicks code → new selection created

**File Change Detection**: Compares SHA-256 hash of source file content with stored hash in `.mcs` file

**FileSystemAccessAPI Usage**:
- `showDirectoryPicker()` to get root handle
- Recursive `findAllFiles()` to discover all files
- `createWritable()` for atomic writes to `.mcc` / `.mcs` files

### Utility Modules (`src/utils/`)

Pure functions extracted from components for reuse and testability:

- **`colors.ts`** — HSL↔Hex conversion, color generation for codes/subcodes, `lightenColor`
- **`codeTree.ts`** — `flattenCodesWithDepth`, `flattenCodesWithPath`, `updateCodeInTree` for recursive code tree operations
- **`paths.ts`** — `disambiguatePaths` for showing unique file suffixes in tabs/headers
- **`query.ts`** — `evaluateQueryOnSource`, glob matching utilities (`parseFilterList`, `compileGlobs`, `matchesAnyGlob`)
- **`selections.ts`** — `findOverlapping`, `computeSelectionLayers`, `computeCollapsedRegions`, `buildMatchGroups` plus associated types (`MatchGroup`, `CollapsedRegion`, `BuildMatchGroupsResult`)
- **`textLayout.ts`** — `getUnderlineStyle`, `getHoveredLayer`, `getSelectionAtLayer`, `getHandlePositions`, `getCharIndexFromPoint`, `getTextOffset`, `scrollToCharOffset` plus constants (`UNDERLINE_HEIGHT`, `UNDERLINE_GAP`)

### Shared Styles (`src/styles/`)

- **`shared.module.css`** — Common CSS classes used via `composes` in component CSS modules: `.overlay` (modal backdrop), `.btnSmall`/`.btnPrimary`/`.btnDanger` (button styles), `.editorHeader`/`.editorTitle`/`.editorTitleInput`/`.headerActions` (editor header pattern), `.codeChip`, `.codebookNameLabel`

## Developer Workflows

### Start Development
```bash
pnpm install
pnpm dev       # Vite server on http://localhost:3000
```

### Build
```bash
pnpm build     # Output to `dist/`
pnpm serve     # Preview production build
```

### Type checking
`pnpm build` runs type checks, but they can also be run separately:

```bash
pnpm check     # Runs tsc to typecheck
```

### Testing

#### Running Tests
```bash
pnpm test          # Run all tests once (CI mode)
pnpm test:watch    # Run tests in watch mode (development)
```

#### Test Stack
- **Test runner**: [Vitest](https://vitest.dev/) (configured in `vite.config.ts`)
- **Component testing**: [@solidjs/testing-library](https://github.com/solidjs-community/solid-testing-library) with jsdom
- **DOM matchers**: [@testing-library/jest-dom](https://github.com/testing-library/jest-dom)
- **Test files**: `src/test/*.test.ts` and `src/test/*.test.tsx`

#### What Is Tested

| File | What is tested |
|---|---|
| `src/test/helpers.test.ts` | `hashBytes`, `debounce` (with flush/cancel), `buildSegments`, `isPlainText`, `fileTreeCompare` |
| `src/test/queryEvaluation.test.ts` | `evaluateQueryOnSource` (from `src/utils/query.ts`) — null query, code/codebook leaf nodes, AND/OR/NOT operators, user filtering |
| `src/test/matchingSelections.test.ts` | `findOverlapping`, `computeCollapsedRegions`, `buildMatchGroups` (from `src/utils/selections.ts`), `flattenCodesWithPath` (from `src/utils/codeTree.ts`) |
| `src/test/components/ColorChip.test.tsx` | `ColorChip` (render, styles, class prop) |
| `src/test/components/CodePicker.test.tsx` | `CodePicker` (expand/collapse, code click, edit button) |

#### What to Test When Adding Features
- **New pure utility functions** in `src/utils/` → add unit tests in the relevant `src/test/*.test.ts` file (or create a new one)
- **New helpers** in `src/helpers.ts` → add unit tests in `src/test/helpers.test.ts`
- **New query logic** in `src/utils/query.ts` → add unit tests in `src/test/queryEvaluation.test.ts`
- **New selection/matching logic** in `src/utils/selections.ts` → add unit tests in `src/test/matchingSelections.test.ts`
- **New Solid.js components** → add component tests in a new `src/test/components/ComponentName.test.tsx` file using `@solidjs/testing-library`

#### Writing Component Tests
Component tests use `@solidjs/testing-library` which wraps `@testing-library/dom`. Key APIs:
```tsx
import { render, screen, fireEvent } from '@solidjs/testing-library';

render(() => <MyComponent prop="value" />);
screen.getByText('expected text');
fireEvent.click(screen.getByRole('button'));
```

Global type declarations (e.g. `Codebook`, `Code`, `TextSelection`, `QueryNode`) are available in all test files without explicit imports — they come from `src/models/files/`.

#### Testing Considerations (Manual / Browser)
Some features require manual testing in a Chromium browser, as they depend on the File System Access API (`showDirectoryPicker`):
- Test with multiple codebooks and nested code hierarchies
- Verify hash mismatch warnings on file edits
- Check debounced saves don't lose rapid selection updates

### Navigation
- **File selection** uses hash routes with encoded file path (`/#/{encodedFilePath}`)
- **Tabs** manage multiple open files with scroll position memory
- **Codebook files** (`.mcc`) open in the CodebookEditor component

## Code Patterns & Conventions

### Solid.js Patterns
- **Signals** (`createSignal`) for reactive state
- **Memos** (`createMemo`) for derived state (prefer over computed signals)
- **Effects** (`createEffect`) with `on()` for dependency tracking (avoid automatic tracking issues)
- **Resources** (`createResource`) for async data loading (e.g., file content)
- **Store** (`createStore`) for global state with immutable updates

### Component Structure
- Most components co-locate styles as `.module.css` files
- Shared CSS patterns live in `src/styles/shared.module.css` and are composed into component modules via `composes: ... from`
- Pure utility functions live in `src/utils/` (not in component files)
- Props are typed interfaces (e.g., `CodePickerProps`)
- Recursive rendering for nested codes (e.g., CodeList in [src/components/CodePicker.tsx](src/components/CodePicker.tsx))

### File Naming Conventions
- Components: PascalCase (e.g., `FileBrowser.tsx`)
- Styles: `ComponentName.module.css`
- Views: PascalCase in `views/` directory
- Types: Defined inline or in [src/models.ts](src/models.ts)

### Selection Guids
- All selections, codes, and codebooks use `crypto.randomUUID()` for unique IDs

## Important Notes for AI Agents

### Avoid These Patterns
- ❌ Do NOT use Node.js filesystem APIs (project runs in browser only)
- ❌ Do NOT assume ES5 compatibility (Vite targets `esnext`)
- ❌ Do NOT mutate store state directly; always use Solid store setters
- ❌ Do NOT create file I/O without wrapping in FileSystemAccessAPI calls

### When Adding Features
1. **File format changes**: Update both read/write paths in [src/store.tsx](src/store.tsx)
2. **New components**: Add to `src/components/` with co-located `.module.css`
3. **New store state**: Update AppStore interface + initialization
4. **Component state**: Prefer `createMemo` for derived state over extra signals
5. **Solid.js**: Write idiomatic Solid.js code
6. **New testable logic**: Add unit tests in `src/test/` (see [Testing](#testing) section above)
7. **New pure functions**: Add to `src/utils/` (not inside component files)
8. **New shared CSS patterns**: Add to `src/styles/shared.module.css` and compose into component modules

## External Dependencies
- `@solidjs/router` - hash-based client routing
- `@corvu/resizable` - resizable pane separator
- `@primer/octicons` - icon library

# Interaction

Ask questions if you need more information or need to make significant design decisions.
