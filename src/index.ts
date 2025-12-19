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
            { 
                code: 'sub1', 
                color: 'lightyellow', 
                subcodes: [
                    { code: 'sub1sub1', color: 'goldenrod' }
                ] 
            },
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
        div.style.backgroundColor = c.color;
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
            codedSegments = [];
            currentRange = null;
            rebuildDisplay();
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

    rebuildDisplay();
    currentRange = null;
    window.getSelection()?.removeAllRanges();
}

function rebuildDisplay() {
    if (!originalText) return;

    // Get all unique positions from segment boundaries
    const positions = new Set<number>([0, originalText.length]);
    for (const seg of codedSegments) {
        positions.add(seg.start);
        positions.add(seg.end);
    }

    const sortedPositions = Array.from(positions).sort((a, b) => a - b);

    let html = '';

    // For each text segment between positions, find which codes apply and wrap accordingly
    for (let i = 0; i < sortedPositions.length - 1; i++) {
        const segStart = sortedPositions[i];
        const segEnd = sortedPositions[i + 1];

        // Find all codes that cover this segment
        const activeCodes = codedSegments.filter(
            seg => seg.start <= segStart && segEnd <= seg.end
        );

        // Sort by start position (outer spans first) then by end position (inner spans last)
        activeCodes.sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            return b.end - a.end; // reverse order for end to keep inner last
        });

        // Open spans for new codes
        for (const code of activeCodes) {
            html += `<span class="highlight ${getColorForCode(code.code)}" data-code="${code.code}">`;
        }

        // Add text
        const text = originalText.substring(segStart, segEnd);
        html += text.replace(/\n/g, '<br>');

        // Close spans in reverse order
        for (let j = activeCodes.length - 1; j >= 0; j--) {
            html += '</span>';
        }
    }

    textDisplay.innerHTML = html;
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
    
    traverse(root);
    return total;
}
