interface Code {
    code: string;
    color: string;
    subcodes?: Code[];
}

interface CodedSegment {
    start: number;
    end: number;
    code: string;
    text: string;
}

const codes: Code[] = [
    { 
        code: 'theme1', 
        color: 'yellow',
        subcodes: [
            { code: 'sub1', color: 'lightyellow' },
            { code: 'sub2', color: 'gold' }
        ]
    },
    { 
        code: 'theme2', 
        color: 'lightblue',
        subcodes: [
            { code: 'sub3', color: 'skyblue' }
        ]
    },
    { code: 'theme3', color: 'lightgreen' }
];

let originalText = '';
let codedSegments: CodedSegment[] = [];
let currentRange: Range | null = null;

const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const downloadJsonBtn = document.getElementById('downloadJson') as HTMLButtonElement;
const textDisplay = document.getElementById('textDisplay') as HTMLDivElement;
const codesList = document.getElementById('codesList') as HTMLDivElement;

// Listen for selection changes
document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (textDisplay.contains(range.commonAncestorContainer)) {
            currentRange = range.cloneRange();
        }
    }
});

// Render codes list
function renderCodes(codes: Code[], container: HTMLElement) {
    codes.forEach(c => {
        const div = document.createElement('div');
        div.className = 'code-item';
        div.textContent = c.code;
        div.addEventListener('click', () => applyCode(c.code));
        container.appendChild(div);
        if (c.subcodes) {
            const subContainer = document.createElement('div');
            subContainer.className = 'subcodes';
            renderCodes(c.subcodes, subContainer);
            container.appendChild(subContainer);
        }
    });
}

renderCodes(codes, codesList);

// Add CSS for colors
const style = document.createElement('style');
function collectColors(codes: Code[]): string[] {
    let colors: string[] = [];
    codes.forEach(c => {
        colors.push(c.color);
        if (c.subcodes) colors = colors.concat(collectColors(c.subcodes));
    });
    return colors;
}
style.textContent = collectColors(codes).map(color => `.${color} { background-color: ${color}; }`).join('\n');
document.head.appendChild(style);

// Load file
fileInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            originalText = e.target?.result as string;
            textDisplay.textContent = originalText;
            codedSegments = [];
            currentRange = null;
        };
        reader.readAsText(file);
    }
});

// Apply code
function applyCode(code: string) {
    if (!currentRange || currentRange.collapsed) return;

    const start = getOffset(textDisplay, currentRange.startContainer, currentRange.startOffset);
    const end = getOffset(textDisplay, currentRange.endContainer, currentRange.endOffset);
    const text = originalText.substring(start, end);

    codedSegments.push({ start, end, code, text });

    const span = document.createElement('span');
    span.className = 'highlight ' + getColorForCode(code);
    span.dataset.code = code;
    currentRange.surroundContents(span);
    currentRange = null;
    window.getSelection()?.removeAllRanges();
}

function getColorForCode(code: string): string {
    function findColor(codes: Code[]): string {
        for (const c of codes) {
            if (c.code === code) return c.color;
            if (c.subcodes) {
                const color = findColor(c.subcodes);
                if (color) return color;
            }
        }
        return '';
    }
    return findColor(codes);
}

// Download JSON
downloadJsonBtn.addEventListener('click', () => {
    const dataStr = JSON.stringify(codedSegments, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coded_segments.json';
    a.click();
    URL.revokeObjectURL(url);
});

// Function to get character offset in the textDisplay
function getOffset(root: Node, container: Node, offset: number): number {
    let total = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node: Node | null = walker.firstChild();
    while (node) {
        if (node === container) {
            return total + offset;
        }
        total += node.textContent?.length || 0;
        node = walker.nextNode();
    }
    return total;
}
