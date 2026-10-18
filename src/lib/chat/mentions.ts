// Pure helpers for the composer: mention suggestion items, slash commands and the Enter key decision.
// Kept free of React/Tiptap so they are unit-testable (ProseMirror is finicky in jsdom).
import { shortAddress } from "@/lib/auth/wallet";

export const MENTION_LIMIT = 8;

export type MentionKind = "member" | "role" | "everyone";

export interface MentionItem {
  kind: MentionKind;
  id: string | null;
  /** Display text only; renderers resolve the real name from `id`. */
  label: string;
  hint?: string;
  /** The label is the member's @handle (the list shows it with "@"; the inserted chip is "@" + label either way). */
  handle?: true;
}

export interface MentionMemberHit {
  id: string;
  /** Display name ("" when unset). */
  label: string;
  handle?: string | null;
  walletAddress: string;
}

export interface MentionRoleHit {
  id: string;
  label: string;
}

export interface MentionSearchResult {
  members: MentionMemberHit[];
  roles: MentionRoleHit[];
}

export function buildMentionItems(input: {
  query: string;
  members: MentionMemberHit[];
  roles: MentionRoleHit[];
  canMentionEveryone: boolean;
}): MentionItem[] {
  const q = input.query.trim().toLowerCase();
  const items: MentionItem[] = [];
  // @everyone only exists as a suggestion for members who hold MENTION_EVERYONE.
  if (input.canMentionEveryone && "everyone".startsWith(q)) {
    items.push({ kind: "everyone", id: null, label: "everyone", hint: "Avisa a todo el canal" });
  }
  for (const m of input.members) {
    if (m.handle) {
      items.push({
        kind: "member",
        id: m.id,
        label: m.handle,
        handle: true,
        hint: m.label.trim() || shortAddress(m.walletAddress),
      });
      continue;
    }
    items.push({
      kind: "member",
      id: m.id,
      label: m.label.trim() || shortAddress(m.walletAddress),
      hint: m.label.trim() ? shortAddress(m.walletAddress) : undefined,
    });
  }
  for (const r of input.roles) items.push({ kind: "role", id: r.id, label: r.label, hint: "Rol" });
  return items.slice(0, MENTION_LIMIT);
}

export async function loadMentionItems(
  query: string,
  deps: { canMentionEveryone: boolean; search: (q: string) => Promise<MentionSearchResult> },
): Promise<MentionItem[]> {
  let found: MentionSearchResult = { members: [], roles: [] };
  try {
    found = await deps.search(query);
  } catch {
    // network/server failure: fall back to whatever needs no lookup
  }
  return buildMentionItems({ query, ...found, canMentionEveryone: deps.canMentionEveryone });
}

// --- slash commands ---------------------------------------------------------------------------------

export type SlashCommandId = "alpha" | "imagen" | "codigo";

export interface SlashCommand {
  id: SlashCommandId;
  label: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: "alpha", label: "/alpha", description: "Compartir un contrato (mensaje Alpha)" },
  { id: "imagen", label: "/imagen", description: "Adjuntar una imagen" },
  { id: "codigo", label: "/codigo", description: "Insertar un bloque de código" },
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterSlashCommands(query: string, opts: { canAttach: boolean; hasAlpha: boolean }): SlashCommand[] {
  const q = fold(query.trim());
  return SLASH_COMMANDS.filter((c) => {
    if (c.id === "imagen" && !opts.canAttach) return false;
    if (c.id === "alpha" && !opts.hasAlpha) return false;
    return c.id.startsWith(q);
  });
}

// --- keyboard ----------------------------------------------------------------------------------------

export interface KeyInfo {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}

/**
 * Decides what Enter does. Compact box: Enter sends, Shift+Enter is a newline. Expanded editor: Enter is
 * a newline, Ctrl/Cmd+Enter sends. Never sends while a suggestion popup is open (Enter picks the item) or
 * while an IME is composing (Enter confirms the composition).
 */
export function composerKeyAction(e: KeyInfo, ctx: { expanded: boolean; suggestionOpen: boolean }): "send" | "default" {
  if (e.key !== "Enter" || e.isComposing || ctx.suggestionOpen) return "default";
  if (ctx.expanded) return e.ctrlKey || e.metaKey ? "send" : "default";
  return e.shiftKey ? "default" : "send";
}
