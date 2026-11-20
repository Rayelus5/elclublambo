// The chat's word filter, to start with (the owner, 2026-11-14: «rellenar el filtro de palabras vacío con palabras
// malsonantes y ofensivas»). Insults and slurs in Spanish and English, each written as people write it (the filter
// ignores case and accents, and covers whole words only, so each form a word takes is its own entry). Mild
// exclamations (joder, mierda, hostia, fuck, shit) stay out on purpose: they are how many people talk, and covering
// them would only make normal conversations look censored. The live config (`chat.words`, Admin › Configuración)
// adds or removes words without a deploy; this list is its default and what ops/launch/2026-11-14-filtro-chat
// publishes.

const SPANISH = [
  // Insults.
  'gilipollas', 'gilipolla', 'imbecil', 'imbeciles', 'subnormal', 'subnormales', 'retrasado', 'retrasada', 'retrasados', 'retrasadas',
  'mongolo', 'mongola', 'mongolos', 'mongolas', 'mongolico', 'mongolica', 'cabron', 'cabrona', 'cabrones', 'cabronas',
  'capullo', 'capulla', 'capullos', 'capullas', 'cretino', 'cretina', 'cretinos', 'cretinas', 'tarado', 'tarada', 'tarados', 'taradas',
  'pendejo', 'pendeja', 'pendejos', 'pendejas', 'pelotudo', 'pelotuda', 'pelotudos', 'pelotudas', 'malparido', 'malparida', 'malparidos', 'malparidas',
  'hijoputa', 'hijaputa', 'hijoputas', 'hijueputa', 'hijueputas', 'hdp', 'puta', 'putas', 'puto', 'putos', 'zorra', 'zorras', 'furcia', 'furcias',
  'ramera', 'rameras', 'mamon', 'mamona', 'mamones', 'mamonas', 'chupapollas', 'soplapollas', 'comemierda', 'comemierdas', 'mamahuevo', 'mamahuevos',
  'malnacido', 'malnacida', 'malnacidos', 'malnacidas', 'bastardo', 'bastarda', 'bastardos', 'bastardas',
  // Slurs (sexuality, gender, origin).
  'maricon', 'maricones', 'marica', 'maricas', 'mariconazo', 'bollera', 'bolleras', 'travelo', 'travelos', 'sudaca', 'sudacas',
  'panchito', 'panchitos', 'negrata', 'negratas', 'machirulo', 'feminazi', 'feminazis',
  // Telling someone to die.
  'matate', 'suicidate', 'muerete',
];

const ENGLISH = [
  // Insults.
  'asshole', 'assholes', 'bitch', 'bitches', 'bastard', 'bastards', 'cunt', 'cunts', 'dickhead', 'dickheads', 'motherfucker', 'motherfuckers',
  'fucker', 'fuckers', 'retard', 'retards', 'retarded', 'moron', 'morons', 'dumbass', 'dumbasses', 'jackass', 'whore', 'whores', 'slut', 'sluts',
  'twat', 'twats', 'wanker', 'wankers',
  // Slurs.
  'faggot', 'faggots', 'fag', 'fags', 'nigger', 'niggers', 'nigga', 'niggas', 'kike', 'kikes', 'spic', 'spics', 'chink', 'chinks',
  'tranny', 'trannies', 'wetback', 'wetbacks', 'dyke', 'dykes',
  // Telling someone to die.
  'kys',
];

/** The word filter's starting list (the live config's default). */
export const DEFAULT_CHAT_WORDS: readonly string[] = Object.freeze([...SPANISH, ...ENGLISH]);
