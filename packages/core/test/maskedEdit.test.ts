import { describe, expect, it } from 'vitest';
import { applyMaskedEdit, MASK } from '../src';

const dots = (n: number) => MASK.repeat(n);

describe('applyMaskedEdit', () => {
  it('types at the end', () => {
    expect(applyMaskedEdit('abc', dots(3) + 'd', { start: 3, end: 3 }).text).toBe('abcd');
  });

  it('types in the middle', () => {
    expect(applyMaskedEdit('abcd', dots(2) + 'X' + dots(2), { start: 2, end: 2 }).text).toBe('abXcd');
  });

  it('pastes several characters', () => {
    expect(applyMaskedEdit('', 'mot de passe', { start: 0, end: 0 }).text).toBe('mot de passe');
  });

  it('deletes before the caret', () => {
    const r = applyMaskedEdit('abcd', dots(3), { start: 4, end: 4 });
    expect(r.text).toBe('abc');
    expect(r.selection).toEqual({ start: 3, end: 3 });
    expect(applyMaskedEdit('abcd', dots(3), { start: 2, end: 2 }).text).toBe('acd');
  });

  it('replaces a selection by typing', () => {
    expect(applyMaskedEdit('abcdef', dots(1) + 'Z' + dots(2), { start: 1, end: 4 }).text).toBe('aZef');
  });

  it('deletes a selection', () => {
    expect(applyMaskedEdit('abcdef', dots(3), { start: 1, end: 4 }).text).toBe('aef');
  });

  it('clears everything', () => {
    expect(applyMaskedEdit('abcdef', '', { start: 0, end: 6 }).text).toBe('');
  });
});
