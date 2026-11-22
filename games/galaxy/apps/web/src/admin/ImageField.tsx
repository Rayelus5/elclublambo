import { type MediaAsset, mediaUrl } from '@galaxy/shared';
import { useId } from 'react';
import { copy } from '../copy/es';
import { MediaDrop } from './MediaDrop';

// An uploaded image for a place in the game (plan «temporadas como fichas», part 4; shared since «Encuestas y avisos»):
// the ones uploaded already or a new one dropped or chosen, previewed in the proportion its place shows (a tournament's
// card is an 8:3 strip, a popup's image 16:9), with a warning when the chosen one has another shape and gets cropped.
// Its words come from whoever uses it; only «Sin imagen» is the panel's own.

/** The proportions an image's place can have. */
export type ImageAspect = '8:3' | '16:9';

/** The recommended size for each proportion. */
export const IMAGE_SIZES: Record<ImageAspect, { width: number; height: number }> = {
  '8:3': { width: 1600, height: 600 },
  '16:9': { width: 1600, height: 900 },
};

/** Whether an image of `width` × `height` has another shape than `aspect` (it would be cropped). */
export function offAspect(aspect: ImageAspect, width: number, height: number): boolean {
  const size = IMAGE_SIZES[aspect];
  return height > 0 && Math.abs(width / height - size.width / size.height) > 0.05;
}

export interface ImageFieldProps {
  /** The group's name. */
  label: string;
  /** Under the preview (and in the drop zone): the recommended size, where it shows. */
  hint: string;
  /** The chosen media asset's id, or null for none. */
  value: string | null;
  /** The uploaded images to choose from. */
  assets: readonly MediaAsset[];
  /** The proportion of the preview, as its place shows it. */
  aspect: ImageAspect;
  /** The warning that replaces the hint when the chosen image has another proportion; without it, any shape is fine. */
  offHint?: (width: number, height: number) => string;
  onChange: (id: string | null) => void;
}

/** An uploaded image chosen from a grid (or a new one), previewed at its place's proportion. */
export function ImageField({ label, hint, value, assets, aspect, offHint, onChange }: ImageFieldProps) {
  const ids = useId();
  const chosen = value ? assets.find((a) => a.id === value) : undefined;
  const off = offHint && chosen && offAspect(aspect, chosen.width, chosen.height) ? offHint(chosen.width, chosen.height) : null;
  const pick = (key: string, id: string | null, src: string | null, name: string) => (
    <label key={key} className={`news-pick${value === id ? ' on' : ''}`}>
      <input type="radio" name={`${ids}-img`} checked={value === id} onChange={() => onChange(id)} />
      {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <span className="news-pick-none" aria-hidden="true" />}
      <span>{name}</span>
    </label>
  );
  return (
    <fieldset className="news-picker admin-image">
      <legend>{label}</legend>
      <div className="admin-image-preview" data-aspect={aspect}>
        {value ? <img src={mediaUrl(value)} alt="" draggable={false} /> : <span className="admin-image-sky" aria-hidden="true" />}
      </div>
      <p className={off ? 'cf-hint admin-image-warn' : 'cf-hint'}>{off ?? hint}</p>
      <div className="news-picks admin-image-picks" role="presentation">
        {pick('none', null, null, copy.admin.imageField.none)}
        {assets.map((a) => pick(a.id, a.id, mediaUrl(a.id), a.name))}
      </div>
      <MediaDrop hint={hint} onUploaded={onChange} />
    </fieldset>
  );
}
