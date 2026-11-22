import { readFileSync } from 'node:fs';
import { popupState, type PopupState } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { AuditActor } from '../audit';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import { uploadMedia } from '../news/service';
import { cliConfig, inMadrid } from '../season/cli';
import { createPopup, type PopupDeps, updatePopup } from './admin';
import { allPopups, popupById, recordIssues } from './records';

// The container CLI's «Encuestas y avisos» commands (plan 2026-11-22, part A): a campaign prepared in a folder of
// ops/launch goes to PRE as a DRAFT, never further (publishing is the panel's, with the admin's password and a
// superadmin for big rewards). A bundle can carry the campaign's image: it is uploaded first (the same image is never
// stored twice) and the draft points at it.

type Out = (s: string) => void;
const CLI_ACTOR: AuditActor = { id: null, label: 'cli' };

const STATE: Record<PopupState, string> = { draft: 'borrador', scheduled: 'programada', live: 'en curso', ended: 'terminada' };
const KIND: Record<string, string> = { survey: 'Encuesta', review: 'Valoración', form: 'Formulario', promotion: 'Promoción' };

/** `popup-list`: every campaign by start, with its kind, state, dates in Madrid and title. */
export async function popupList(db: Kysely<DB>, out: Out): Promise<number> {
  const list = await allPopups(db, (id, err) => out(`Ojo: la campaña ${id} tiene una ficha que ya no vale (${(err as Error).message})`));
  if (list.length === 0) {
    out('No hay campañas');
    return 0;
  }
  const now = new Date();
  for (const p of [...list].sort((a, b) => Date.parse(a.record.startsAt) - Date.parse(b.record.startsAt))) {
    const state = popupState({ state: p.state, startsAt: p.record.startsAt, endsAt: p.record.endsAt, endedAt: p.endedAt }, now);
    out(`${p.id}  ${KIND[p.record.kind] ?? p.record.kind}  ${STATE[state]}  ${inMadrid(p.record.startsAt)} → ${inMadrid(p.record.endsAt)} (Madrid)  ${p.record.title}  v${p.version}`);
  }
  return 0;
}

/** What `popup-draft` reads: a campaign record, an id to replace a draft, and maybe its image (base64). */
const draftInputSchema = z
  .object({
    id: z.uuid().optional(),
    record: z.record(z.string(), z.unknown()),
    image: z.object({ name: z.string().trim().min(1).max(80), data: z.string().min(1) }).strict().optional(),
  })
  .strict();

function readInput(source: string): unknown {
  const text = readFileSync(source === '-' ? 0 : source, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
}

const ERRORS: Record<string, string> = {
  popup_invalid: 'La campaña no vale:',
  popup_not_draft: 'Esa campaña ya no es un borrador: vuélvela a borrador en Administración › Encuestas y avisos antes de cambiarla',
  popup_conflict: 'Alguien la ha cambiado a la vez: vuelve a lanzarlo',
  popup_not_found: 'No hay ninguna campaña con ese id',
  media_invalid: 'La imagen no vale: tiene que ser PNG, JPEG o WebP de 2 MB como mucho',
};

function printError(err: unknown, out: Out): number {
  if (err instanceof HttpError) {
    out(ERRORS[err.code] ?? `Error: ${err.code}`);
    for (const i of (err.details?.issues ?? []) as { path: string; message: string }[]) out(`  ${i.path || '(raíz)'}: ${i.message}`);
    return 1;
  }
  throw err;
}

/**
 * `popup-draft <campaña.json | -> --reason <motivo>`: saves a campaign as a draft, new or (with `id`) replacing that
 * draft. The input is `{ record, id?, image?: { name, data } }` (`scripts/popup-bundle.mjs` builds it from a folder's
 * file, with its image). It never publishes: that is the panel's, with a password.
 */
export async function popupDraft(db: Kysely<DB>, source: string | undefined, reason: string | undefined, out: Out): Promise<number> {
  if (!source || !reason || reason.length < 3) {
    out('Uso: popup-draft <campaña.json | -> --reason <motivo de 3 caracteres o más>');
    return 1;
  }
  let input: z.infer<typeof draftInputSchema>;
  try {
    const parsed = draftInputSchema.safeParse(readInput(source));
    if (!parsed.success) {
      out('El JSON tiene que ser { record, id?, image?: { name, data } }');
      return 1;
    }
    input = parsed.data;
  } catch (err) {
    out(`No se pudo leer el JSON de ${source}: ${(err as Error).message}`);
    return 1;
  }
  const deps: PopupDeps = { db, config: await cliConfig(db), now: () => new Date() };
  try {
    const record = { ...input.record };
    if (input.image) record['imageMedia'] = (await uploadMedia(deps, CLI_ACTOR, input.image)).id;
    const p = input.id ? await updatePopup(deps, CLI_ACTOR, input.id, record, (await popupById(db, input.id)).version, reason) : await createPopup(deps, CLI_ACTOR, record, reason);
    out(`${input.id ? 'Borrador cambiado' : 'Guardado como borrador'}: ${p.id}  ${KIND[p.record.kind] ?? p.record.kind}  ${p.record.title}  ${inMadrid(p.record.startsAt)} → ${inMadrid(p.record.endsAt)} (Madrid)  v${p.version}`);
    const left = await recordIssues(db, deps.config, p.record, new Date(), true);
    for (const i of left) out(`  Para publicarla falta: ${i.path || '(raíz)'}: ${i.message}`);
    out('Para que salga: Administración › Encuestas y avisos › el borrador › Revisión › «Guardar y publicar» (pide tu contraseña)');
    return 0;
  } catch (err) {
    return printError(err, out);
  }
}
