"use client";

import { useRef, useState } from "react";
import { CornerDownRight, MessageSquare, MoreHorizontal, Pin, Trash2 } from "lucide-react";
import { AlphaCard } from "@/components/chat/alpha-card";
import { AttachmentGrid } from "@/components/chat/attachment-grid";
import { MessageContent } from "@/components/chat/message-content";
import { MessageEdit } from "@/components/chat/message-edit";
import { ReactionBar } from "@/components/chat/reaction-bar";
import { MemberAvatar } from "@/components/members/member-avatar";
import { ReportDialog } from "@/components/reports/report-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChatMessage, Directory, ViewerPermissions } from "@/lib/chat/model";
import type { MemberIdentity } from "@/lib/members/name";
import { cn } from "@/lib/utils";

export type MessageVariant = "list" | "thread" | "pinned";

export interface MessageItemHandlers {
  /** Opens the thread panel; `opener` is where focus returns when it closes. */
  onOpenThread?: (message: ChatMessage, opener: HTMLElement | null) => void;
  onQuote?: (message: ChatMessage) => void;
  /** Resolves to an error message, or null when the edit was saved. */
  onEdit?: (message: ChatMessage, doc: unknown) => Promise<string | null>;
  /** Resolves to an error message, or null/void when deleted. */
  onDelete?: (message: ChatMessage) => Promise<string | null | void> | void;
  onPin?: (message: ChatMessage, pinned: boolean) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
}

export interface MessageItemProps extends MessageItemHandlers {
  message: ChatMessage;
  directory: Directory;
  allowedDomains: readonly string[];
  viewer: ViewerPermissions;
  /** Continues the previous message's run: no avatar or header. */
  grouped?: boolean;
  variant?: MessageVariant;
  /** The target of a `?m=` jump, for a couple of seconds: accent border and `aria-current`. */
  highlighted?: boolean;
}

const DAY_TIME = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const FULL = new Intl.DateTimeFormat("es", { dateStyle: "full", timeStyle: "short" });
const SHORT = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toDateString() === new Date().toDateString() ? DAY_TIME.format(d) : SHORT.format(d);
}

function Time({ iso, className }: { iso: string; className?: string }) {
  const d = new Date(iso);
  return (
    // The server renders in its own time zone: the client text wins on hydration.
    <time dateTime={iso} title={Number.isNaN(d.getTime()) ? undefined : FULL.format(d)} className={className} suppressHydrationWarning>
      {formatTime(iso)}
    </time>
  );
}

