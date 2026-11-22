-- Galaxy Survivor: «Encuestas y avisos» (migration *_galaxy_popups; plan 2026-11-22, part A): a promotion has no
-- questions nor reward and is published with its image; 90 days at most; a published campaign never changes, only ends
-- once or goes back to draft while nobody saw it; only drafts are deleted; one popup a day per account; an answer is one
-- value and never changes nor goes on its own.
begin;
select plan(15);

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000009c1', 'pgtap_popups', 'x');
insert into galaxy.popup_campaigns (id, kind, title, questions, starts_at, ends_at, state, published_at)
values
  ('00000000-0000-4000-8000-00000000c001', 'survey', 'Encuesta', '[{"type":"scale","id":"q1","prompt":"¿Nos recomiendas?","range":"0-10"}]', now() - interval '1 day', now() + interval '6 days', 'published', now() - interval '1 day'),
  ('00000000-0000-4000-8000-00000000c002', 'survey', 'Otra', '[{"type":"stars","id":"q1","prompt":"¿Qué tal?"}]', now() - interval '1 day', now() + interval '6 days', 'published', now() - interval '1 day'),
  ('00000000-0000-4000-8000-00000000c003', 'form', 'Borrador', '[]', now(), now() + interval '2 days', 'draft', null);

select throws_ok($$insert into galaxy.popup_campaigns (kind, title, questions, starts_at, ends_at) values ('promotion', 'Promo', '[{"type":"stars","id":"q1","prompt":"x"}]', now(), now() + interval '1 day')$$,
  '23514', null, 'a promotion has no questions');
select throws_ok($$insert into galaxy.popup_campaigns (kind, title, starts_at, ends_at, state, published_at) values ('promotion', 'Promo', now(), now() + interval '1 day', 'published', now())$$,
  '23514', null, 'a promotion is published with its image');
select throws_ok($$insert into galaxy.popup_campaigns (kind, title, link, starts_at, ends_at) values ('survey', 'Encuesta', '{"kind":"route","to":"/temporada","label":"Ver"}', now(), now() + interval '1 day')$$,
  '23514', null, 'only a promotion has a link');
select throws_ok($$insert into galaxy.popup_campaigns (kind, title, starts_at, ends_at) values ('form', 'Larga', now(), now() + interval '91 days')$$,
  '23514', null, '90 days at most');

select throws_ok($$update galaxy.popup_campaigns set title = 'Cambiada' where id = '00000000-0000-4000-8000-00000000c001'$$, 'P0001', 'popup_campaign_fixed', 'a published campaign never changes');
select throws_ok($$delete from galaxy.popup_campaigns where id = '00000000-0000-4000-8000-00000000c001'$$, 'P0001', 'popup_campaigns_keep_history', 'a published campaign stays');
select lives_ok($$update galaxy.popup_campaigns set state = 'draft', published_at = null, version = version + 1 where id = '00000000-0000-4000-8000-00000000c002'$$, 'back to draft while nobody saw it');
select lives_ok($$delete from galaxy.popup_campaigns where id = '00000000-0000-4000-8000-00000000c003'$$, 'a draft is deleted');

insert into galaxy.popup_views (campaign_id, account_id, shows, first_shown_at, last_shown_at, last_shown_day)
values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000009c1', 1, now(), now(), current_date);
select throws_ok($$update galaxy.popup_campaigns set state = 'draft', published_at = null where id = '00000000-0000-4000-8000-00000000c001'$$, 'P0001', 'popup_campaign_seen', 'once seen, it only ends');
update galaxy.popup_campaigns set state = 'published', published_at = now() where id = '00000000-0000-4000-8000-00000000c002';
select throws_ok($$insert into galaxy.popup_views (campaign_id, account_id, shows, first_shown_at, last_shown_at, last_shown_day)
  values ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-0000000009c1', 1, now(), now(), current_date)$$, '23505', null, 'one popup a day per account');

select lives_ok($$update galaxy.popup_campaigns set ended_at = now() where id = '00000000-0000-4000-8000-00000000c001'$$, 'a published campaign ends');
select throws_ok($$update galaxy.popup_campaigns set ended_at = now() + interval '1 hour' where id = '00000000-0000-4000-8000-00000000c001'$$, 'P0001', 'popup_campaign_fixed', 'it ends once');

insert into galaxy.popup_responses (campaign_id, account_id, op_key) values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000009c1', 'pgtap-popup-1');
select throws_ok($$insert into galaxy.popup_answers (campaign_id, account_id, question_id, score, text) values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000009c1', 'q1', 9, 'y')$$,
  '23514', null, 'an answer is one value');
insert into galaxy.popup_answers (campaign_id, account_id, question_id, score) values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000009c1', 'q1', 9);
select throws_ok($$update galaxy.popup_answers set score = 1 where campaign_id = '00000000-0000-4000-8000-00000000c001'$$, 'P0001', 'popup_rows_fixed', 'an answer never changes');
select throws_ok($$delete from galaxy.popup_responses where campaign_id = '00000000-0000-4000-8000-00000000c001'$$, 'P0001', 'popup_rows_keep_history', 'a response does not go on its own');

select * from finish();
rollback;
