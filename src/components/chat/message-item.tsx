"use client";

import { useRef, useState } from "react";
import {
  CircleCheck,
  CornerDownRight,
  Coins,
  Flag,
  Link2,
  MessageSquare,
  MessageSquareReply,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Quote,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { AlphaCard } from "@/components/chat/alpha-card";
import { AttachmentGrid } from "@/components/chat/attachment-grid";
import { BountyCard } from "@/components/chat/bounty-card";
import { useChatDensity } from "@/components/chat/density";
import { MessageContent } from "@/components/chat/message-content";
import { MessageEdit } from "@/components/chat/message-edit";
import { SystemNotice } from "@/components/chat/system-notice";
import { ReactionBar } from "@/components/chat/reaction-bar";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberCardTrigger } from "@/components/members/member-card";
import { TipDialog } from "@/components/payments/tip-dialog";
import { TipsBadge } from "@/components/payments/tips-badge";
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
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChatMessage, Directory, ViewerPermissions } from "@/lib/chat/model";
import { rpcErrorMessage } from "@/lib/errors";
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
  /** A bounty message changed (cancelled, or its payment dialog closed): the list re-reads it. */
  onBountyChanged?: (message: ChatMessage) => void;
  /**
   * Present only for the author of an open bounty, inside its thread: marks `message` (a reply) as the solution.
   * Resolves to an error message, or null when it was marked.
   */
  onMarkSolution?: (message: ChatMessage) => Promise<string | null>;
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
  /** This reply is the bounty's marked solution. */
  isSolution?: boolean;
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
  isSolution = false,
  onOpenThread,
  onQuote,
  onEdit,
  onDelete,
  onPin,
  onToggleReaction,
  onBountyChanged,
  onMarkSolution,
}: MessageItemProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [tipping, setTipping] = useState(false);
  const [confirmMark, setConfirmMark] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [reactionPicker, setReactionPicker] = useState(false);
  // Compact: no avatar, the time in a narrow left column, tight spacing (the member's preference for every channel).
  const compact = useChatDensity().density === "compact";
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusMoved = useRef(false);

  const authorId = message.authorId;
  const author = authorId ? directory.members[authorId] : undefined;
  const name = author?.name ?? "Miembro";
  const identity: MemberIdentity = author ?? { handle: null, displayName: null, walletAddress: authorId ?? "", avatarPath: null };
  const deleted = message.deletedAt !== null;
  const own = authorId !== null && authorId === viewer.memberId;
  const isRoot = message.threadRootId === null;

  const canReply = variant === "list" && isRoot && !deleted;
  const canQuote = variant === "list" && !deleted && viewer.canPost;
  const canEdit = own && !deleted && variant !== "pinned" && !!onEdit;
  const canDelete = (own || viewer.canManage) && !deleted && variant !== "pinned" && !!onDelete;
  const canPin = viewer.canManage && isRoot && !deleted && variant !== "pinned" && !!onPin;
  const canReport = !own && !deleted && variant !== "pinned";
  // Tips go to a person: never on one's own message, a deleted one, or a system notice (no author).
  const canTip = !own && !deleted && variant !== "pinned" && message.kind !== "system" && authorId !== null;
  // Only the author of an open bounty gets the handler; it is offered on other members' visible replies.
  const canMark = !!onMarkSolution && !own && !deleted && variant === "thread" && message.threadRootId !== null && message.kind !== "system";
  const canAddReaction = viewer.canReact && !deleted && variant !== "pinned" && !!onToggleReaction;
  const hasMenu = canAddReaction || canReply || canQuote || canEdit || canDelete || canPin || canTip || canReport;

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

  const mark = async () => {
    setMarking(true);
    setMarkError(null);
    const err = await Promise.resolve(onMarkSolution?.(message)).catch(() => rpcErrorMessage("unknown"));
    setMarking(false);
    if (err) setMarkError(err);
    else setConfirmMark(false);
  };

  const bounty = message.kind === "bounty" ? message.bounty : null;
  const solverMember = bounty?.solverId ? directory.members[bounty.solverId] : undefined;

  if (message.kind === "system") {
    // A notice a moderator removed leaves no trace in the thread.
    if (deleted) return null;
    return (
      <li
        id={`msg-${message.id}`}
        data-message-id={message.id}
        aria-current={highlighted ? "true" : undefined}
        className={cn(
          "group relative -mx-2 mt-3 flex gap-1 rounded-control border-l-2 px-2 py-0.5 transition-colors duration-150 first:mt-0 focus-within:bg-surface-2/60 hover:bg-surface-2/60 motion-reduce:transition-none",
          highlighted ? "border-accent bg-surface-2" : "border-transparent",
        )}
      >
        <SystemNotice message={message} />
        <div className="shrink-0 self-start">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Acciones del mensaje"
                className="flex size-11 items-center justify-center rounded-control text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-2 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:data-[state=open]:opacity-100"
              >
                <MoreHorizontal aria-hidden className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent aria-label="Acciones del mensaje">
              <DropdownMenuItem
                onSelect={() => {
                  const url = `${window.location.origin}/c/${message.channelId}?m=${message.id}`;
                  void navigator.clipboard?.writeText(url).catch(() => undefined);
                }}
              >
                <Link2 aria-hidden />
                Copiar enlace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>
    );
  }

  return (
    <li
      id={`msg-${message.id}`}
      data-message-id={message.id}
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        "group relative -mx-2 flex rounded-control border-l-2 px-2 transition-colors duration-150 focus-within:bg-surface-2/60 hover:bg-surface-2/60 motion-reduce:transition-none",
        compact ? "gap-2 py-0" : "gap-3 py-1",
        highlighted ? "border-accent bg-surface-2" : "border-transparent",
        grouped ? "mt-0" : compact ? "mt-1 first:mt-0" : "mt-3 first:mt-0",
      )}
    >
      {compact ? (
        <div className="w-11 shrink-0 pt-[3px] text-right">
          <Time
            iso={message.createdAt}
            className={cn(
              "font-mono text-[11px] text-fg-muted",
              grouped && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          />
        </div>
      ) : (
        <div className="w-9 shrink-0">
          {grouped ? (
            <Time iso={message.createdAt} className="sr-only md:not-sr-only md:block md:pt-1 md:text-[11px] md:text-fg-muted md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" />
          ) : authorId ? (
            <MemberCardTrigger memberId={authorId} label={name} className="block" tabbable={false}>
              <MemberAvatar member={identity} size={32} />
            </MemberCardTrigger>
          ) : (
            <MemberAvatar member={identity} size={32} />
          )}
        </div>
      )}

      <div className={cn("flex min-w-0 flex-1 flex-col", compact ? "gap-0.5" : "gap-1")}>
        {grouped ? null : (
          <div className={cn("flex flex-wrap items-baseline gap-x-2", compact && "leading-5")}>
            {authorId ? (
              <MemberCardTrigger memberId={authorId} label={name} className="font-display font-bold text-fg hover:underline">
                {name}
              </MemberCardTrigger>
            ) : (
              <span className="font-display font-bold text-fg">{name}</span>
            )}
            {author?.displayName?.trim() && author.handle && !compact ? <span className="text-[13px] text-fg-muted">@{author.handle}</span> : null}
            {compact ? null : <Time iso={message.createdAt} className="text-[13px] text-fg-muted" />}
            {message.pinnedAt && !deleted ? (
              <span className="inline-flex items-center gap-1 text-[13px] text-fg-muted">
                <Pin aria-hidden className="size-3.5" />
                <span>Fijado</span>
              </span>
            ) : null}
          </div>
        )}

        {isSolution && !deleted ? (
          <span className="inline-flex min-h-7 items-center gap-1.5 self-start rounded-control border border-success px-2 text-[13px] font-bold text-success">
            <CircleCheck aria-hidden className="size-3.5" />
            Solución
          </span>
        ) : null}

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
            {bounty ? (
              <BountyCard
                messageId={message.id}
                channelId={message.channelId}
                bounty={bounty}
                isAuthor={own}
                solver={solverMember && bounty.solverId ? { ...solverMember, id: bounty.solverId } : null}
                onChanged={() => onBountyChanged?.(message)}
              />
            ) : null}
            <MessageContent doc={message.body} allowLinks={message.allowLinks} allowedDomains={allowedDomains} mentionsDir={directory} />
            {message.editedAt ? (
              <span className="self-start text-[13px] text-fg-muted" title={`Editado ${formatTime(message.editedAt)}`}>
                editado
              </span>
            ) : null}
            <AttachmentGrid attachments={message.attachments} />
          </>
        )}

        {!deleted && message.tips.length > 0 ? <TipsBadge messageId={message.id} totals={message.tips} /> : null}
        {!deleted && variant !== "pinned" ? (
          <ReactionBar
            reactions={message.reactions}
            canReact={viewer.canReact}
            onToggle={(emoji) => onToggleReaction?.(message, emoji)}
            pickerOpen={reactionPicker}
            onPickerOpenChange={setReactionPicker}
          />
        ) : null}
        {canMark ? (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setConfirmMark(true)}>
            Marcar como solución
          </Button>
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
              {canAddReaction ? (
                <DropdownMenuItem
                  onSelect={() => {
                    focusMoved.current = true;
                    setReactionPicker(true);
                  }}
                >
                  <SmilePlus aria-hidden />
                  Añadir reacción
                </DropdownMenuItem>
              ) : null}
              {canReply ? (
                <DropdownMenuItem
                  onSelect={() => {
                    focusMoved.current = true;
                    onOpenThread?.(message, triggerRef.current);
                  }}
                >
                  <MessageSquareReply aria-hidden />
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
                  <Quote aria-hidden />
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
                  <Pencil aria-hidden />
                  Editar
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden />
                  Borrar
                </DropdownMenuItem>
              ) : null}
              {canPin ? (
                <DropdownMenuItem onSelect={() => onPin?.(message, message.pinnedAt === null)}>
                  {message.pinnedAt === null ? <Pin aria-hidden /> : <PinOff aria-hidden />}
                  {message.pinnedAt === null ? "Fijar" : "Desfijar"}
                </DropdownMenuItem>
              ) : null}
              {canTip ? (
                <DropdownMenuItem onSelect={() => setTipping(true)}>
                  <Coins aria-hidden />
                  Dar propina
                </DropdownMenuItem>
              ) : null}
              {canReport ? (
                <DropdownMenuItem onSelect={() => setReporting(true)}>
                  <Flag aria-hidden />
                  Reportar
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {canTip && authorId && tipping ? (
        <TipDialog target={{ type: "message", messageId: message.id }} recipient={{ ...identity, id: authorId }} open={tipping} onOpenChange={setTipping} />
      ) : null}

      {canReport ? <ReportDialog messageId={message.id} open={reporting} onOpenChange={setReporting} /> : null}

      {canMark ? (
        <AlertDialog
          open={confirmMark}
          onOpenChange={(open) => {
            if (marking) return;
            setConfirmMark(open);
            if (!open) setMarkError(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Marcar esta respuesta como solución?</AlertDialogTitle>
              <AlertDialogDescription>
                No se puede deshacer ni cambiar por otra. Desde ahora tienes 7 días para pagarla; pasado ese plazo el bounty queda como impagado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {markError ? (
              <p role="alert" className="text-sm text-danger">
                {markError}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={marking}>Volver</AlertDialogCancel>
              <AlertDialogAction
                disabled={marking}
                onClick={(e) => {
                  // Keep the dialog open until the server answers, so an error can be shown in it.
                  e.preventDefault();
                  void mark();
                }}
              >
                Sí, marcar como solución
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

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
