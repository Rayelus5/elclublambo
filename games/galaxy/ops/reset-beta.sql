-- Galaxy Survivor: start the open beta from zero (2026-11-10). Deletes every player's (and every staff account's)
-- data, as if nobody had ever signed up, and keeps everything that is not a player's: the live config and its
-- history (galaxy.game_config_versions), the audit log, the title notices, the reserved usernames and the release notes.
--
-- Run it as `postgres` (the tables' owner) with the galaxy app STOPPED, after a full backup. It opens a transaction and
-- never ends it: append `COMMIT;` to apply it or `ROLLBACK;` to rehearse it (docs/DEPLOY_PRE.md, «Lanzamiento de la
-- beta abierta»):
--   { cat ops/reset-beta.sql; echo 'ROLLBACK;'; } | psql -v ON_ERROR_STOP=1 …
--
-- Why it is done this way:
-- - A row delete is refused by the append-only triggers (ledger, runs, gacha_pulls, operations, probe_tests,
--   run_inputs, season_adjustments) and blocked by NO ACTION keys on galaxies: every player table is emptied with one
--   TRUNCATE instead, which fires no row triggers. Only the ledger forbids a TRUNCATE: its guard is off for that
--   statement alone.
-- - The accounts stay as a DELETE (the config versions, the audit log and the notices point at them): their keys set
--   created_by / actor_id to null, an UPDATE those append-only tables refuse, so their guards are off for that
--   statement alone. Who did what stays in each audit row's actor_label.
-- - The profile banner (accounts.banner) points at a galaxy: its key would refuse the TRUNCATE of the galaxies, so it is
--   dropped for the reset and put back once the accounts are gone (2026-11-22). Every table that points at an emptied
--   table is emptied with it (apps/server/test/unit/reset-beta.test.ts checks the list against the migrations).
-- - Season records and their revisions stay (they are the calendar, like the config); a revision's author is cleared
--   with its guard off for that statement alone. Tournaments go with their entries, checks and money prizes.

begin;

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'galaxy') then
    raise exception 'Esta base no tiene el esquema galaxy';
  end if;
  -- Real money (the resource shop): once there is a purchase, this reset can never run again.
  if exists (select 1 from galaxy.shop_purchases) then
    raise exception 'Hay compras con dinero real en la tienda: este borrado ya no se puede usar';
  end if;
end $$;

select 'antes' as momento,
  (select count(*) from galaxy.accounts) as cuentas,
  (select count(*) from galaxy.runs) as incursiones,
  (select count(*) from galaxy.runs where finished_at is null) as sin_terminar,
  (select count(*) from galaxy.galaxies) as galaxias,
  (select count(*) from galaxy.game_config_versions) as versiones_config,
  (select count(*) from galaxy.admin_audit_log) as auditoria,
  (select count(*) from galaxy.title_notices) as avisos;

alter table galaxy.ledger disable trigger ledger_no_truncate;
alter table galaxy.accounts drop constraint accounts_banner_fkey;

truncate table
  galaxy.account_ips,
  galaxy.account_roles,
  galaxy.account_xp,
  galaxy.achievement_progress,
  galaxy.admin_totp,
  galaxy.antenna,
  galaxy.backdrops,
  galaxy.balances,
  galaxy.blocks,
  galaxy.catalog_claims,
  galaxy.chat_mentions,
  galaxy.chat_messages,
  galaxy.chat_mutes,
  galaxy.chat_report_reviews,
  galaxy.chat_reads,
  galaxy.chat_reports,
  galaxy.clan_event_progress,
  galaxy.clan_kicks,
  galaxy.clan_members,
  galaxy.clan_requests,
  galaxy.clans,
  galaxy.coin_holds,
  galaxy.coop_run_inputs,
  galaxy.coop_runs,
  galaxy.cosmetics,
  galaxy.deal_reversals,
  galaxy.event_leftovers,
  galaxy.exhibits,
  galaxy.friendships,
  galaxy.gacha_accounts,
  galaxy.gacha_pulls,
  galaxy.gacha_state,
  galaxy.galaxies,
  galaxy.hangars,
  galaxy.lab_nodes,
  galaxy.lab_season_nodes,
  galaxy.ledger,
  galaxy.loadouts,
  galaxy.login_challenges,
  galaxy.mailbox_messages,
  galaxy.mailbox_receipts,
  galaxy.market_listings,
  galaxy.market_offers,
  galaxy.mission_progress,
  galaxy.operations,
  galaxy.planetarium_visits,
  galaxy.player_reports,
  galaxy.probe_grants,
  galaxy.probe_levels,
  galaxy.probe_showcase,
  galaxy.probe_tests,
  galaxy.rate_limit_hits,
  galaxy.redshift,
  galaxy.referral_codes,
  galaxy.referral_rewards,
  galaxy.referrals,
  galaxy.refinery,
  galaxy.reset_codes,
  galaxy.run_days,
  galaxy.run_inputs,
  galaxy.runs,
  galaxy.season_adjustments,
  galaxy.season_archive,
  galaxy.season_purchases,
  galaxy.season_results,
  galaxy.season_route_claims,
  galaxy.sessions,
  galaxy.settings,
  galaxy.shop_alerts,
  galaxy.shop_blocks,
  galaxy.shop_stripe_events,
  galaxy.social_prefs,
  galaxy.station_rooms,
  galaxy.tournament_cash,
  galaxy.tournament_checks,
  galaxy.tournament_entries,
  galaxy.tournaments,
  galaxy.trade_alerts,
  galaxy.trade_events,
  galaxy.trade_items,
  galaxy.trade_post_items,
  galaxy.trade_posts,
  galaxy.trades,
  galaxy.tutorial
  restart identity;

alter table galaxy.ledger enable trigger ledger_no_truncate;

alter table galaxy.admin_audit_log disable trigger admin_audit_log_append_only;
alter table galaxy.game_config_versions disable trigger game_config_versions_append_only;
alter table galaxy.season_revisions disable trigger season_revisions_append_only;
delete from galaxy.accounts;
alter table galaxy.admin_audit_log enable trigger admin_audit_log_append_only;
alter table galaxy.game_config_versions enable trigger game_config_versions_append_only;
alter table galaxy.season_revisions enable trigger season_revisions_append_only;
alter table galaxy.accounts add constraint accounts_banner_fkey foreign key (banner) references galaxy.galaxies (id) on delete set null;

-- Every table but the kept ones is empty, and every guard is back on.
do $$
declare
  t text;
  n bigint;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'galaxy' and tablename not in ('game_config_versions', 'admin_audit_log', 'title_notices', 'reserved_usernames', 'release_notes')
  loop
    execute format('select count(*) from galaxy.%I', t) into n;
    if n <> 0 then
      raise exception 'Quedan % filas en galaxy.%', n, t;
    end if;
  end loop;
  if exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'galaxy' and not tg.tgisinternal and tg.tgenabled = 'D'
  ) then
    raise exception 'Hay un trigger de galaxy desactivado';
  end if;
end $$;

select 'despues' as momento,
  (select count(*) from galaxy.accounts) as cuentas,
  (select count(*) from galaxy.runs) as incursiones,
  (select count(*) from galaxy.galaxies) as galaxias,
  (select count(*) from galaxy.game_config_versions) as versiones_config,
  (select count(*) from galaxy.admin_audit_log) as auditoria,
  (select count(*) from galaxy.title_notices) as avisos;

-- No COMMIT here: the caller appends COMMIT; (apply) or ROLLBACK; (rehearse).
