import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';
import ColorChip from '../../components/ColorChip';

// ── ColorChip ──────────────────────────────────────────────────────────────

describe('ColorChip', () => {
  it('renders a span with the given background-color style', () => {
    const { container } = render(() => <ColorChip color="#ff0000" />);
    const span = container.querySelector('span')!;
    expect(span).toBeTruthy();
    expect(span.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('applies an additional class when provided', () => {
    const { container } = render(() => <ColorChip color="#00ff00" class="extra" />);
    const span = container.querySelector('span')!;
    expect(span.classList.contains('extra')).toBe(true);
  });

  it('does not error when class prop is omitted', () => {
    expect(() => render(() => <ColorChip color="#0000ff" />)).not.toThrow();
  });
});
