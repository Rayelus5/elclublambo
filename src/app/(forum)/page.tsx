import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import { ActiveChannelsList, HomeSection } from "@/components/home/home-sections";
import { ContinueCards } from "@/components/home/continue-cards";
import { FeaturedPin } from "@/components/home/featured-pin";
import { HomeGreeting } from "@/components/home/home-greeting";
import { HomeSearch } from "@/components/home/home-search";
import { QuickTiles } from "@/components/home/quick-tiles";
import { MotionRoot } from "@/components/start/motion";
import {
  getActiveChannels,
  getHomeHighlights,
  getHomePins,
  getHomeUnreadChannels,
  getOpenBounties,
  getUnreadSummary,
  messageHref,
} from "@/lib/home/queries";
import { identityFromRow, MEMBER_IDENTITY_COLUMNS, memberName, type MemberIdentityRow } from "@/lib/members/name";
import { createServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type Client = Awaited<ReturnType<typeof createServerClient>>;

/** Pins shown on Inicio; one more is read to know whether the list is capped. */
const PIN_MAX = 10;

async function myName(supabase: Client): Promise<string> {
  const me = await supabase.rpc("current_member_id");
  if (me.error || typeof me.data !== "string") throw new Error("no member");
  const { data, error } = await supabase.from("members").select(MEMBER_IDENTITY_COLUMNS).eq("id", me.data).maybeSingle<MemberIdentityRow>();
  if (error || !data) throw new Error("no member row");
  return memberName(identityFromRow(data));
}

// Each block settles on its own: a failing read shows a short error in its place instead of blanking the page.
async function HomeContent() {
  const supabase = await createServerClient();
  const [name, highlights, summary, unreadChannels, firstBounty, pins, active] = await Promise.allSettled([
    myName(supabase),
    getHomeHighlights(supabase),
    getUnreadSummary(supabase),
    getHomeUnreadChannels(supabase, 20),
    getOpenBounties(supabase, 1),
    getHomePins(supabase, PIN_MAX + 1),
    getActiveChannels(supabase, 5),
  ]);

  const unread = unreadChannels.status === "fulfilled" ? unreadChannels.value : [];
  const bounty = firstBounty.status === "fulfilled" ? firstBounty.value[0] : undefined;
  const mentions = summary.status === "fulfilled" ? summary.value.mentions + summary.value.replies : 0;
  const showPin = pins.status === "rejected" || pins.value.length > 0;

  return (
    <MotionRoot>
      <div className="@container mx-auto flex w-full max-w-6xl flex-col gap-10 sm:gap-12">
        <div className="flex flex-col gap-6 sm:gap-8 sm:pt-4">
          <HomeGreeting name={name.status === "fulfilled" ? name.value : null} />
          <HomeSearch />
        </div>

        {/* failed highlights degrade only their tiles: Sin leer and Menciones still show */}
        <QuickTiles
          highlights={highlights.status === "fulfilled" ? highlights.value : null}
          mentions={mentions}
          unreadOrder={unread.map((c) => c.channelId)}
          bountyHref={bounty ? messageHref(bounty.channelId, bounty.messageId) : undefined}
        />

        <ContinueCards channels={unread} failed={unreadChannels.status === "rejected"} />

        <div className={cn("grid gap-10", showPin && "@4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @4xl:gap-8")}>
          <FeaturedPin pins={pins.status === "fulfilled" ? pins.value : []} failed={pins.status === "rejected"} max={PIN_MAX} />
          <HomeSection id="home-active" title="Actividad reciente" failed={active.status === "rejected"}>
            {active.status === "fulfilled" ? <ActiveChannelsList channels={active.value} /> : null}
          </HomeSection>
        </div>
      </div>
    </MotionRoot>
  );
}

export default function InicioPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <HomeContent />
    </Suspense>
  );
}
