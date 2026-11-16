import { copy } from '../../copy/es';
import { Compose } from './Compose';
import { NoticeForm, NoticeList } from './Notices';
import { SentList } from './SentList';

/**
 * Comunicación (GDD §16.5; DESIGN_SYSTEM §8 vicies; mail v2), admins only: writing a message of a kind, with gifts of
 * every kind and packs of the library, to everyone, a list of accounts or a segment (with how many it reaches, the
 * letter as the player will see it, and the password when it gives anything); the sent list; the title notices.
 */
export function CommunicationScreen() {
  return (
    <section className="admin-page comms">
      <h1>{copy.admin.sections.communication}</h1>
      <Compose />
      <SentList />
      <NoticeForm />
      <NoticeList />
    </section>
  );
}
