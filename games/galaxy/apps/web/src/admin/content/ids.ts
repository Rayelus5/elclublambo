/** A free id from `base`: itself, else «base-2», «base-3»… cut so it never passes 32 letters. */
export function uniqueId(base: string, taken: (id: string) => boolean): string {
  const root = (base || 'nueva-entrada').slice(0, 32);
  if (!taken(root)) return root;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = `${root.slice(0, 32 - suffix.length)}${suffix}`;
    if (!taken(id)) return id;
  }
}
