import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { copy } from '../../copy/es';
import { Compose, type ComposeSeed } from './Compose';
import { NoticeForm, NoticeList } from './Notices';
import { SentList } from './SentList';

/**
 * Comunicación (GDD §16.5; DESIGN_SYSTEM §8 vicies; mail v2), admins only: writing a message of a kind, with gifts of
 * every kind and packs of the library, to everyone, a list of accounts or a segment (with how many it reaches, the
 * letter as the player will see it, and the password when it gives anything); the sent list; the title notices.
 */
export function CommunicationScreen() {
  // «Duplicar» starts a fresh form from a sent message (mail v2, P5); `?para=<usuario>&asunto=<título>` starts a personal
  // message to that account (a tournament's cash winner, from «Escribir»).
  const [params] = useSearchParams();
  const [seed, setSeed] = useState<{ n: number; seed: ComposeSeed } | null>(() => {
    const to = params.get('para');
    return to ? { n: 0, seed: { type: 'personal', title: params.get('asunto') ?? '', body: '', items: [], packs: [], expiresInDays: 30, usernames: [to] } } : null;
  });
  return (
    <section className="admin-page comms">
      <h1>{copy.admin.sections.communication}</h1>
      <Compose key={seed?.n ?? 0} seed={seed?.seed} />
      <SentList
        onDuplicate={(s) => {
          setSeed((x) => ({ n: (x?.n ?? 0) + 1, seed: s }));
          window.scrollTo?.({ top: 0, behavior: 'smooth' });
        }}
      />
      <NoticeForm />
      <NoticeList />
    </section>
  );
}
