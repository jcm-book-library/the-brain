# The Brain

A week planner and daily log that reads and writes a Google Sheet. One page (`index.html`), no build step, hosted on GitHub Pages.

## How it works
- You sign in with Google in the browser. The page then reads and writes the sheet directly through the Google Sheets API.
- No personal data is stored in this repo. Everything loads from the sheet after sign-in.
- The sheet link and OAuth Client ID are saved in your browser (Settings). The Client ID is picked up from the book library automatically when both run on `jcm-book-library.github.io`.
- Weather comes from Open-Meteo (no key needed).
- The **Paper** tab shows [The Overnight Sentinel](https://jcm-book-library.github.io/daily-paper/) inside the page. To point it somewhere else, add a `paper_url` row to the sheet's Settings tab.

## Supabase pilot
The page can also use a Supabase database (project `jcm-apps`, schema `brain`) instead of the sheet. The sheet is the default until switch-over. In **Settings**: *Where your data lives* picks the source per device, *Email me a sign-in link* (or *Sign in with Google*, once set up) signs in to Supabase and stays signed in, and *Copy Sheet → Supabase* copies everything across (it only reads the sheet) and checks the copy row by row.

- Setup steps, click by click: [`supabase/SETUP.md`](supabase/SETUP.md)
- Tables and access rules: [`supabase/01-schema.sql`](supabase/01-schema.sql). Row Level Security lets only the signed-in owner read or write their rows; signed-out visitors get nothing. The publishable key in `index.html` is meant to be public.
- Each table mirrors a sheet tab, plus `row_id` (the app's handle on a row), `user_id` and `updated_at`.

## Sheet tabs
| Tab | Columns |
|---|---|
| Plan | ID, Date, End, Time, Title, Category, Type, Done, Countdown, Notes |
| Routine | Day, Category, Time, Title, Active |
| Log | Date, Steps, KM, Active mins, Pages, Max °C, Min °C, Mood, Note |
| Goals | Year, Month, Steps, KM, Active mins, Pages |
| People | ID, Name, Birthday, Last seen, To see, See every (days), Notes, Groups, Links, Next catch-up, Time, Catch-up plan, Plan ID |
| Lists | ID, List, Item, Status, Added, Notes |
| Notes | ID, Date, Topic, Note |
| Links | Name, Category, URL, Pin, Order, Notes |
| Settings | Key, Value, Notes |

Birthdays saved without a year are stored as 1904 (for example 1904-10-17); the page hides that year. The sheet's Birthday column shows day and month only.

People: **Groups** is a comma-separated list (for example `IV, HFP`). **Links** connects people as `ID:Relationship`, separated by semicolons (for example `p008:Partner; p016:Parent of`). A link only needs to be on one person; the other side shows it in reverse. A planned catch-up also creates an item on the Plan tab; **Plan ID** keeps the two in step, so change or remove catch-ups from the People tab on the page.

Keep the column order. Rows can be added, edited or sorted by hand in the sheet; the page finds rows by ID.

## Testing
`tools/test.js` runs the page in headless Chromium against a fake, in-memory Sheets API:

```
NODE_PATH=$(npm root -g) node tools/test.js /tmp/shots
NODE_PATH=$(npm root -g) node tools/test-supabase.js /tmp/shots
```
