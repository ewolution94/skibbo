// What this device prefers, kept on it: whether the piles a selected plate fits light up (on by
// default: the table's main help), and the table's size on a big screen (Auto fits the window;
// a fixed size never grows past it). Kept in localStorage; blocked storage means the defaults.

const HINT = 'skibbo:hint';
const SIZE = 'skibbo:size';

export type TableSize = 'auto' | '90' | '80';
const SIZES: TableSize[] = ['auto', '90', '80'];

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not kept
  }
}

export const prefs = $state({
  hint: read(HINT) !== 'off',
  size: (SIZES.includes(read(SIZE) as TableSize) ? read(SIZE) : 'auto') as TableSize,
});

export function setHint(on: boolean) {
  prefs.hint = on;
  keep(HINT, on ? 'on' : 'off');
}

export function setSize(size: TableSize) {
  prefs.size = size;
  keep(SIZE, size);
}
