// Hash raw bytes (ArrayBuffer)
export async function hashBytes(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Debounce utility with flush/cancel support
export type Debounced<T extends (...args: any[]) => any> =
    ((...args: Parameters<T>) => void) & {
        /** Immediately execute the pending call (if any), cancelling the timer. */
        flush(): ReturnType<T> | undefined;
        /** Cancel the pending call without executing it. */
        cancel(): void;
    };

export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
): Debounced<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let savedArgs: Parameters<T> | null = null;

    const debounced = (...args: Parameters<T>) => {
        savedArgs = args;
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            const args = savedArgs;
            timeoutId = null;
            savedArgs = null;
            if (args) fn(...args);
        }, delay);
    };

    debounced.flush = (): ReturnType<T> | undefined => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (savedArgs !== null) {
            const args = savedArgs;
            savedArgs = null;
            return fn(...args);
        }
        return undefined;
    };

    debounced.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        savedArgs = null;
    };

    return debounced as Debounced<T>;
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
