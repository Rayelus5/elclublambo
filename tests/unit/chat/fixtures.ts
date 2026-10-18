import type { ChatMessage, Directory, ViewerPermissions } from "@/lib/chat/model";

export const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CHANNEL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

let counter = 0;
export function makeMessage(over: Partial<ChatMessage> = {}): ChatMessage {
  counter += 1;
  const n = String(counter).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${n}`,
    channelId: CHANNEL,
    threadRootId: null,
    authorId: OTHER,
    body: doc(`mensaje ${counter}`),
    allowLinks: true,
    kind: "text",
    alphaAddress: null,
    expanded: false,
    quotedId: null,
    quote: null,
    replyCount: 0,
    lastReplyAt: null,
    pinnedAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 17, 10, counter, 0)).toISOString(),
    attachments: [],
    reactions: [],
    tips: [],
    tipId: null,
    tipLink: null,
    ...over,
  };
}

export const directory: Directory = {
  members: {
    [ME]: { name: "Yo Mismo", handle: null, displayName: "Yo Mismo", avatarPath: null, walletAddress: "0x1111111111111111111111111111111111111111" },
    [OTHER]: { name: "Ana", handle: "ana_l", displayName: "Ana", avatarPath: null, walletAddress: "0x2222222222222222222222222222222222222222" },
  },
  roles: {},
};

export const viewer = (over: Partial<ViewerPermissions> = {}): ViewerPermissions => ({
  memberId: ME,
  canPost: true,
  canThread: true,
  canManage: false,
  canAttach: true,
  canMentionEveryone: false,
  canReact: true,
  ...over,
});
