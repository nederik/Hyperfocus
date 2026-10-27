/** A line-by-line difference (longest common subsequence). Shown when comparing the two sides of a note. */
export type DiffLine = { type: 'same' | 'del' | 'add'; text: string };

export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.replace(/\r\n/g, '\n').split('\n');
  const y = b.replace(/\r\n/g, '\n').split('\n');
  // Common lines at the start and end are set aside (the table stays small for most differences)
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const xs = x.slice(start, endX);
  const ys = y.slice(start, endY);
  const n = xs.length;
  const m = ys.length;
  const out: DiffLine[] = x.slice(0, start).map((text) => ({ type: 'same', text }));
  if (n * m > 4_000_000) {
    // A very large difference: shown as all removed, then all added
    out.push(...xs.map((text) => ({ type: 'del' as const, text })), ...ys.map((text) => ({ type: 'add' as const, text })));
  } else {
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = xs[i] === ys[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (xs[i] === ys[j]) {
        out.push({ type: 'same', text: xs[i]! });
        i++;
        j++;
      } else if (L[i + 1]![j]! >= L[i]![j + 1]!) out.push({ type: 'del', text: xs[i++]! });
      else out.push({ type: 'add', text: ys[j++]! });
    }
    while (i < n) out.push({ type: 'del', text: xs[i++]! });
    while (j < m) out.push({ type: 'add', text: ys[j++]! });
  }
  out.push(...x.slice(endX).map((text) => ({ type: 'same' as const, text })));
  return out;
}
