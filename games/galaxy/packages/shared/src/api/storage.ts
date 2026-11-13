// «Almacenamiento» for admins (the owner: «desde admin deberíamos de poder visualizar el almacenamiento del servidor»):
// what the server keeps and how much it weighs. Galaxies are stored as rows (seed and traits); their pictures are drawn
// in each player's browser, so the server keeps no image of them.

/** How many of the game's biggest tables the page lists. */
export const STORAGE_TABLES_SHOWN = 12;

export interface StorageTable {
  /** The table's name in the game's schema (`galaxy`). */
  name: string;
  /** Postgres's estimate of its rows; null while the table was never analysed. */
  rows: number | null;
  /** Everything it weighs: data, indexes and TOAST. */
  bytes: number;
  indexBytes: number;
}

export interface AdminStorage {
  readAt: string;
  /** The whole database (the website's part too) and the game's schema inside it. */
  database: { bytes: number; gameBytes: number };
  /** The disk the server runs on; null when it cannot be read. */
  disk: { totalBytes: number; freeBytes: number } | null;
  /** Galaxies alive and disintegrated (their rows stay: fusions keep their lineage), and what their table weighs. */
  galaxies: { live: number; disintegrated: number; bytes: number };
  /** The game's biggest tables, heaviest first, at most STORAGE_TABLES_SHOWN. */
  tables: StorageTable[];
}
