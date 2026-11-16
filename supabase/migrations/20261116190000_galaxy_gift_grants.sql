-- Gifts of every kind (mail v2, 2026-11-16): season points a gift gives are recorded as the mail's.
--   season_adjustments.source  who added the points: an admin, a mission, an achievement or a gift by mail.

alter table galaxy.season_adjustments drop constraint season_adjustments_source_check;
alter table galaxy.season_adjustments add constraint season_adjustments_source_check check (source in ('admin', 'mission', 'achievement', 'mail'));
