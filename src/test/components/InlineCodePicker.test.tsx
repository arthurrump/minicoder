import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import InlineCodePicker from '../../components/InlineCodePicker';
import type { Code, Codebook } from '../../models/files';

const mkCode = (guid: string, name: string, subcodes: Code[] = []): Code => ({
  guid,
  name,
  color: '#aabbcc',
  description: '',
  subcodes,
});

const mkCodebook = (guid: string, name: string, codes: Code[]): Codebook => ({
  guid,
  name,
  codes,
});

describe('InlineCodePicker', () => {
  it('sorts selected codebook first when mainCodebook is provided', () => {
    const cbA = mkCodebook('cb-a', 'Alpha', [mkCode('a-1', 'A1')]);
    const cbB = mkCodebook('cb-b', 'Beta', [mkCode('b-1', 'B1')]);

    const { container } = render(() => (
      <InlineCodePicker
        groups={[
          { codebook: cbA, codes: [{ code: cbA.codes[0], depth: 0 }] },
          { codebook: cbB, codes: [{ code: cbB.codes[0], depth: 0 }] },
        ]}
        mainCodebook={cbB}
        onSelect={vi.fn()}
      />
    ));

    const headings = Array.from(container.querySelectorAll('div')).filter((el) =>
      el.className.includes('pickerHeading')
    );
    expect(headings[0]?.textContent).toContain('Beta');
  });

  it('filters code labels by input text', () => {
    const cb = mkCodebook('cb', 'Book', [mkCode('c-1', 'Alpha'), mkCode('c-2', 'Bravo')]);

    render(() => (
      <InlineCodePicker
        groups={[
          {
            codebook: cb,
            codes: [
              { code: cb.codes[0], depth: 0, label: 'One > Alpha' },
              { code: cb.codes[1], depth: 0, label: 'One > Bravo' },
            ],
          },
        ]}
        onSelect={vi.fn()}
      />
    ));

    fireEvent.input(screen.getByPlaceholderText('Filter codes...'), { target: { value: 'Bravo' } });

    expect(screen.queryByText('One > Alpha')).toBeNull();
    expect(screen.getByText('One > Bravo')).toBeTruthy();
  });

  it('allows selecting codebooks when onSelectCodebook is provided', () => {
    const cb = mkCodebook('cb', 'Book', [mkCode('c-1', 'Alpha')]);
    const onSelectCodebook = vi.fn();

    render(() => (
      <InlineCodePicker
        groups={[
          { codebook: cb, codes: [{ code: cb.codes[0], depth: 0 }] },
        ]}
        onSelect={vi.fn()}
        onSelectCodebook={onSelectCodebook}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: /Book\s*Select codebook/i }));
    expect(onSelectCodebook).toHaveBeenCalledTimes(1);
    expect(onSelectCodebook).toHaveBeenCalledWith(cb);
  });
});
