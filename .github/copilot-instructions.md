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
- **Storage**: Browser-based, persisted via `.mcc` and `.mcs` files

### Core Data Model

Three persistent file types in the selected directory:

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
     fileHash: string;  // SHA-256 of source content for change detection
     selections: TextSelection[];
   }
   ```

3. **Plain text files** - Any `.txt`, `.md`, etc. to be coded (sources)

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

### Testing Considerations
- Must use a Chromium browser with local folder picker support
- Test with multiple codebooks and nested code hierarchies
- Verify hash mismatch warnings on file edits
- Check debounced saves don't lose rapid selection updates

## External Dependencies
- `@solidjs/router` - hash-based client routing
- `@corvu/resizable` - resizable pane separator
- `@primer/octicons` - icon library

# Interaction

Ask questions is you need more information or need to make significant design decisions.
