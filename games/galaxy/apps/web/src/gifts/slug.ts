/** A library id from a name: «Veterano del vacío» → «veterano-del-vacio» (packs and templates, mail v2). */
export function librarySlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
}

/** The slug, made unique among `taken` with -2, -3… */
export function uniqueSlug(name: string, taken: readonly string[]): string {
  const base = librarySlug(name) || 'plantilla';
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, 29)}-${n}`;
    if (!taken.includes(id)) return id;
  }
}
