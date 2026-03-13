import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { CodePicker } from '../../components/CodePicker';

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── CodePicker ────────────────────────────────────────────────────────────

describe('CodePicker', () => {
  it('renders codebook name for each codebook', () => {
    const codebooks = [
      mkCodebook('cb1', 'My Codebook', [mkCode('c1', 'Theme A')]),
    ];
    render(() => (
      <CodePicker
        codebooks={codebooks}
        onCodeClick={vi.fn()}
      />
    ));
    expect(screen.getByText('My Codebook')).toBeTruthy();
  });

  it('auto-expands the single codebook and shows its codes', () => {
    const codebooks = [
      mkCodebook('cb1', 'Only Book', [mkCode('c1', 'Theme A')]),
    ];
    render(() => (
      <CodePicker
        codebooks={codebooks}
        onCodeClick={vi.fn()}
      />
    ));
    // Single codebook should be expanded by default
    expect(screen.getByText('Theme A')).toBeTruthy();
  });

  it('collapses codebooks when multiple are present', () => {
    const codebooks = [
      mkCodebook('cb1', 'Book One', [mkCode('c1', 'Code One')]),
      mkCodebook('cb2', 'Book Two', [mkCode('c2', 'Code Two')]),
    ];
    render(() => (
      <CodePicker
        codebooks={codebooks}
        onCodeClick={vi.fn()}
      />
    ));
    // Codes should not be visible until expanded
    expect(screen.queryByText('Code One')).toBeNull();
    expect(screen.queryByText('Code Two')).toBeNull();
  });

  it('toggles a codebook open and closed on click', () => {
    const codebooks = [
      mkCodebook('cb1', 'Book One', [mkCode('c1', 'Theme X')]),
      mkCodebook('cb2', 'Book Two', [mkCode('c2', 'Theme Y')]),
    ];
    render(() => (
      <CodePicker
        codebooks={codebooks}
        onCodeClick={vi.fn()}
      />
    ));

    // Click "Book One" header to expand it
    fireEvent.click(screen.getByText('Book One'));
    expect(screen.getByText('Theme X')).toBeTruthy();

    // Click again to collapse
    fireEvent.click(screen.getByText('Book One'));
    expect(screen.queryByText('Theme X')).toBeNull();
  });

  it('calls onCodeClick with the correct code and codebook when a code is clicked', () => {
    const onCodeClick = vi.fn();
    const code = mkCode('c1', 'Alpha');
    const codebook = mkCodebook('cb1', 'Single Book', [code]);
    render(() => (
      <CodePicker
        codebooks={[codebook]}
        onCodeClick={onCodeClick}
      />
    ));

    // Single codebook auto-expands — click the code
    fireEvent.click(screen.getByText('Alpha'));
    expect(onCodeClick).toHaveBeenCalledTimes(1);
    expect(onCodeClick).toHaveBeenCalledWith(code, codebook);
  });

  it('renders nested subcodes when codebook is expanded', () => {
    const child = mkCode('c1_1', 'Sub-theme');
    const parent = mkCode('c1', 'Theme', [child]);
    const codebooks = [mkCodebook('cb1', 'Book', [parent])];
    render(() => (
      <CodePicker
        codebooks={codebooks}
        onCodeClick={vi.fn()}
      />
    ));
    // Single codebook is auto-expanded
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Sub-theme')).toBeTruthy();
  });

  it('renders the edit button when onEditClick is provided', () => {
    const onEditClick = vi.fn();
    const codebooks = [mkCodebook('cb1', 'Book', [])];
    const { container } = render(() => (
      <CodePicker
        codebooks={codebooks}
        onCodeClick={vi.fn()}
        onEditClick={onEditClick}
      />
    ));
    // The edit button should be present
    const editBtn = container.querySelector('button[title="Edit codebook"]');
    expect(editBtn).toBeTruthy();
  });

  it('does not render edit button when onEditClick is not provided', () => {
    const codebooks = [mkCodebook('cb1', 'Book', [])];
    const { container } = render(() => (
      <CodePicker
        codebooks={codebooks}
        onCodeClick={vi.fn()}
      />
    ));
    const editBtn = container.querySelector('button[title="Edit codebook"]');
    expect(editBtn).toBeNull();
  });
});
