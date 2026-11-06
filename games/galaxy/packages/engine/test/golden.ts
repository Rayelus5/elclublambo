import { readFileSync } from 'node:fs';

// Golden references exported from the Python engine by tools/golden/export.py (ENGINE_PORT §9.5). They freeze v1.
const root = new URL('./golden/v1/', import.meta.url);

export function loadGolden<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(file, root), 'utf8')) as T;
}

export function goldenBytes(file: string): Buffer {
  return readFileSync(new URL(file, root));
}
