-- Galaxy Survivor (the owner, 2026-11-13): «Apuntar con el ratón» on for everyone who already plays. Every saved
-- settings document gets manualAim true (a player can turn it off again afterwards, as always). Accounts with no row
-- yet take it from their browser, whose default is now on.

update galaxy.settings
   set data = jsonb_set(data, '{manualAim}', 'true'::jsonb, true),
       updated_at = now()
 where (data ->> 'manualAim') is distinct from 'true';
