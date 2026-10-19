# The Brain: notes for Claude

**Read the house rules first:** [HOUSE-RULES.md](https://github.com/jcm-book-library/control-room/blob/main/HOUSE-RULES.md) in `control-room`. The notes below are this repo's own; where they are more specific, they win.

## This repo

- One file, `index.html`, no build step. Live: https://jcm-book-library.github.io/the-brain/ (from `main`).
- Data: the Google Sheet (tabs in README) or, in the Supabase pilot, the `brain` schema of the `jcm-apps` project. The data layer is `refresh` / `addRows` / `updateRow` / `deleteRow`; each branches on `useSb()`. Screens never call either backend directly.
- Tests: `tools/test.js` (Sheets mode) and `tools/test-supabase.js` (Supabase mode), both against fakes. Run both before every push.

## Supabase pilot

- Pilot runs side by side with the Sheet until the owner says "switch over". Until then the Sheet is the default and must stay working; the app's copy only reads it.
- Schema changes go in a new numbered file in `supabase/` that the owner pastes into the SQL Editor. Every table keeps RLS on with the "own rows" policy and no grants to `anon`.
- Never ask for, store or use the `service_role` key or the database password. Claude can't reach the project from the cloud sandbox (proxy blocks it), so the owner runs SQL and the copy in their browser.
