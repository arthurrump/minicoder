import { render } from 'solid-js/web';
import { createSignal, createEffect, For, Show } from 'solid-js';
import './index.css';

// Helper function to collect colors from code tree
function collectColors(codes: Code[]): string[] {
    let colors: string[] = [];
    codes.forEach(c => {
        colors.push(c.color);
        if (c.subcodes) colors = colors.concat(collectColors(c.subcodes));
    });
    return colors;
}

// Add CSS for colors
const style = document.createElement('style');
style.textContent = collectColors(codes).map(color => `.${color} { background-color: ${color}; }`).join('\n');
document.head.appendChild(style);



function getColorForCode(code: string): string {
    function findColor(codes: Code[]): string {
        for (const c of codes) {
            if (c.name === code) return c.color;
            if (c.subcodes) {
                const color = findColor(c.subcodes);
                if (color) return color;
            }
        }
        return '';
    }
    return findColor(codes);
}

function getOffset(root: Node, container: Node, offset: number): number {
    if (container === root) {
        let total = 0;
        for (let i = 0; i < offset && i < root.childNodes.length; i++) {
            const child = root.childNodes[i];
            if (child.nodeType === Node.TEXT_NODE) {
                total += child.textContent?.length || 0;
            } else if (child.nodeName === 'BR') {
                total += 1;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                total += getTextLength(child);
            }
        }
        return total;
    }
    
    let total = 0;
    
    function traverse(node: Node): boolean {
        if (node === container) {
            total += offset;
            return true;
        }
        
        if (node.nodeType === Node.TEXT_NODE) {
            total += node.textContent?.length || 0;
        } else if (node.nodeName === 'BR') {
            total += 1;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            for (let i = 0; i < node.childNodes.length; i++) {
                if (traverse(node.childNodes[i])) {
                    return true;
                }
            }
        }
        return false;
    }
    
    for (let i = 0; i < root.childNodes.length; i++) {
        if (traverse(root.childNodes[i])) {
            break;
        }
    }
    
    return total;
}

function getTextLength(node: Node): number {
    let length = 0;
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent?.length || 0;
    } else if (node.nodeName === 'BR') {
        return 1;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
        for (let i = 0; i < node.childNodes.length; i++) {
            length += getTextLength(node.childNodes[i]);
        }
    }
    return length;
}

