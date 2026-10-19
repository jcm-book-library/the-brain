# The Brain: notes for Claude

**Read the house rules first:** [HOUSE-RULES.md](https://github.com/jcm-book-library/control-room/blob/main/HOUSE-RULES.md) in `control-room` (plain text: https://raw.githubusercontent.com/jcm-book-library/control-room/main/HOUSE-RULES.md). They cover Google Sheet safety, branches and pull requests into `main`, using cheaper models to save usage credits, and the build template. The notes below are this repo's own; where they are more specific, they win. The project charter is `project.json`.

## This repo
- `index.html` is the whole app: one page, "no build step", hosted on GitHub Pages.
- Data lives in a Google Sheet (tabs: Plan, Routine, Log, Goals, People, Lists, Notes, Links, Settings); "Keep the column order."
- "No personal data is stored in this repo."
- Tests: `NODE_PATH=$(npm root -g) node tools/test.js /tmp/shots` runs the page in headless Chromium against a fake Sheets API.
