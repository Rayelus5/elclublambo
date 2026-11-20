-- The scanner's finds (2026-11-17, the owner: «Últimos hallazgos» and «Escaparate de premios»): the legendaries and
-- mythics found lately by anyone, and each event scanner's last featured galaxy. Partial indexes, small: only the rare
-- pulls are in them (gacha_pulls already has (account_id, created_at desc) for «my best scans»).
create index if not exists gacha_pulls_top_recent on galaxy.gacha_pulls (created_at desc) where tier >= 4;
create index if not exists gacha_pulls_featured_recent on galaxy.gacha_pulls (banner, created_at desc) where featured;
