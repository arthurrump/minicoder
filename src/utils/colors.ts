// Color generation and manipulation utilities using HSL color space

/**
 * Convert HSL color values to hex string
 */
export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Convert hex color string to HSL values
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 50, l: 50 };
  
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/**
 * Generate a random bright, saturated color for top-level codes
 * Uses random hue with high saturation and brightness
 */
export function generateTopLevelColor(): string {
  const h = Math.random() * 360; // Random hue (0-360)
  const s = 75 + Math.random() * 25; // 75-100% saturation (high)
  const l = 45 + Math.random() * 15; // 45-60% lightness (bright)
  return hslToHex(h, s, l);
}

/**
 * Generate a subcode color based on parent color, depth, and sibling index
 * Uses the same hue but reduces saturation based on depth
 * Lightness varies deterministically based on index for sibling distinction
 */
export function generateSubcodeColor(parentColor: string, depth: number, index: number): string {
  const { h } = hexToHsl(parentColor);
  // Reduce saturation as depth increases (minimum 25%)
  const s = Math.max(25, 90 - depth * 18);
  // Deterministic lightness variation based on index using golden ratio for even distribution
  const goldenRatio = 0.618033988749895;
  const l = 35 + ((index * goldenRatio) % 1) * 35; // 35-70% range, evenly distributed
  return hslToHex(h, Math.round(s), Math.round(l));
}

/**
 * Lighten a color by mixing it with white.
 */
export function lightenColor(color: string, amount: number = 0.3): string {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    
    const lightenChannel = (c: number) => Math.round(c + (255 - c) * amount);
    
    const lr = lightenChannel(r).toString(16).padStart(2, '0');
    const lg = lightenChannel(g).toString(16).padStart(2, '0');
    const lb = lightenChannel(b).toString(16).padStart(2, '0');
    
    return `#${lr}${lg}${lb}`;
  }
  return color;
}
