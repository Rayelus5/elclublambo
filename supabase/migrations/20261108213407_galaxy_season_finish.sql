-- Galaxy Survivor M8c (GDD §13.1): a season's exclusive finish. «Fisura» (rift), season 1's, joins the finishes a galaxy
-- can carry; only a pull in its open season gives it (the server draws it on its own stream), so the deep scan's odds
-- stay as they are.

alter table galaxy.galaxies drop constraint galaxies_finish_check;
alter table galaxy.galaxies add constraint galaxies_finish_check check (finish in ('normal', 'holo', 'prismatic', 'braille', 'corrupt', 'rift'));
