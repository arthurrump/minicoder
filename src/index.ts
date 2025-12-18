interface Code {
    code: string;
    color: string;
}

interface CodedSegment {
    start: number;
    end: number;
    code: string;
    text: string;
}

const codes: Code[] = [
    { code: 'theme1', color: 'yellow' },
    { code: 'theme2', color: 'lightblue' },
    { code: 'theme3', color: 'lightgreen' }
];

let originalText = '';
let codedSegments: CodedSegment[] = [];

const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const codeSelect = document.getElementById('codeSelect') as HTMLSelectElement;
const applyCodeBtn = document.getElementById('applyCode') as HTMLButtonElement;
const downloadJsonBtn = document.getElementById('downloadJson') as HTMLButtonElement;
const textDisplay = document.getElementById('textDisplay') as HTMLDivElement;

// Populate code select
codes.forEach(c => {
    const option = document.createElement('option');
    option.value = c.code;
    option.textContent = c.code;
    codeSelect.appendChild(option);
});

// Add CSS for colors
const style = document.createElement('style');
style.textContent = codes.map(c => `.${c.color} { background-color: ${c.color}; }`).join('\n');
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
        };
        reader.readAsText(file);
    }
});

// Apply code
applyCodeBtn.addEventListener('click', () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return;
    const code = codeSelect.value;
    if (!code) return;

    const start = getOffset(textDisplay, range.startContainer, range.startOffset);
    const end = getOffset(textDisplay, range.endContainer, range.endOffset);
    const text = originalText.substring(start, end);

    codedSegments.push({ start, end, code, text });

    const span = document.createElement('span');
    span.className = 'highlight ' + codes.find(c => c.code === code)?.color || '';
    span.dataset.code = code;
    range.surroundContents(span);
    selection.removeAllRanges();
});

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
