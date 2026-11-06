-- The Brain on Supabase: Notes ideas map (links, colour and position for each note).
-- Run in Supabase: SQL Editor > New query > paste all of this > Run.
-- Safe to run again: it only adds the columns if they are missing.
--
-- links: semicolon-separated tokens, n:<note id>, p:<person id>, e:<plan id>
-- color: violet, cobalt, teal, green, yellow, orange, red or pink (empty = the topic's colour)
-- pos:   "x,y" on the map (empty = automatic layout)

alter table brain.notes
  add column if not exists links text,
  add column if not exists color text,
  add column if not exists pos   text;

notify pgrst, 'reload schema';
