import { mediaUrl, type NewsGalleryKey, type NewsImage } from '@galaxy/shared';

// The news board's own images (drawn for the game, 960×540, in apps/web/src/news/art/<key>.png), served as files,
// never inlined. An uploaded one is served by the API from the same origin. A key with no file yet has none (the card
// shows its section's colours instead).

const FILES = import.meta.glob<string>('./art/*.png', { eager: true, query: '?no-inline', import: 'default' });

export function galleryUrl(key: NewsGalleryKey): string | null {
  return FILES[`./art/${key}.png`] ?? null;
}

export function imageUrl(image: NewsImage | null): string | null {
  if (!image) return null;
  return image.kind === 'gallery' ? galleryUrl(image.key) : mediaUrl(image.id);
}
