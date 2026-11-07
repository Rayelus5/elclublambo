import type { LabNodeView, LabView } from '@galaxy/shared';
import { Link } from 'react-router';
import { useLab, useUpgradeLabNode } from '../api/lab';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import { labIconUrl } from './icons';

// The Laboratorio (GDD §10.6, DESIGN_SYSTEM §8 octies): a lab blueprint with four branches of nodes. Each node says
// what it adds per level and now, shows its pips and offers its next level with the cost; a closed one says which node
// opens it. Closed until the room is repaired in the station.

const t = copy.lab;
const BRANCHES = ['probe', 'relics', 'station', 'extraction'] as const;
const BRANCH_ICON: Record<(typeof BRANCHES)[number], IconName> = { probe: 'probe', relics: 'cards', station: 'station', extraction: 'radar' };

function Resource({ kind, icon, amount, label }: { kind: string; icon: IconName; amount: number; label: string }) {
  return (
    <span className={`res ${kind}`} role="img" aria-label={label} title={label}>
      <Icon name={icon} />
      <b aria-hidden="true">{fmt(amount)}</b>
    </span>
  );
}

/** Root first, then each node after the one it needs (depth by its chain of requirements). */
function ordered(nodes: LabNodeView[]): { node: LabNodeView; depth: number }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n: LabNodeView): number => {
    let d = 0;
    for (let at = n.requires; at && byId.has(at) && d < nodes.length; at = byId.get(at)!.requires) d++;
    return d;
  };
  return nodes.map((node, i) => ({ node, depth: depth(node), i })).sort((a, b) => a.depth - b.depth || a.i - b.i);
}

function NodeIcon({ node }: { node: LabNodeView }) {
  const url = labIconUrl(node.id);
  if (!url) {
    return (
      <span className="lab-node-icon">
        <Icon name={BRANCH_ICON[node.branch]} />
      </span>
    );
  }
  return <span className="lab-node-art" aria-hidden="true" data-art={node.id} style={{ backgroundImage: `url(${url})` }} />;
}

function NodeCard({ node, depth, view, names, upgrade }: { node: LabNodeView; depth: number; view: LabView; names: Map<string, string>; upgrade: ReturnType<typeof useUpgradeLabNode> }) {
  const next = node.next;
  const short = next ? { dust: Math.max(0, next.dust - view.wallet.dust), components: Math.max(0, next.components - (view.wallet['components'] ?? 0)) } : null;
  const affordable = short !== null && short.dust === 0 && short.components === 0;
  return (
    <li className={`lab-node${node.unlocked ? '' : ' locked'}${next ? '' : ' maxed'}`} data-depth={Math.min(depth, 3)}>
      <NodeIcon node={node} />
      <div className="lab-node-body">
        <b>{node.name}</b>
        <small>{t.effect(node.effect, node.per)}</small>
        <div className="lab-node-level">
          <span>{t.level(node.level, node.max)}</span>
          <span className="level-pips" aria-hidden="true">
            {Array.from({ length: node.max }, (_, i) => (
              <i key={i} className={i < node.level ? 'on' : undefined} />
            ))}
          </span>
        </div>
        {node.level > 0 ? <small className="lab-node-now">{t.now(node.effect, node.per * node.level)}</small> : null}
        {!node.unlocked ? (
          <p className="panel-note">{t.needs(names.get(node.requires ?? '') ?? node.requires ?? '')}</p>
        ) : !next ? (
          <p className="panel-note lab-node-max">{t.maxed}</p>
        ) : (
          <>
            <button
              type="button"
              className="lip pill pill-solar lab-buy"
              disabled={!affordable || upgrade.isPending}
              aria-busy={(upgrade.isPending && upgrade.variables?.node === node.id) || undefined}
              onClick={() => upgrade.mutate({ node: node.id, level: node.level + 1 })}
            >
              <Icon name="wrench" />
              <span className="lab-buy-text">
                <span>{t.upgrade(node.level + 1)}</span>
                <small>{t.cost(next.dust, next.components)}</small>
              </span>
            </button>
            {short && !affordable ? <p className="panel-note">{t.missing(short.dust, short.components)}</p> : null}
          </>
        )}
      </div>
    </li>
  );
}

export function LabScreen() {
  const lab = useLab();
  const upgrade = useUpgradeLabNode();
  const v = lab.data;
  const names = new Map((v?.nodes ?? []).map((n) => [n.id, n.name]));
  return (
    <div className="screen-root lab-root">
      <div className="lab">
        <header className="collection-bar">
          <Link to="/estacion" className="lip pill">
            <Icon name="back" />
            <span>{t.back}</span>
          </Link>
          <h1>{t.title}</h1>
          <div className="lip panel hud">
            {v ? (
              <>
                <Resource kind="dust" icon="dust" amount={v.wallet.dust} label={copy.hub.resource.dust(v.wallet.dust)} />
                <Resource kind="components" icon="wrench" amount={v.wallet['components'] ?? 0} label={copy.station.resource.components(v.wallet['components'] ?? 0)} />
              </>
            ) : (
              <span className="res pending" role="img" aria-label={copy.loading}>
                ⠋⠙⠹
              </span>
            )}
          </div>
        </header>
        {lab.error || upgrade.error ? (
          <p className="field-error" role="alert">
            {errorText((upgrade.error ?? lab.error)!, copy.errors)}
          </p>
        ) : null}
        {v && !v.open ? (
          <div className="lip panel lab-closed">
            <p>{copy.errors.lab_closed}</p>
            <Link to="/estacion" className="lip pill pill-solar">
              <Icon name="station" />
              <span>{t.goStation}</span>
            </Link>
          </div>
        ) : null}
        {v && v.open ? (
          <div className="lab-tree">
            {BRANCHES.map((branch) => (
              <section key={branch} className={`lab-branch b-${branch}`} aria-labelledby={`lab-${branch}`}>
                <h2 id={`lab-${branch}`}>
                  <Icon name={BRANCH_ICON[branch]} />
                  {t.branches[branch]}
                </h2>
                <ul aria-label={t.branches[branch]}>
                  {ordered(v.nodes.filter((n) => n.branch === branch)).map(({ node, depth }) => (
                    <NodeCard key={node.id} node={node} depth={depth} view={v} names={names} upgrade={upgrade} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default LabScreen;
