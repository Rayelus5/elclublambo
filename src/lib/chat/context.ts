import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { mergeDirectory, type ViewerPermissions } from "@/lib/chat/model";
import { getMessages, getMessagesAround, getPinned } from "@/lib/chat/queries";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import type { ChatViewProps } from "@/components/chat/chat-view";

/** Everything the chat needs for its first paint, read through the member's own RLS. Dynamic: use inside Suspense. */
export async function loadChatContext(
  channelId: string,
  anchorId: string | null = null,
): Promise<
  Pick<ChatViewProps, "viewer" | "allowedDomains" | "initial"> & {
    /** The `?m=` message when it resolved in this channel; `threadRootId` is set when it is a reply. */
    anchor: { id: string; threadRootId: string | null } | null;
  }
> {
  const supabase = await createServerClient();
  const [me, perms, domains, read] = await Promise.all([
    supabase.rpc("current_member_id"),
    supabase.rpc("my_channel_permissions", { p_channel: channelId }),
    supabase.from("allowed_domains").select("domain"),
    supabase.from("channel_reads").select("last_read_at").eq("channel_id", channelId).maybeSingle<{ last_read_at: string }>(),
  ]);
  if (me.error || typeof me.data !== "string") throw new Error("chat: no member");
  const memberId = me.data;
  const bits = BigInt(String(perms.data ?? 0));

  const [page, pins, self] = await Promise.all([
    anchorId
      ? getMessagesAround(supabase, channelId, memberId, anchorId)
      : getMessages(supabase, channelId, memberId).then((p) => ({ ...p, hasNewer: false, anchorId: null, threadRootId: null })),
    getPinned(supabase, channelId, memberId),
    supabase.from("members").select("created_at").eq("id", memberId).maybeSingle<{ created_at: string }>(),
  ]);

  const viewer: ViewerPermissions = {
    memberId,
    canPost: hasPerm(bits, Perm.SEND_MESSAGES),
    canThread: hasPerm(bits, Perm.SEND_IN_THREADS),
    canManage: hasPerm(bits, Perm.MANAGE_MESSAGES),
    canAttach: hasPerm(bits, Perm.ATTACH_FILES),
    canMentionEveryone: hasPerm(bits, Perm.MENTION_EVERYONE),
    canReact: hasPerm(bits, Perm.ADD_REACTIONS),
    canEmbed: hasPerm(bits, Perm.EMBED_LINKS),
    canBounty: hasPerm(bits, Perm.CREATE_BOUNTIES) && hasPerm(bits, Perm.SEND_MESSAGES),
    canPoll: hasPerm(bits, Perm.CREATE_POLLS) && hasPerm(bits, Perm.SEND_MESSAGES),
  };

  return {
    anchor: page.anchorId ? { id: page.anchorId, threadRootId: page.threadRootId } : null,
    viewer,
    allowedDomains: ((domains.data ?? []) as Array<{ domain: string }>).map((d) => d.domain),
    initial: {
      messages: page.messages,
      hasMore: page.hasMore,
      hasNewer: page.hasNewer,
      directory: mergeDirectory(page.directory, pins.directory),
      pinned: pins.messages,
      // Same rule as my_unread_channels: with no read mark, everything since the member joined is unread.
      lastReadAt: read.data?.last_read_at ?? self.data?.created_at ?? null,
    },
  };
}
