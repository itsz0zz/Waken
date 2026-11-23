/** The dot a masked password shows for each character. */
export const MASK = '•';

/**
 * A password field that only shows dots (macOS, where the native secure field crashes): replays the edit the
 * user made on the shown dots onto the real text. The selection is the one from before the edit.
 * Typing, pasting, backspace and replacing a selection are exact; a forward delete counts as a backspace.
 */
export function applyMaskedEdit(real: string, shown: string, selection: { start: number; end: number }) {
  const chars = shown.split('');
  const first = chars.findIndex((c) => c !== MASK);
  const lastFromEnd = [...chars].reverse().findIndex((c) => c !== MASK);
  const typed = first === -1 ? '' : shown.slice(first, shown.length - lastFromEnd);
  const removed = Math.max(0, real.length - (shown.length - typed.length));
  const { start, end } = selection;
  const at = typed ? first : start !== end ? start : Math.max(0, start - removed);
  const text = real.slice(0, at) + typed + real.slice(at + removed);
  const caret = at + typed.length;
  return { text, selection: { start: caret, end: caret } };
}