export function MessageItem({
  message,
  directory,
  allowedDomains,
  viewer,
  grouped = false,
  variant = "list",
  highlighted = false,
  onOpenThread,
  onQuote,
  onEdit,
  onDelete,
  onPin,
  onToggleReaction,
}: MessageItemProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusMoved = useRef(false);

  const author = directory.members[message.authorId];
  const name = author?.name ?? "Miembro";
  const identity: MemberIdentity = author ?? { handle: null, displayName: null, walletAddress: message.authorId, avatarPath: null };
  const deleted = message.deletedAt !== null;
  const own = message.authorId === viewer.memberId;
  const isRoot = message.threadRootId === null;

  const canReply = variant === "list" && isRoot && !deleted;
  const canQuote = variant === "list" && !deleted && viewer.canPost;
  const canEdit = own && !deleted && variant !== "pinned" && !!onEdit;
  const canDelete = (own || viewer.canManage) && !deleted && variant !== "pinned" && !!onDelete;
  const canPin = viewer.canManage && isRoot && !deleted && variant !== "pinned" && !!onPin;
  const canReport = !own && !deleted && variant !== "pinned";
  const hasMenu = canReply || canQuote || canEdit || canDelete || canPin || canReport;

  const replies =
    variant === "list" && isRoot && message.replyCount > 0 ? (
      <button
        type="button"
        onClick={(e) => onOpenThread?.(message, e.currentTarget)}
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-control px-2 text-sm font-medium text-accent outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <MessageSquare aria-hidden className="size-4" />
        {message.replyCount === 1 ? "1 respuesta" : `${message.replyCount} respuestas`}
      </button>
    ) : null;

  const confirm = async () => {
    setDeleting(true);
    setDeleteError(null);
    const err = await Promise.resolve(onDelete?.(message)).catch(() => "No se pudo borrar el mensaje.");
    setDeleting(false);
    if (err) setDeleteError(err);
    else setConfirmDelete(false);
  };

  return (
    <li
      id={`msg-${message.id}`}
      data-message-id={message.id}
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        "group relative -mx-2 flex gap-3 rounded-control border-l-2 px-2 py-1 transition-colors duration-150 focus-within:bg-surface-2/60 hover:bg-surface-2/60 motion-reduce:transition-none",
        highlighted ? "border-accent bg-surface-2" : "border-transparent",
        grouped ? "mt-0" : "mt-3 first:mt-0",
      )}
    >
      <div className="w-9 shrink-0">
        {grouped ? (
          <Time iso={message.createdAt} className="sr-only md:not-sr-only md:block md:pt-1 md:text-[11px] md:text-fg-muted md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" />
        ) : (
          <MemberAvatar member={identity} size={32} />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {grouped ? null : (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display font-bold text-fg" title={author?.walletAddress}>
              {name}
            </span>
            {author?.displayName?.trim() && author.handle ? <span className="text-[13px] text-fg-muted">@{author.handle}</span> : null}
            <Time iso={message.createdAt} className="text-[13px] text-fg-muted" />
            {message.pinnedAt && !deleted ? (
              <span className="inline-flex items-center gap-1 text-[13px] text-fg-muted">
                <Pin aria-hidden className="size-3.5" />
                <span>Fijado</span>
              </span>
            ) : null}
          </div>
        )}

        {deleted ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted italic">
            <Trash2 aria-hidden className="size-4 shrink-0" />
            Mensaje eliminado
          </p>
        ) : editing ? (
          <MessageEdit
            body={message.body}
            expanded={message.expanded}
            canMentionEveryone={viewer.canMentionEveryone}
            hasAttachments={message.attachments.length > 0}
            onSave={async (doc) => {
              const err = (await onEdit?.(message, doc)) ?? null;
              if (!err) {
                setEditing(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }
              return err;
            }}
            onCancel={() => {
              setEditing(false);
              requestAnimationFrame(() => triggerRef.current?.focus());
            }}
          />
        ) : (
          <>
            {message.quote ? (
              <blockquote className="flex min-w-0 items-start gap-2 border-l-2 border-border-strong pl-2 text-sm text-fg-muted">
                <CornerDownRight aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {message.quote.deleted ? (
                  <span className="italic">Mensaje eliminado</span>
                ) : (
                  <span className="min-w-0">
                    <span className="font-bold text-fg">{message.quote.authorName}</span>
                    <span className="sr-only">: </span>{" "}
                    <span className="break-words">{message.quote.text}</span>
                  </span>
                )}
              </blockquote>
            ) : null}
            {message.kind === "alpha" && message.alphaAddress ? <AlphaCard address={message.alphaAddress} /> : null}
            <MessageContent doc={message.body} allowLinks={message.allowLinks} allowedDomains={allowedDomains} mentionsDir={directory} />
            {message.editedAt ? (
              <span className="self-start text-[13px] text-fg-muted" title={`Editado ${formatTime(message.editedAt)}`}>
                editado
              </span>
            ) : null}
            <AttachmentGrid attachments={message.attachments} />
          </>
        )}

        {!deleted && variant !== "pinned" ? (
          <ReactionBar
            reactions={message.reactions}
            canReact={viewer.canReact}
            onToggle={(emoji) => onToggleReaction?.(message, emoji)}
          />
        ) : null}
        {replies}
      </div>

      {hasMenu && !editing ? (
        <div className="shrink-0 self-start">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                aria-label="Acciones del mensaje"
                className="flex size-11 items-center justify-center rounded-control text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-2 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:data-[state=open]:opacity-100"
              >
                <MoreHorizontal aria-hidden className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              aria-label="Acciones del mensaje"
              onCloseAutoFocus={(e) => {
                // The chosen action already moved focus (thread panel, composer, editor): don't pull it back.
                if (focusMoved.current) {
                  e.preventDefault();
                  focusMoved.current = false;
                }
              }}
            >
              {canReply ? (
                <DropdownMenuItem
                  onSelect={() => {
                    focusMoved.current = true;
                    onOpenThread?.(message, triggerRef.current);
                  }}
                >
                  {viewer.canThread ? "Responder en hilo" : "Ver hilo"}
                </DropdownMenuItem>
              ) : null}
              {canQuote ? (
                <DropdownMenuItem
                  onSelect={() => {
                    focusMoved.current = true;
                    onQuote?.(message);
                  }}
                >
                  Citar
                </DropdownMenuItem>
              ) : null}
              {canEdit ? (
                <DropdownMenuItem
                  onSelect={() => {
                    focusMoved.current = true;
                    setEditing(true);
                  }}
                >
                  Editar
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  Borrar
                </DropdownMenuItem>
              ) : null}
              {canPin ? (
                <DropdownMenuItem onSelect={() => onPin?.(message, message.pinnedAt === null)}>
                  {message.pinnedAt === null ? "Fijar" : "Desfijar"}
                </DropdownMenuItem>
              ) : null}
              {canReport ? (
                <DropdownMenuItem onSelect={() => setReporting(true)}>Reportar</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {canReport ? <ReportDialog messageId={message.id} open={reporting} onOpenChange={setReporting} /> : null}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (deleting) return;
          setConfirmDelete(open);
          if (!open) setDeleteError(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar este mensaje?</AlertDialogTitle>
            <AlertDialogDescription>
              {message.replyCount > 0
                ? "Se quedará como “Mensaje eliminado” y se conservarán sus respuestas."
                : "Esta acción no se puede deshacer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-danger">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                // Keep the dialog open until the server answers, so an error can be shown in it.
                e.preventDefault();
                void confirm();
              }}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
