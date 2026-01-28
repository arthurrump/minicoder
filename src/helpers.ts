// Simple hash function for file contents
export async function hashText(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Debounce utility
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn(...args);
            timeoutId = null;
        }, delay);
    };
}

// Check if file content appears to be plain text
export function isPlainText(content: string): boolean {
    // Check for null bytes (common in binary files)
    if (content.includes('\0')) {
        return false;
    }
    
    // Check for high percentage of non-printable characters
    let nonPrintableCount = 0;
    const sampleSize = Math.min(content.length, 8192); // Sample first 8KB
    
    for (let i = 0; i < sampleSize; i++) {
        const code = content.charCodeAt(i);
        // Allow common whitespace: tab (9), newline (10), carriage return (13)
        // and printable ASCII/Unicode characters (>= 32)
        if (code < 9 || (code > 13 && code < 32)) {
            nonPrintableCount++;
        }
    }
    
    // If more than 30% are non-printable, consider it binary
    const nonPrintableRatio = nonPrintableCount / sampleSize;
    return nonPrintableRatio < 0.3;
}
