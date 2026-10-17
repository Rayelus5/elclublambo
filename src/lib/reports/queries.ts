// Moderation queue reads. Takes a Supabase client so it runs on the server. RLS only returns reports of channels where
// the reader holds MANAGE_MESSAGES; the snapshot (author + text) survives the deletion of the message.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberSummary } from "@/components/members/sponsor-tree";
import { shortAddress } from "@/lib/auth/wallet";
import type { ReportReason } from "@/lib/reports/reasons";

// Cap on rows read. Groups are built from rows, so when the cap is hit the oldest group may be incomplete: it is
// dropped and the page says it is showing the most recent ones.
const LIMIT = 1000;

export type ReportStatus = "open" | "dismissed" | "actioned";

export interface ReportGroup {
  key: string;
  /** The newest report of the group: resolving it resolves every open report of the same message. */
  reportId: string;
  status: ReportStatus;
  messageId: string | null;
  /** Soft-deleted, or removed altogether (only the snapshot is left). */
  messageDeleted: boolean;
  count: number;
  reasons: Array<{ reason: ReportReason; count: number }>;
  notes: string[];
  snapshotText: string;
  author: {
    id: string;
    name: string;
    walletAddress: string;
    status: "active" | "banned" | "left";
    sponsor: MemberSummary | null;
    sponsorIsAdmin: boolean;
  } | null;
  channel: { id: string; name: string };
  latestAt: string;
  resolvedAt: string | null;
}

interface AuthorRow {
  id: string;
  wallet_address: string;
  display_name: string | null;
  status: "active" | "banned" | "left";
  invited_by_member_id: string | null;
}

interface Row {
  id: string;
  message_id: string | null;
  channel_id: string;
  reason: ReportReason;
  note: string | null;
  snapshot_text: string;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
  channel: { name: string } | null;
  author: AuthorRow | null;
  message: { deleted_at: string | null } | null;
}

const SELECT =
  "id, message_id, channel_id, reason, note, snapshot_text, status, created_at, resolved_at, " +
  "channel:channels(name), " +
  "author:members!reports_snapshot_author_id_fkey(id, wallet_address, display_name, status, invited_by_member_id), " +
  "message:messages(deleted_at)";

const nameOf = (m: { display_name: string | null; wallet_address: string }) =>
  m.display_name?.trim() || shortAddress(m.wallet_address);

export interface ReportQueueResult {
  groups: ReportGroup[];
  /** More (older) reports exist than were read. */
  capped: boolean;
}

// Open: one group per message. Closed: per message and resolution batch (a batch shares resolved_at and status), so
// a message resolved twice shows two items.
const groupKey = (r: Row) =>
  `${r.message_id ?? `report:${r.id}`}:${r.status}${r.status === "open" ? "" : `:${r.resolved_at ?? ""}`}`;

export async function listReportQueue(status: "open" | "closed", supabase: SupabaseClient): Promise<ReportQueueResult> {
  let query = supabase.from("reports").select(SELECT);
  query = status === "open" ? query.eq("status", "open") : query.in("status", ["dismissed", "actioned"]);
  const { data, error } = (await query.order("created_at", { ascending: false }).limit(LIMIT)) as {
    data: Row[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  // Sponsors (for the optional "penalize sponsor" ban) and whether they are administrators (never penalized).
  const sponsorIds = [...new Set(rows.map((r) => r.author?.invited_by_member_id).filter((v): v is string => !!v))];
  const sponsors = new Map<string, MemberSummary>();
  const adminSponsors = new Set<string>();
  if (sponsorIds.length > 0) {
    const [members, admins] = await Promise.all([
      supabase.from("members").select("id, wallet_address, display_name, status").in("id", sponsorIds),
      supabase.from("member_roles").select("member_id, roles!inner(name)").eq("roles.name", "SuperAdmin").in("member_id", sponsorIds),
    ]);
    if (members.error) throw new Error(members.error.message);
    if (admins.error) throw new Error(admins.error.message);
    for (const m of (members.data ?? []) as Array<{ id: string; wallet_address: string; display_name: string | null; status: MemberSummary["status"] }>) {
      sponsors.set(m.id, { id: m.id, walletAddress: m.wallet_address, displayName: m.display_name, status: m.status });
    }
    for (const a of (admins.data ?? []) as Array<{ member_id: string }>) adminSponsors.add(a.member_id);
  }

  // Rows arrive newest first, so the first row of a group is its newest report and groups keep that order.
  const groups = new Map<string, ReportGroup>();
  const reasonCounts = new Map<string, Map<ReportReason, number>>();
  for (const r of rows) {
    const key = groupKey(r);
    let g = groups.get(key);
    if (!g) {
      const a = r.author;
      g = {
        key,
        reportId: r.id,
        status: r.status,
        messageId: r.message_id,
        messageDeleted: r.message_id === null || r.message === null || r.message.deleted_at !== null,
        count: 0,
        reasons: [],
        notes: [],
        snapshotText: r.snapshot_text,
        author: a
          ? {
              id: a.id,
              name: nameOf(a),
              walletAddress: a.wallet_address,
              status: a.status,
              sponsor: a.invited_by_member_id ? (sponsors.get(a.invited_by_member_id) ?? null) : null,
              sponsorIsAdmin: a.invited_by_member_id ? adminSponsors.has(a.invited_by_member_id) : false,
            }
          : null,
        channel: { id: r.channel_id, name: r.channel?.name ?? "canal" },
        latestAt: r.created_at,
        resolvedAt: r.resolved_at,
      };
      groups.set(key, g);
      reasonCounts.set(key, new Map());
    }
    g.count += 1;
    const counts = reasonCounts.get(key)!;
    counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
    const note = r.note?.trim();
    if (note && !g.notes.includes(note)) g.notes.push(note);
  }
  for (const [key, g] of groups) {
    g.reasons = [...reasonCounts.get(key)!].map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count);
  }
  const capped = rows.length >= LIMIT;
  if (capped) groups.delete(groupKey(rows[rows.length - 1]!));
  return { groups: [...groups.values()], capped };
}
