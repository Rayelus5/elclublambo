"use client";

import { MotionRoot } from "@/components/start/motion";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { CheckerDemo } from "./checker-demo";
import { ClubTeaser } from "./club-teaser";
import { FinalCta } from "./final-cta";
import { GiveawayDemo } from "./giveaway-demo";
import { Hero } from "./hero";
import { Networks } from "./networks";
import { PayDemo } from "./pay-demo";
import { VouchTeaser } from "./vouch-teaser";

/**
 * The public landing (/ and /en): open tools first, the club as the reward. Header and footer come from the public
 * layout. Server HTML and reduced-motion visitors get the final, static page (see start/motion.tsx).
 */
export function Landing({ lang }: { lang: Lang }) {
  const dict = getDictionary(lang);
  const t = dict.landing;
  return (
    <MotionRoot>
      <main className="flex-1 overflow-x-clip">
        <Hero lang={lang} t={t} />
        <GiveawayDemo t={t.demo} sample={t.sample} />
        {/* Pay and the checker share one row: less weight than the giveaway. */}
        <div className="border-t border-border">
          <div className="mx-auto grid w-full max-w-[1600px] lg:grid-cols-2">
            <PayDemo lang={lang} t={t} noCustody={dict.common.noCustody} />
            <CheckerDemo lang={lang} t={t} />
          </div>
        </div>
        <VouchTeaser lang={lang} t={t} />
        <Networks t={t.networks} />
        <ClubTeaser lang={lang} t={t.club} whatIs={t.whatIs} />
        <FinalCta lang={lang} t={t} />
      </main>
    </MotionRoot>
  );
}
