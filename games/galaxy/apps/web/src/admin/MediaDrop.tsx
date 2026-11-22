import { MEDIA_MAX_BYTES } from '@galaxy/shared';
import { type DragEvent, useRef, useState } from 'react';
import { useUploadMedia } from '../api/news';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { formatBytes } from './StorageScreen';

// The panel's image upload (the owner's «Tablón», 2026-11-14; shared with Torneos, plan «temporadas como fichas»,
// part 4): drop a PNG, JPG or WebP, or choose one, up to the media limit. It is checked here first (type and weight)
// and the server checks it again; once uploaded, its id goes to whoever asked (`/galaxy/api/media/<id>` serves it).

const t = copy.admin.news.image;

/** A drop zone with «Elegir archivo» that uploads one image and hands back its id. `hint` replaces the usual one. */
export function MediaDrop({ onUploaded, hint }: { onUploaded: (id: string) => void; hint?: string }) {
  const file = useRef<HTMLInputElement>(null);
  const upload = useUploadMedia();
  const [wrong, setWrong] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const send = (f: File | undefined) => {
    if (!f) return;
    setWrong(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return setWrong(t.wrongType);
    if (f.size > MEDIA_MAX_BYTES) return setWrong(t.tooBig(formatBytes(MEDIA_MAX_BYTES)));
    upload.mutate(f, { onSuccess: (r) => onUploaded(r.id) });
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    send(e.dataTransfer.files[0]);
  };
  return (
    <>
      <div
        className={`news-drop${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <Icon name="plus" />
        <p>
          <b>{t.drop}</b>
          <span>{hint ?? t.dropHint(formatBytes(MEDIA_MAX_BYTES))}</span>
        </p>
        <button type="button" className="lip pill small" disabled={upload.isPending} aria-busy={upload.isPending || undefined} onClick={() => file.current?.click()}>
          {upload.isPending ? t.uploading : t.choose}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label={t.choose}
          onChange={(e) => {
            send(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {wrong || upload.error ? (
        <p className="field-error" role="alert">
          {wrong ?? errorText(upload.error, copy.errors)}
        </p>
      ) : null}
    </>
  );
}