function App() {
    const [currentFolder, setCurrentFolder] = createSignal('');
    const [fileTree, setFileTree] = createSignal<FileTreeItem[]>([]);
    const [originalText, setOriginalText] = createSignal('');
    const [codedSegments, setCodedSegments] = createSignal<Selection[]>([]);
    const [displayHTML, setDisplayHTML] = createSignal('');
    const [activeFileHandle, setActiveFileHandle] = createSignal<FileSystemFileHandle | null>(null);
    const [activeFilePath, setActiveFilePath] = createSignal('');
    
    let dirHandle: FileSystemDirectoryHandle | null = null;
    let currentFileDir: FileSystemDirectoryHandle | null = null;
    let currentRange: Range | null = null;
    let autoSaveTimeout: number | null = null;
    let currentFileHash: string = '';
    let textDisplayRef: HTMLDivElement | undefined;

    // Listen for selection changes
    createEffect(() => {
        const handleSelectionChange = () => {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                if (textDisplayRef && textDisplayRef.contains(range.commonAncestorContainer)) {
                    currentRange = range.cloneRange();
                }
            }
        };
        
        document.addEventListener('selectionchange', handleSelectionChange);
        return () => document.removeEventListener('selectionchange', handleSelectionChange);
    });

    async function openFolder() {
        try {
            dirHandle = await (window as any).showDirectoryPicker();
            setCurrentFolder(`📂 ${dirHandle.name}`);
            await renderFileTree();
        } catch (err) {
            console.error('Error opening folder:', err);
        }
    }


    async function openFile(fileHandle: FileSystemFileHandle, parentDir: FileSystemDirectoryHandle) {
        try {
            if (activeFileHandle()) {
                await saveCurrentFile();
            }
            
            setActiveFileHandle(fileHandle);
            setActiveFilePath(fileHandle.name);
            currentFileDir = parentDir;
            
            const file = await fileHandle.getFile();
            const text = await file.text();
            setOriginalText(text);
            setCodedSegments([]);
            
            currentFileHash = await hashText(text);
            
            const mcjFileName = fileHandle.name + '.mcj';
            try {
                const mcjHandle = await parentDir.getFileHandle(mcjFileName);
                const mcjFile = await mcjHandle.getFile();
                const mcjData: Source = JSON.parse(await mcjFile.text());
                
                if (mcjData.fileHash !== currentFileHash) {
                    alert(`Warning: The .mcj file was created from a different version of this file. The file may have changed. Proceeding with current file version.`);
                }
                
                setCodedSegments(mcjData.selections);
            } catch {
                // .mcj file doesn't exist, that's okay
            }
            
            rebuildDisplay();
        } catch (err) {
            console.error('Error opening file:', err);
        }
    }

    async function saveCurrentFile() {
        const handle = activeFileHandle();
        if (!handle || !currentFileDir) return;
        
        if (codedSegments().length === 0) {
            console.log('No coded segments to save, skipping .mcj file creation');
            return;
        }
        
        try {
            const mcjFileName = handle.name + '.mcj';
            const mcjHandle = await currentFileDir.getFileHandle(mcjFileName, { create: true });
            const writable = await mcjHandle.createWritable();
            
            const mcjData: Source = {
                fileHash: currentFileHash,
                selections: codedSegments()
            };
            
            await writable.write(JSON.stringify(mcjData, null, 2));
            await writable.close();
            
            console.log(`Saved ${mcjFileName}`);
        } catch (err) {
            console.error('Error saving file:', err);
        }
    }

    function handleTextInput() {
        const text = textDisplayRef?.textContent || '';
        setOriginalText(text);
        
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
        }
        
        autoSaveTimeout = window.setTimeout(() => {
            saveCurrentFile();
        }, 1000);
    }

    function applyCode(code: string) {
        if (!currentRange || currentRange.collapsed || !textDisplayRef) return;

        const start = getOffset(textDisplayRef, currentRange.startContainer, currentRange.startOffset);
        const end = getOffset(textDisplayRef, currentRange.endContainer, currentRange.endOffset);
        const text = originalText().substring(start, end);

        setCodedSegments([...codedSegments(), { start, end, code, text }]);
        
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
        }
        autoSaveTimeout = window.setTimeout(() => {
            saveCurrentFile();
        }, 500);

        rebuildDisplay();
        currentRange = null;
        window.getSelection()?.removeAllRanges();
    }

    function rebuildDisplay() {
        const text = originalText();
        if (!text) return;

        const segments = codedSegments();
        const positions = new Set<number>([0, text.length]);
        for (const seg of segments) {
            positions.add(seg.start);
            positions.add(seg.end);
        }

        const sortedPositions = Array.from(positions).sort((a, b) => a - b);
        let html = '';

        for (let i = 0; i < sortedPositions.length - 1; i++) {
            const segStart = sortedPositions[i];
            const segEnd = sortedPositions[i + 1];

            const activeCodes = segments.filter(
                seg => seg.start <= segStart && segEnd <= seg.end
            );

            activeCodes.sort((a, b) => {
                if (a.start !== b.start) return a.start - b.start;
                return b.end - a.end;
            });

            for (const code of activeCodes) {
                html += `<span class="highlight ${getColorForCode(code.code)}" data-code="${code.code}">`;
            }

            const segText = text.substring(segStart, segEnd);
            html += segText.replace(/\n/g, '<br>');

            for (let j = activeCodes.length - 1; j >= 0; j--) {
                html += '</span>';
            }
        }

        setDisplayHTML(html);
    }

    createEffect(() => {
        rebuildDisplay();
    });

    return (
        <>
            <div id="topbar">
                <h1 class="app-title">minicoder</h1>
                <div class="top-actions">
                    <button onClick={openFolder}>Open Folder</button>
                    <span>{currentFolder()}</span>
                </div>
            </div>
            <div id="main">
                <div id="sidebar">
                    <div id="fileTree">
                        <FileTreeView />
                    </div>
                </div>
                <div 
                    id="textDisplay"
                    ref={textDisplayRef}
                    contentEditable
                    onInput={handleTextInput}
                    innerHTML={displayHTML()}
                />
                <div id="codesList">
                    <CodePicker codes={codes} />
                </div>
            </div>
        </>
    );
}

render(() => <App />, document.getElementById('root')!);
