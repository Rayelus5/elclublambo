"use client";

import { MotionRoot } from "@/components/start/motion";
import type { ToolKey } from "@/lib/admin/state";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { CheckerDemo } from "./checker-demo";
import { ClubTeaser } from "./club-teaser";
import { FinalCta } from "./final-cta";
import { GiveawayDemo } from "./giveaway-demo";
import { Hero } from "./hero";
import { MoreToolsTeaser } from "./more-tools-teaser";
import { Networks } from "./networks";
import { PayDemo } from "./pay-demo";
import { VouchTeaser } from "./vouch-teaser";

/**
 * The public landing (/ and /en): open tools first, the club as the reward. Header and footer come from the public
 * layout. Server HTML and reduced-motion visitors get the final, static page (see start/motion.tsx).
 *
 * `off` (A-R16): tools switched off in Administración. Their block and every link to them go; «More tools» goes only
 * when approvals, multisend and gas are all off (it links to the hub, not to them). No other fill is promoted.
 */
export function Landing({ lang, off }: { lang: Lang; off: ReadonlySet<ToolKey> }) {
  const dict = getDictionary(lang);
  const t = dict.landing;
  const on = (key: ToolKey) => !off.has(key);
  const pay = on("pay");
  const checker = on("checker");
  const moreTools = on("approvals") || on("multisend") || on("gas");
  return (
    <MotionRoot>
      <main className="flex-1 overflow-x-clip">
        <Hero lang={lang} t={t} off={off} />
        {on("giveaways") ? <GiveawayDemo t={t.demo} sample={t.sample} /> : null}
        {/* Pay and the checker share one row: less weight than the giveaway. */}
        {pay || checker ? (
          <div className="border-t border-border">
            <div className={`mx-auto grid w-full max-w-[1600px] ${pay && checker ? "lg:grid-cols-2" : ""}`}>
              {pay ? <PayDemo lang={lang} t={t} noCustody={dict.common.noCustody} /> : null}
              {checker ? <CheckerDemo lang={lang} t={t} /> : null}
            </div>
          </div>
        ) : null}
        {on("vouches") ? <VouchTeaser lang={lang} t={t} /> : null}
        {moreTools ? <MoreToolsTeaser lang={lang} t={t} /> : null}
        <Networks t={t.networks} />
        <ClubTeaser lang={lang} t={t.club} whatIs={t.whatIs} />
        <FinalCta lang={lang} t={t} off={off} />
      </main>
    </MotionRoot>
  );
}
