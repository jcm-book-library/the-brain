// Headless test: serves index.html with a fake Sheets API in memory.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const OUT = process.argv[2] || __dirname;

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(); const T = iso(today);
const add = n => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const serial = s => { const [y, m, d] = s.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5); };

// sheets: arrays of rows (row 1 = header)
const db = {
  Plan: [['ID', 'Date', 'End', 'Time', 'Title', 'Category', 'Type', 'Done', 'Countdown', 'Notes'],
    ['e1', serial(T), '', '07:00', 'Strength & Conditioning', 'Fitness', 'Gym', false, false, ''],
    ['e2', serial(T), '', '', 'Office', 'Work', 'Routine', true, false, ''],
    ['e3', serial(add(1)), '', '15:00', 'Finance Coaching', 'Work', 'Work', false, false, ''],
    ['e4', serial(add(2)), '', '', 'Dinner with friends', 'Social', 'Catch up', false, true, ''],
    ['e5', serial(add(2)), '', '', 'Matchday', 'Sport', 'The Championship', false, false, ''],
    ['e6', serial(add(3)), serial(add(5)), '', 'Housesitting', 'Home', 'Housesitting', false, false, ''],
    ['e7', serial(add(12)), '', '', 'Opera night', 'Social', 'Event', false, false, ''],
    ['e8', serial(add(40)), serial(add(45)), '', 'Trip away', 'Social', 'Travel', false, false, ''],
    ['', '', '', '', '', '', '', false, false, ''], ['', '', '', '', '', '', '', false, false, '']],
  Routine: [['Day', 'Category', 'Time', 'Title', 'Active'], ['Mon', 'Fitness', '', '12000 steps', true], ['Tue', 'Fitness', '0700', 'Kickboxing', true], ['Wed', 'Work', '', 'Office', true], ['Sat', 'Fitness', '', 'Walk', false]],
  Log: [['Date', 'Steps', 'KM', 'Active mins', 'Pages', 'Max', 'Min', 'Mood', 'Note'],
    [serial(add(-3)), 10000, 7.2, 60, 100, 18, 9, 'G', ''], [serial(add(-2)), 4000, 2.9, 30, 120, 15, 8, 'F', 'Rain'], [serial(add(-1)), 14000, 10.1, 120, 90, 20, 10, 'G', '']],
  Goals: [['Year', 'Month', 'Steps', 'KM', 'Active', 'Pages'], [today.getFullYear(), today.getMonth() + 1, 11000, 8, 90, 100]],
  People: [['ID', 'Name', 'Birthday', 'Last seen', 'To see', 'Every', 'Notes', 'Groups', 'Links', 'Next', 'Time', 'Plan', 'PlanID'], ['p1', 'Sam', serial(`1990-${pad(new Date(add(5)).getMonth() + 1)}-${pad(new Date(add(5)).getDate())}`), '', true, '', 'Ask about the new job', 'IV', '', '', '', '', ''], ['p2', 'Alex', '', serial(add(-100)), false, 60, '', 'HFP, IV', 'p3:Parent of', '', '', '', ''], ['p3', 'Jo', '', '', false, '', '', 'HFP', '', '', '', '', ''], ['', '', '', '', false, '', '', '', '', '', '', '', '']],
  Lists: [['ID', 'List', 'Item', 'Status', 'Added', 'Notes'], ['l1', 'Reading', 'A Book', 'Current', serial(T), ''], ['l2', 'To book', 'Dentist', 'Open', serial(add(-10)), '']],
  Notes: [['ID', 'Date', 'Topic', 'Note', 'Links', 'Color', 'Pos'], ['n1', serial(add(-5)), 'Ideas', 'Line one\nLine two', '', '', '']],
  Links: [['Name', 'Category', 'URL', 'Pin', 'Order', 'Notes'], ['Books', 'Entertainment', 'https://example.com/books', true, 1, ''], ['NRL', 'Sport', 'https://example.com/nrl', true, 2, ''], ['Other', 'Sport', '', false, '', '']],
  Settings: [['Key', 'Value', 'Notes'], ['payday_anchor', serial('2026-01-09'), ''], ['payday_every', 14, ''], ['birthday_window', 60, '']]
};
const sids = { Plan: 0, Routine: 1, Log: 2, Goals: 3, People: 4, Lists: 5, Notes: 6, Links: 7, Settings: 8 };
const rowCount = Object.fromEntries(Object.keys(db).map(k => [k, 1000]));
const calls = [];

function parseA1(r) { // "Plan!A5:J5" or "Plan!A2:J" or "Plan!A7"
  const [tab, rng] = r.split('!'); const [a, b] = rng.split(':');
  const p = s => { const m = s.match(/^([A-Z])(\d*)$/); return { c: m[1].charCodeAt(0) - 65, r: m[2] ? Number(m[2]) : null }; };
  const A = p(a), B = b ? p(b) : A; return { tab, r0: A.r, c0: A.c, r1: B.r, c1: B.c };
}
function userEntered(v) { if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return serial(v); if (typeof v === 'string' && v.startsWith("'")) return v.slice(1); return v; }

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' in {} ? undefined : undefined });
  const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://brain.test/', r => r.fulfill({ contentType: 'text/html', body: HTML }));
  await page.route('https://jcm-book-library.github.io/daily-paper/', r => r.fulfill({ contentType: 'text/html', body: '<h1 style="font-family:serif">The Overnight Sentinel (stub)</h1><section class="watch"><div class="feed watch-grid" data-ed="Morning" hidden><div class="watch-item"><a class="story" href="https://example.com/old"><span class="kicker"><span class="src">old</span></span><h3>Hidden edition story</h3></a></div></div><div class="feed watch-grid" data-ed="Afternoon"><div class="watch-item"><a class="story" href="https://example.com/a"><span class="kicker"><span class="src">3 outlets</span></span><h3>First top story</h3></a></div><div class="watch-item"><a class="story" href="https://example.com/b"><span class="kicker"><span class="src">ABC top story</span></span><h3>Second top story</h3></a></div><div class="watch-item"><a class="story" href="javascript:alert(1)"><span class="kicker"><span class="src">2 outlets</span></span><h3>Third top story</h3></a></div><div class="watch-item"><a class="story" href="https://example.com/d"><h3>Fourth is not shown</h3></a></div></div></section>' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: '' }));
  await page.route(/accounts\.google\.com/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/api\.open-meteo\.com/, r => { const time = [], mx = [], mn = [], rn = [], wc = []; for (let i = -7; i < 14; i++) { time.push(add(i)); mx.push(18 + (i % 5)); mn.push(9); rn.push(20 + i); wc.push(i % 3 ? 3 : 61); }
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ daily: { time, temperature_2m_max: mx, temperature_2m_min: mn, precipitation_probability_max: rn, weathercode: wc } }) }); });
  await page.route(/sheets\.googleapis\.com/, async r => {
    const u = new URL(r.request().url()), method = r.request().method(), p = decodeURIComponent(u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''));
    calls.push(method + ' ' + p);
    const json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '' ) return json({ sheets: Object.keys(db).map(t => ({ properties: { sheetId: sids[t], title: t, gridProperties: { rowCount: rowCount[t] } } })) });
    if (p === '/values:batchGet') { const ranges = u.searchParams.getAll('ranges');
      return json({ valueRanges: ranges.map(rg => { const a = parseA1(rg); const rows = db[a.tab].slice(a.r0 - 1).map(row => row.slice(a.c0, a.c1 + 1)); return { range: rg, values: rows }; }) }); }
    if (p.startsWith('/values/')) { const a = parseA1(p.slice(8));
      if (method === 'GET') { const row = db[a.tab][a.r0 - 1] || []; return json({ values: [[row[a.c0] ?? '']] }); }
      if (method === 'PUT') { const vals = JSON.parse(r.request().postData()).values;
        vals.forEach((rv, i) => { const ri = a.r0 - 1 + i; while (db[a.tab].length <= ri) db[a.tab].push([]); rv.forEach((v, j) => { db[a.tab][ri][a.c0 + j] = userEntered(v); }); });
        return json({ updatedRows: vals.length }); } }
    if (p === ':batchUpdate') { const reqs = JSON.parse(r.request().postData()).requests;
      for (const q of reqs) { if (q.deleteDimension) { const t = Object.keys(sids).find(k => sids[k] === q.deleteDimension.range.sheetId); db[t].splice(q.deleteDimension.range.startIndex, 1); }
        if (q.appendDimension) { const t = Object.keys(sids).find(k => sids[k] === q.appendDimension.sheetId); rowCount[t] += q.appendDimension.length; } }
      return json({ replies: [] }); }
    return r.fulfill({ status: 404, body: '{}' });
  });
  await page.addInitScript(() => { localStorage.setItem('jm-google-token', JSON.stringify({ t: 'x', exp: Date.now() + 3600e3 })); localStorage.setItem('brain_config', JSON.stringify({ clientId: 'abc.apps.googleusercontent.com', sheetId: 'TESTSHEET1234567890abc' })); });
  await page.goto('https://brain.test/');
  await page.waitForSelector('#status[data-state=live]', { timeout: 8000 });
  await page.waitForTimeout(400);
  const log = [];
  const check = (name, ok, d) => log.push((ok ? 'PASS ' : 'FAIL ') + name + (!ok && d !== undefined ? ' ' + JSON.stringify(d) : ''));

  // home: the default tab, rows in the agreed order
  await page.screenshot({ path: path.join(OUT, 'shot-home.png'), fullPage: true });
  check('home is the default tab', await page.isVisible('#v-home') && !(await page.isVisible('#v-upcoming')));
  check('tabs in the agreed order', JSON.stringify(await page.locator('.tabs .tab').allInnerTexts()) === JSON.stringify(['Home', 'Upcoming', 'Paper', 'Fitness', 'Family & Friends', 'Notes', 'Setup']));
  const box = id => page.evaluate(i => { const r = document.getElementById(i).getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height }; }, id);
  { const ys = []; for (const id of ['homeToday', 'addBox', 'homeNext', 'chips', 'homeNews', 'homeStats']) ys.push((await box(id)).y);
    check('home rows run: today, add, next 6 days, countdowns, headlines/weather, steps and reading', ys.every((y, i) => i === 0 || y > ys[i - 1]), ys); }
  { const A = await box('homeNews'), B = await box('homeWx');
    check('home: headlines and weather are a matched pair (same width, height and row)', Math.abs(A.w - B.w) < 1 && Math.abs(A.h - B.h) < 1 && Math.abs(A.y - B.y) < 1 && B.x > A.x, [A, B]); }
  { const r = await page.evaluate(() => [...document.querySelectorAll('[data-addmode]')].map(b => { const q = b.getBoundingClientRect(); return [q.width, q.height, q.y]; }));
    check('home: the two add buttons match', r.length === 2 && Math.abs(r[0][0] - r[1][0]) < 1 && Math.abs(r[0][1] - r[1][1]) < 1 && Math.abs(r[0][2] - r[1][2]) < 1, r);
    check('home: the add box starts closed', await page.locator('#addHome').isHidden()); }
  { const w = await page.evaluate(() => ['chips', 'homeToday', 'addBox', 'homeNext', 'homeStats'].map(i => document.getElementById(i).getBoundingClientRect().width));
    check('home: today, add, next 6 days, countdowns and stats run the full width', w.every(x => Math.abs(x - w[0]) < 1), w);
    const cw = await page.evaluate(() => [...document.querySelectorAll('#chips .cd')].map(c => Math.round(c.getBoundingClientRect().width)));
    check('home: countdown cells are all the same width', cw.length >= 2 && new Set(cw).size === 1, cw); }
  check('countdowns: no payday, at most four', await page.locator('.cd.pay').count() === 0 && !/Payday/.test(await page.locator('#chips').innerText()) && await page.locator('#chips .cd').count() <= 4);
  check('ticked countdown shown', (await page.locator('#chips').innerText()).includes('Dinner with friends'));
  check('pinned links', await page.locator('#links a').count() === 2);
  { const rows = await page.locator('#homeNews .news li a').evaluateAll(a => a.map(x => [x.querySelector('.hl').textContent, x.getAttribute('href') || '']));
    check('home: top 3 headlines from the paper (current edition only)', rows.length === 3 && rows[0][0] === 'First top story' && rows[1][0] === 'Second top story' && rows[2][0] === 'Third top story' && !(await page.locator('#homeNews').innerText()).includes('Hidden edition'), rows);
    check('home: headline links open the story, and unsafe links are dropped', rows[0][1] === 'https://example.com/a' && rows[2][1] === ''); }
  check('home: weather shows today and the next three days', /°/.test(await page.locator('#homeWx .wxbig').innerText()) && await page.locator('#homeWx .wx3 > div').count() === 3);
  { const ym = T.slice(0, 7), rows = db.Log.slice(1).filter(r => r[0] && (() => { const d = new Date(Date.UTC(1899, 11, 30) + r[0] * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` === ym; })());
    const avg = k => { const v = rows.map(r => r[k]).filter(x => x != null && x !== ''); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length).toLocaleString('en-AU') : '–'; };
    check('home: average steps (' + avg(1) + ') and average pages (' + avg(4) + ')', (await page.locator('#homeStats [data-stat=steps] .big').innerText()).startsWith(avg(1)) && (await page.locator('#homeStats [data-stat=pages] .big').innerText()).startsWith(avg(4)));
    check('home: steps and reading share one box, each bar says above or under goal', await page.locator('#homeStats .stathalf').count() === 2 && /(Above|Under) goal|Nothing logged|No goal/.test(await page.locator('#homeStats').innerText())); }
  check('home: today shows schedule and to-do', /Strength & Conditioning/.test(await page.locator('#homeToday').innerText()) && /Office/.test(await page.locator('#homeToday').innerText()));
  // next 6 days: accordion, one open at a time
  check('home: six day rows, all closed to start', await page.locator('#nextBody .acc').count() === 6 && await page.locator('#nextBody .acc[data-open=true]').count() === 0);
  { const hd = await page.locator('#nextBody .acc-h').allInnerTexts();
    check('home: each row is the day plus its task count', /2 tasks/.test(hd[1]) && /1 task\b/.test(hd[0]) && new RegExp(new Date(add(1) + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long' })).test(hd[0]), hd); }
  check('home: multi-day item counts up across the days', await page.evaluate(() => { const t = document.getElementById('nextBody').textContent; return /Day 1 of 3/.test(t) && /Day 2 of 3/.test(t) && /Day 3 of 3/.test(t); }));
  await page.click(`[data-acc="${add(2)}"]`); await page.waitForTimeout(80);
  check('home: opening a day shows its tasks', await page.isVisible(`#acc-${add(2)}`) && (await page.locator(`#acc-${add(2)}`).innerText()).includes('Matchday'));
  await page.click(`[data-acc="${add(1)}"]`); await page.waitForTimeout(80);
  check('home: only one day is open at a time', await page.locator('#nextBody .acc[data-open=true]').count() === 1 && !(await page.isVisible(`#acc-${add(2)}`)) && await page.isVisible(`#acc-${add(1)}`));
  await page.screenshot({ path: path.join(OUT, 'shot-home-open.png'), fullPage: true });

  // tick an item
  await page.locator('#homeToday [data-tick="e1"]').check(); await page.waitForSelector('#status[data-state=live]');
  check('tick saved to sheet', db.Plan[1][7] === true);

  // quick add
  await page.click('[data-addmode=date]'); check('add to planner opens the box', await page.isVisible('#addHome') && (await page.getAttribute('[data-addmode=date]', 'aria-expanded')) === 'true');
  await page.fill('#ahText', 'Call Mum #social 7:30pm'); await page.click('#addHome button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  const added = db.Plan.find(r => r[4] === 'Call Mum');
  check('quick add wrote row after last item (row 10)', db.Plan.indexOf(added) === 9 && added[3] === '19:30' && added[5] === 'Social' && added[1] === serial(T));

  // edit via dialog
  await page.click('#homeToday [data-edit="e2"]'); await page.fill('#fTitle', 'WFH'); await page.click('#itemForm button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  check('edit saved', db.Plan[2][4] === 'WFH');

  // delete
  if (!(await page.isVisible(`#acc-${add(1)}`))) await page.click(`[data-acc="${add(1)}"]`);
  await page.click('#nextBody [data-edit="e3"]'); await page.click('#itemDel'); await page.waitForSelector('#status[data-state=live]');
  check('delete removed row', !db.Plan.some(r => r[0] === 'e3'));

  // plan my week
  const before = db.Plan.length;
  await page.click('#planBtn'); await page.waitForSelector('#planDlg[open]');
  const n = await page.locator('#planPreview li').count();
  await page.click('#planGo'); await page.waitForSelector('#status[data-state=live]');
  check('plan my week added routine (inactive skipped)', n === 3 && db.Plan.filter(r => r[6] === 'Routine').length >= 3);
  await page.click('#planBtn'); await page.waitForSelector('#planDlg[open]');
  check('plan my week is idempotent', await page.locator('#planPreview li').count() === 0);
  await page.click('#planDlg [data-close]');

  // the event star: a trailing ★ on Type marks an event; multi-day items always count
  await page.click('#homeToday [data-star="e1"]'); await page.waitForSelector('#status[data-state=live]');
  check('star: marks the item as an event (Type keeps its text, gains a ★)', db.Plan[1][6] === 'Gym ★', db.Plan[1][6]);
  check('star: shown pressed, and the type reads as before', (await page.getAttribute('#homeToday [data-star="e1"]', 'aria-pressed')) === 'true' && (await page.locator('#homeToday').innerText()).includes('Gym') && !(await page.locator('#homeToday .ty').first().innerText()).includes('★'));
  check('star: multi-day items always show, and the star is locked on', await page.evaluate(() => { const b = document.querySelector('#nextBody [data-star="e6"]'); return b && b.hasAttribute('data-auto') && b.getAttribute('aria-pressed') === 'true'; }));
  await page.click('#homeToday [data-edit="e2"]'); await page.waitForSelector('#itemDlg[open]');
  check('item pop-up has the event tick, off for a plain item', (await page.isChecked('#fEvent')) === false);
  await page.check('#fEvent'); await page.click('#itemForm button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  check('pop-up event tick saves the star', db.Plan[2][6] === 'Routine ★' || db.Plan[2][6] === '★', db.Plan[2][6]);
  await page.click('#homeToday [data-edit="e2"]'); await page.uncheck('#fEvent'); await page.click('#itemForm button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  check('pop-up event tick clears the star', !String(db.Plan[2][6] || '').includes('★'), db.Plan[2][6]);

  // upcoming: month calendar of events, the selected day, and events coming up
  await page.click('.tab[data-tab=upcoming]'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'shot-upcoming.png'), fullPage: true });
  check('upcoming: one month, six rows of seven', await page.locator('#calPanel .mc').count() === 42 && await page.locator('#calPanel .mh').count() === 7);
  { const w = await page.evaluate(() => [...document.querySelectorAll('#calPanel .mc')].map(c => Math.round(c.getBoundingClientRect().width))), pw = await page.evaluate(() => document.getElementById('calPanel').getBoundingClientRect().width);
    check('upcoming: every day cell the same width, calendar full width', new Set(w).size === 1 && w[0] * 7 > pw * 0.8, [w[0], pw]); }
  check('upcoming: starred item shows on the calendar, plain tasks do not', await page.evaluate(d => { const c = document.querySelector(`#calPanel [data-calday="${d}"]`).textContent; return /Strength/.test(c) && !/Call Mum/.test(c); }, T));
  check('upcoming: selected day starts on today and lists every item', /today/i.test(await page.locator('#dayPanel').innerText()) && (await page.locator('#dayPanel').innerText()).includes('Call Mum') && (await page.locator('#dayPanel').innerText()).includes('Strength'));
  await page.click(`#calPanel [data-calday="${add(2)}"]`); await page.waitForTimeout(100);
  check('upcoming: clicking a day lists its other tasks (not on the calendar)', (await page.locator('#dayPanel').innerText()).includes('Matchday') && !(await page.locator(`#calPanel [data-calday="${add(2)}"]`).innerText()).includes('Matchday'));
  { const ev = await page.locator('#evPanel').innerText();
    check('upcoming: events list has birthdays, paydays and multi-day items, not plain tasks', /Sam's birthday/.test(ev) && /Payday/.test(ev) && /Housesitting/.test(ev) && !/Matchday/.test(ev) && !/Opera night/.test(ev)); }
  await page.click('#evPanel [data-efilter="Home"]'); await page.waitForTimeout(80);
  check('upcoming: category filter narrows the events list', (await page.locator('#evPanel .uprow').count()) >= 1 && !(await page.locator('#evPanel').innerText()).includes('Payday'));
  await page.click('#evPanel [data-efilter=""]');
  await page.click('#dayPanel [data-add]'); await page.waitForSelector('#itemDlg[open]');
  check('upcoming: add to the selected day opens the pop-up for that date', (await page.inputValue('#fDate')) === add(2)); await page.click('#itemDlg [data-close]');
  { const lab = await page.locator('#calPanel h2').innerText(); await page.click('[data-calnav="1"]'); await page.waitForTimeout(80);
    const lab2 = await page.locator('#calPanel h2').innerText(); await page.click('[data-calnav="0"]'); await page.waitForTimeout(80);
    check('upcoming: month arrows move and Today comes back', lab !== lab2 && (await page.locator('#calPanel h2').innerText()) === lab && await page.locator('#calPanel .mc').count() === 42, [lab, lab2]); }
  { const xs = []; for (let i = 0; i < 6; i++) { xs.push(Math.round((await page.locator('[data-calnav="1"]').boundingBox()).x)); await page.click('[data-calnav="1"]'); await page.waitForTimeout(40); }
    check('upcoming: month arrow stays put (' + [...new Set(xs)].join(',') + ')', new Set(xs).size === 1); await page.click('[data-calnav="0"]'); }
  const gotoDay = async d => { if (!(await page.locator(`#calPanel [data-calday="${d}"]`).count())) await page.click('[data-calnav="1"]'); await page.click(`#calPanel [data-calday="${d}"]`); await page.waitForTimeout(100); };
  await gotoDay(add(12));
  await page.click('#dayPanel [data-star="e7"]'); await page.waitForSelector('#status[data-state=live]');
  check('upcoming: starring from the day panel adds it to the events list', db.Plan.find(r => r[0] === 'e7')[6] === 'Event ★' && (await page.locator('#evPanel').innerText()).includes('Opera night'));
  await page.screenshot({ path: path.join(OUT, 'shot-upcoming2.png'), fullPage: true });

  // to book: status dropdown on the Notes tab
  await page.click('.tab[data-tab=notes]'); await page.waitForTimeout(150);
  await page.selectOption('[data-status="l2"]', 'Done'); await page.waitForSelector('#status[data-state=live]');
  check('to-book set to Done', db.Lists.find(r => r[0] === 'l2')[3] === 'Done');

  await page.click('.tab[data-tab=paper]'); await page.waitForTimeout(400);
  check('paper tab embeds the paper', (await page.locator('#paperFrame').getAttribute('src')) === 'https://jcm-book-library.github.io/daily-paper/' && (await page.frameLocator('#paperFrame').locator('h1').innerText()).includes('Sentinel'));
  await page.screenshot({ path: path.join(OUT, 'shot-paper.png') });

  // fitness tab: backdate a log
  await page.click('.tab[data-tab=fitness]'); await page.waitForTimeout(200);
  { const ys = []; for (const id of ['monthPanel', 'logPanel']) ys.push((await box(id)).y);
    check('fitness: monthly progress, then log, then year to date, then the two coming-later cards', ys[0] < ys[1] && (await page.locator('#v-fitness .later-card').count()) === 2 && /Year to date/.test(await page.locator('#v-fitness').innerText()) && /monthly progress/i.test(await page.locator('#monthPanel').innerText())); }
  { const a = await box('monthPanel'), b = await box('logPanel'), soon = await page.evaluate(() => [...document.querySelectorAll('#v-fitness .later-card')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)]; }));
    check('fitness: panels run the full width; the two future cards match', Math.abs(a.w - b.w) < 1 && soon[0][0] === soon[1][0] && soon[0][1] === soon[1][1] && soon[0][2] === soon[1][2], soon); }
  const missingBtns = await page.locator('[data-logday]').count();
  check('missing days offered', missingBtns >= 1);
  await page.fill('#logDate', add(-5)); await page.dispatchEvent('#logDate', 'change'); await page.waitForTimeout(100);
  await page.fill('#lSteps', '9876'); await page.fill('#lKm', '7.1'); await page.click('.mood[data-m=G]'); await page.fill('#lNote', 'backdated');
  await page.click('#logForm button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  const lrow = db.Log.find(r => r[0] === serial(add(-5)));
  check('backdated log saved with mood + weather prefill', !!lrow && lrow[1] === 9876 && lrow[7] === 'G' && lrow[8] === 'backdated' && lrow[5] != null && lrow[5] !== '');
  await page.fill('#logDate', add(-1)); await page.dispatchEvent('#logDate', 'change'); await page.waitForTimeout(100);
  check('existing day loads its saved values', (await page.inputValue('#lSteps')) === '14000');

  // this month panel
  check('monthly progress shows totals', (await page.locator('#monthPanel .tile').count()) === 6 && (await page.locator('#monthPanel').innerText()).includes('so far'));
  { // catch-up figure: (goal * (logged + h) - total) / h, h = next 5 days (or fewer left in month)
    const ym = T.slice(0, 7), rows = db.Log.slice(1).filter(r => r[0] && (() => { const d = new Date(Date.UTC(1899, 11, 30) + r[0] * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` === ym; })() && r[1] != null && r[1] !== '');
    const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const logged = new Set(rows.map(r => r[0])); const fromDay = logged.has(serial(T)) ? today.getDate() + 1 : today.getDate();
    const h = Math.min(5, dim - fromDay + 1), tot = rows.reduce((a, r) => a + r[1], 0);
    const need = Math.ceil((11000 * (rows.length + h) - tot) / h);
    const txt = await page.locator('#monthPanel .tile').first().innerText();
    check('steps catch-up figure (' + need.toLocaleString('en-AU') + ' over ' + h + ' days)', h > 0 ? txt.includes(need.toLocaleString('en-AU')) : !/catch up/i.test(txt));
  }
  const early = today.getDate() <= 3; // the sample log days fall in last month during the first days of a month
  if (early) { await page.click('[data-month="-1"]'); await page.waitForTimeout(100); }
  const cellsWithSteps = await page.locator('#monthPanel .v[data-g]').count();
  check('day grid colours days against goal', early ? (await page.locator('#monthPanel .v[data-logday]').count()) > 0 : cellsWithSteps >= 3); // goals in the sample data cover this month only
  await page.locator('#monthPanel .v[data-logday]').first().click(); await page.waitForTimeout(100);
  check('clicking a day opens it in the log', (await page.inputValue('#logDate')).endsWith('-01'));
  await page.click('[data-month="-1"]'); await page.waitForTimeout(100);
  check('month nav goes back', !(await page.locator('#monthPanel h2').innerText()).startsWith(new Date().toLocaleDateString('en-AU', { month: 'long' })));
  await page.click('[data-month="1"]'); if (early) await page.click('[data-month="1"]');
  await page.screenshot({ path: path.join(OUT, 'shot-month.png'), fullPage: true });

  // fitness: this month against earlier months
  { const tp = '#trendPanel', nLines = async () => page.locator(tp + ' svg path[stroke-width]').count();
    const click = async sel => { await page.click(tp + ' ' + sel); await page.waitForTimeout(60); };
    const ymT = T.slice(0, 7), dayNow = today.getDate(), sumSteps = db.Log.slice(1).filter(r => r[0] && r[1] != null && r[1] !== '' && new Date(Date.UTC(1899, 11, 30) + r[0] * 864e5).toISOString().startsWith(ymT)).reduce((a, r) => a + r[1], 0);
    const savedLog = await page.evaluate(() => { const old = state.data.Log; state.data.Log = old.concat(Array.from({ length: 12 }, (_, i) => { const d = new Date(new Date().getFullYear(), new Date().getMonth() - 1 - i, 1), ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); return [10, 11, 12].map(n => ({ date: ym + '-' + String(n).padStart(2, '0'), steps: 6000 + i * 300 + n * 100, km: 4 + i / 4, act: 30 + i, pages: 20 + n, tmax: null, tmin: null, mood: '', note: '' })); }).flat()); renderTrend(); return old; });
    check('trend: first panel in Fitness', await page.evaluate(() => document.querySelector('#v-fitness .panel').id === 'trendPanel'));
    check('trend: title names the stat', /^Steps: this month against earlier months/.test(await page.locator(tp + ' h2').innerText()));
    check('trend: default is this month and last month', (await page.locator(tp + ' .legend span').count()) === 3 && (await nLines()) === 2 && (await page.getAttribute(tp + ' [data-trend-cmp=last]', 'aria-pressed')) === 'true' && (await page.getAttribute(tp + ' [data-trend-view=run]', 'aria-pressed')) === 'true');
    check('trend: svg has a label', /Steps/.test(await page.getAttribute(tp + ' svg', 'aria-label') || ''));
    await page.screenshot({ path: path.join(OUT, 'shot-trend.png'), fullPage: true });
    await click('[data-trend-cmp=m3]');
    check('trend: last 3 months average adds one line', (await nLines()) === 3 && (await page.locator(tp + ' [data-trend-mode="m3:avg"]').getAttribute('aria-pressed')) === 'true');
    await click('[data-trend-mode="m3:each"]');
    check('trend: last 3 months each adds three lines', (await nLines()) === 5);
    await click('[data-trend-cmp=m3]'); await click('[data-trend-cmp=m12]'); await click('[data-trend-mode="m12:each"]');
    check('trend: last 12 months each adds twelve lines', (await nLines()) === 2 + 12);
    await click('[data-trend-view=daily]'); await page.screenshot({ path: path.join(OUT, 'shot-trend-daily.png') });
    await click('[data-trend-cmp=m12]'); await click('[data-trend-cmp=m3]'); await click('[data-trend-view=total]');
    const endVal = await page.evaluate(() => { const l = [...document.querySelectorAll('#trendPanel svg text')].find(x => x.textContent.startsWith('This month')); return l ? l.textContent : ''; });
    check('trend: total view ends at the month total (' + sumSteps + ')', sumSteps ? endVal.includes(sumSteps.toLocaleString('en-AU')) : /no data/.test(await page.locator(tp + ' .legend').innerText()), endVal);
    check('trend: total tiles read "by day N"', (await page.locator(tp + ' .tr-tiles').innerText()).includes('by day ' + dayNow));
    await page.screenshot({ path: path.join(OUT, 'shot-trend-total.png') });
    await click('[data-trend-view=run]');
    { const r = await page.locator(tp + ' svg').boundingBox(); await page.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.5); await page.waitForTimeout(80); }
    check('trend: hover shows a tooltip with the day', /Day \d+/.test(await page.locator(tp + ' [role=status]').textContent()));
    await page.screenshot({ path: path.join(OUT, 'shot-trend-hover.png') });
    await page.mouse.move(5, 5); await page.waitForTimeout(80);
    check('trend: tooltip hides on leave', (await page.locator(tp + ' [role=status]').textContent()).trim() === '');
    check('trend: table hidden at first', (await page.locator(tp + ' tbody tr').count()) === 0);
    await click('[data-trend-table]');
    check('trend: table shows 13 months', (await page.locator(tp + ' tbody tr').count()) === 13 && (await page.getAttribute(tp + ' [data-trend-table]', 'aria-expanded')) === 'true' && /Hide the table/.test(await page.locator(tp + ' [data-trend-table]').innerText()));
    await click('[data-trend-table]');
    await click('[data-trend-stat=pages]');
    check('trend: Pages changes the title', /^Pages: /.test(await page.locator(tp + ' h2').innerText()));
    await click('[data-trend-stat=steps]');
    await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(150);
    check('trend: no sideways scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && await page.evaluate(() => { const r = document.getElementById('trendPanel').getBoundingClientRect(); return r.right <= innerWidth + 0.5; }));
    await page.screenshot({ path: path.join(OUT, 'shot-trend-narrow.png'), fullPage: true });
    await page.setViewportSize({ width: 1360, height: 900 }); await page.waitForTimeout(100);
    await page.evaluate(l => { state.data.Log = l; renderTrend(); }, savedLog);
  }

  // people: birthday without a year
  await page.click('.tab[data-tab=people]'); await page.click('[data-new-person]');
  await page.fill('#pName', 'Kirby'); await page.selectOption('#pDay', '17'); await page.selectOption('#pMon', '10');
  await page.click('#personForm button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  const kr = db.People.find(r => r[1] === 'Kirby');
  check('birthday saved without year (1904 placeholder)', !!kr && kr[2] === serial('1904-10-17'));
  check('due people listed before everyone else', await page.evaluate(() => { const n = [...document.querySelectorAll('#peopleList .person .n')].map(x => x.textContent); return n.indexOf('Sam') < n.indexOf('Kirby') && n.indexOf('Alex') < n.indexOf('Kirby'); }));
  await page.click('[data-person]:text("Kirby")'); await page.waitForTimeout(100);
  check('no-year birthday reopens blank year', (await page.inputValue('#pYear')) === '' && (await page.inputValue('#pDay')) === '17');
  await page.click('#personDlg [data-close]');

  // people: quick add (into the selected group)
  await page.click('[data-pgroup="HFP"]'); await page.fill('#pqName', 'Morgan'); await page.click('#personQuick button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  const mg = db.People.find(r => r[1] === 'Morgan');
  check('quick add person (joins selected group)', !!mg && mg[7] === 'HFP' && /^p/.test(mg[0]) && (await page.inputValue('#pqName')) === '');
  await page.click('[data-pgroup=""]');

  // people: plan a catch-up -> saved on person + on the week plan
  await page.click('[data-nxedit="p3"]'); await page.fill('[data-nxform="p3"] input[name=d]', add(4)); await page.fill('[data-nxform="p3"] input[name=tm]', '630pm'); await page.fill('[data-nxform="p3"] input[name=pl]', 'Dinner at Mama\'s');
  await page.click('[data-nxform="p3"] button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  let jo0 = db.People.find(r => r[0] === 'p3'); const pid = jo0[12];
  const pi = db.Plan.find(r => r[0] === pid);
  check('catch-up saved on person and added to the week', jo0[9] === serial(add(4)) && jo0[10] === '18:30' && jo0[11] === "Dinner at Mama's" && !!pi && pi[4] === "Jo: Dinner at Mama's" && pi[1] === serial(add(4)) && pi[5] === 'Social');
  check('planned person sorts to the top', (await page.locator('#peopleList .person .n').first().innerText()).startsWith('Jo'));
  await page.click('[data-nxedit="p3"]'); await page.fill('[data-nxform="p3"] input[name=d]', add(6)); await page.click('[data-nxform="p3"] button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  check('changing the catch-up moves the week item', db.Plan.find(r => r[0] === pid)[1] === serial(add(6)) && db.Plan.filter(r => r[4] && String(r[4]).startsWith('Jo:')).length === 1);
  await page.click('[data-nxedit="p3"]'); await page.click('[data-nxclear="p3"]'); await page.waitForSelector('#status[data-state=live]');
  jo0 = db.People.find(r => r[0] === 'p3');
  check('removing the catch-up clears person and week item', !db.Plan.some(r => r[0] === pid) && !jo0[9] && !jo0[12]);

  // people: groups and links
  check('group chips listed', (await page.locator('#groupChips .gchip').count()) === 4);
  await page.click('[data-pgroup="HFP"]'); await page.waitForTimeout(100);
  check('group filter narrows list', (await page.locator('#peopleList .person').count()) === 3);
  await page.click('[data-pgroup=""]'); await page.click('[data-pview="groups"]'); await page.waitForTimeout(100);
  check('by-group view has headings', (await page.locator('#peopleList .ghead').count()) >= 3);
  const joText = await page.locator('#peopleList .person:has(.n[data-person="p3"])').first().innerText();
  check('reverse link shown (Jo is child of Alex)', /child of: Alex/i.test(joText));
  await page.click('[data-pview="az"]');
  await page.click('#peopleList [data-person="p3"].n'); await page.waitForTimeout(100);
  await page.click('[data-gpick="IV"]'); await page.selectOption('#pLinkWho', 'p1'); await page.selectOption('#pLinkRel', 'Sibling'); await page.click('#pLinkAdd');
  await page.click('#personForm button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  const jo = db.People.find(r => r[0] === 'p3');
  check('groups and link saved to sheet', jo[7] === 'HFP, IV' && jo[8] === 'p1:Sibling');

  // nav labels keep the arrows still
  await page.click('.tab[data-tab=fitness]'); await page.waitForTimeout(150);
  const xs = []; for (let i = 0; i < 6; i++) { xs.push(Math.round((await page.locator('[data-month="1"]').boundingBox()).x)); await page.click('[data-month="-1"]'); await page.waitForTimeout(50); }
  check('month arrow stays put (' + [...new Set(xs)].join(',') + ')', new Set(xs).size === 1);
  // lists: status dropdown
  await page.click('.tab[data-tab=notes]'); await page.selectOption('[data-status="l1"]', 'Done'); await page.waitForSelector('#status[data-state=live]');
  check('list status dropdown saves', db.Lists.find(r => r[0] === 'l1')[3] === 'Done');

  check('notes tab holds the notes and the lists, and there is no Links tab or Week tab', (await page.locator('#v-notes #notes').count()) === 1 && (await page.locator('#v-notes #lists').count()) === 1 && (await page.locator('.tab[data-tab=links]').count()) === 0 && (await page.locator('.tab[data-tab=week]').count()) === 0);
  for (const t of ['home', 'upcoming', 'fitness', 'people', 'notes']) {
    await page.click(`.tab[data-tab=${t}]`); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `shot-${t}.png`), fullPage: true });
  }
  await page.click('.tab[data-tab=people]'); await page.click('[data-seen="p1"]'); await page.waitForSelector('#status[data-state=live]');
  check('seen today', db.People[1][3] === serial(T) && db.People[1][4] === false);
  await page.click('.tab[data-tab=notes]'); await page.fill('form[data-list="Watching"] input', 'New Show'); await page.click('form[data-list="Watching"] button'); await page.waitForSelector('#status[data-state=live]');
  check('list add', db.Lists.some(r => r[2] === 'New Show' && r[3] === 'Up next'));

  // setup tab
  await page.setViewportSize({ width: 1280, height: 1000 });
  const live = () => page.waitForSelector('#status[data-state=live]');
  await page.click('.tab[data-tab=setup]'); await page.waitForTimeout(200);
  check('setup: four sections, one shown at a time, links among them', await page.locator('#setupNav button').count() === 4 && await page.locator('#setupGrid > .panel').count() === 1 && await page.locator('[data-srow=Routine]').count() === 4 && (await page.locator('#setupNav').innerText()).includes('Links'));
  { const lx = await page.evaluate(() => [...document.querySelectorAll('.stbl [name=title]')].map(i => Math.round(i.getBoundingClientRect().left)).concat([Math.round(document.querySelectorAll('.stbl .shead span')[3].getBoundingClientRect().left)]));
    check('setup: every row and the header line up in columns', new Set(lx).size === 1, lx); }
  await page.screenshot({ path: path.join(OUT, 'shot-setup-1280.png'), fullPage: true });
  const rt0 = JSON.stringify(db.Routine[2]);
  await page.locator('[data-srow=Routine]').nth(1).locator('[name=time]').fill('8am'); await page.locator('[data-srow=Routine]').nth(1).locator('button[type=submit]').click(); await live();
  check('setup: routine time saved (normalised), other cells unchanged', db.Routine[2][2] === '08:00' && db.Routine[2][0] === 'Tue' && db.Routine[2][1] === 'Fitness' && db.Routine[2][3] === 'Kickboxing' && db.Routine[2][4] === true, db.Routine[2]);
  const nCalls = calls.length; await page.locator('[data-srow=Routine]').nth(1).locator('button[type=submit]').click(); await page.waitForTimeout(200);
  check('setup: unchanged row saves nothing', calls.length === nCalls);
  await page.locator('[data-sadd=Routine] [name=day]').selectOption('Thu'); await page.locator('[data-sadd=Routine] [name=cat]').selectOption('Home'); await page.fill('[data-sadd=Routine] [name=time]', '630pm'); await page.fill('[data-sadd=Routine] [name=title]', 'Bins');
  await page.click('[data-sadd=Routine] button[type=submit]'); await live();
  check('setup: routine item added', JSON.stringify(db.Routine[5]) === JSON.stringify(['Thu', 'Home', '18:30', 'Bins', true]), db.Routine[5]);
  const rdel = page.locator('[data-sdel=Routine]').nth(3); await rdel.click(); check('setup: first press asks Remove?', (await rdel.innerText()) === 'Remove?'); const rn = db.Routine.length; await page.waitForTimeout(200);
  check('setup: first press does not delete', db.Routine.length === rn); await rdel.click(); await live();
  check('setup: routine item removed (two presses)', db.Routine.length === rn - 1 && !db.Routine.some(r => r[3] === 'Walk'));
  await page.click('[data-ssec=Goals]'); await page.waitForTimeout(100);
  const gl = db.Goals.length; const gy = today.getFullYear(), gm = today.getMonth() + 1, nm = gm === 12 ? 1 : gm + 1, ny = gm === 12 ? gy + 1 : gy;
  check('setup: goal add defaults to next month', (await page.inputValue('[data-sadd=Goals] [name=year]')) === String(ny) && (await page.inputValue('[data-sadd=Goals] [name=month]')) === String(nm));
  await page.fill('[data-sadd=Goals] [name=steps]', '12000'); await page.fill('[data-sadd=Goals] [name=km]', '9'); await page.click('[data-sadd=Goals] button[type=submit]'); await live();
  const ng = db.Goals[db.Goals.length - 1];
  check('setup: goal added for new month (blank = empty)', db.Goals.length === gl + 1 && ng[0] === ny && ng[1] === nm && ng[2] === 12000 && ng[3] === 9 && (ng[4] === '' || ng[4] == null), ng);
  await page.selectOption('[data-sadd=Goals] [name=month]', String(nm)); await page.fill('[data-sadd=Goals] [name=year]', String(ny));
  const gc = calls.length; await page.click('[data-sadd=Goals] button[type=submit]'); await page.waitForTimeout(300);
  check('setup: duplicate goal month refused, no write', db.Goals.length === gl + 1 && calls.length === gc && (await page.locator('#toast').innerText()).includes('already a goal'));
  await page.click('[data-ssec=Links]'); await page.waitForTimeout(100);
  check('setup: links show an open arrow when there is a web address', (await page.locator('[data-srow=Links] a[href^=https]').count()) >= 1);
  await page.locator('[data-srow=Links]').nth(0).locator('[name=url]').fill('https://example.com/new'); await page.locator('[data-srow=Links]').nth(0).locator('button[type=submit]').click(); await live();
  check('setup: link url saved', db.Links[1][2] === 'https://example.com/new' && db.Links[1][0] === 'Books' && db.Links[1][3] === true && db.Links[1][4] === 1, db.Links[1]);
  await page.fill('[data-sadd=Links] [name=name]', 'Weather'); await page.fill('[data-sadd=Links] [name=cat]', 'Sport'); await page.click('[data-sadd=Links] button[type=submit]'); await live();
  check('setup: link added', db.Links.some(r => r[0] === 'Weather' && r[1] === 'Sport'));
  await page.click('[data-ssec=Settings]'); await page.waitForTimeout(100);
  await page.fill('#sApp [data-k=payday_every]', '21'); await page.click('#sApp button[type=submit]'); await live();
  check('setup: payday_every updated', String(db.Settings[2][1]) === '21' && db.Settings[1][1] === serial('2026-01-09') && String(db.Settings[3][1]) === '60', db.Settings);
  check('setup: payday date shown via toIso', (await page.inputValue('#sApp [data-k=payday_anchor]')) === '2026-01-09');
  await page.fill('#sApp [data-k=payday_anchor]', '2026-01-23'); await page.click('#sApp button[type=submit]'); await live();
  check('setup: payday date saved as a date serial, like the Sheet', Number(db.Settings[1][1]) === serial('2026-01-23'), db.Settings[1]);
  check('setup: payday date reads back', (await page.inputValue('#sApp [data-k=payday_anchor]')) === '2026-01-23');
  // weekly review: date logic, banner, dialog, actions, phone and Stone
  {
    const ad = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const toI = v => v === '' || v == null ? '' : new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
    const dowOf = s => (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const sync = async () => { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(250); await page.waitForSelector('#status[data-state=live]'); };
    const put = (tab, row) => { const i = db[tab].findIndex((r, ix) => ix > 0 && (r[0] === '' || r[0] == null)); if (i > 0) db[tab][i] = row; else db[tab].push(row); };
    const dates = await page.evaluate(() => {
      const w = (t, rl) => { const S = state.data.Settings; const keep = S.slice(); if (rl) S.push({ key: 'review_last', value: rl, notes: '' }); const out = { w: reviewWeek(t), due: reviewDue(t) }; state.data.Settings = keep; return out; };
      return { sun: w('2026-11-08'), mon: w('2026-11-09'), monDone: w('2026-11-09', '2026-11-08'), monSerial: w('2026-11-09', 46334), wed: w('2026-11-11'), sat: w('2026-11-07'), sunDone: w('2026-11-08', '2026-11-08') };
    });
    check('review: Sunday reviews the week ending that day, and is due', dates.sun.w.start === '2026-11-02' && dates.sun.w.end === '2026-11-08' && dates.sun.due === true, dates.sun);
    check('review: Monday with no review looks back at last week, and is due', dates.mon.w.start === '2026-11-02' && dates.mon.due === true, dates.mon);
    check('review: Monday after a review shows the new week, and is not due (even when the date comes back as a sheet serial)', dates.monDone.w.start === '2026-11-09' && dates.monDone.due === false && dates.monSerial.due === (serial('2026-11-08') !== 46334), dates.monDone);
    check('review: Wednesday is the week containing it and is not due', dates.wed.w.start === '2026-11-09' && dates.wed.w.end === '2026-11-15' && dates.wed.due === false && dates.sat.due === false, dates.wed);
    check('review: a reviewed Sunday is not due again', dates.sunDone.due === false);
    const bn = await page.evaluate(() => {
      const R = Date, out = {}, B = () => document.getElementById('reviewBanner'), stub = (y, m, d) => { window.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(y, m, d, 12); } }; };
      try { sessionStorage.removeItem('brain-review-skip'); } catch (e) {}
      stub(2026, 10, 8); renderReviewBanner(); out.sunHidden = B().hidden; out.text = B().innerText; out.btns = [...B().querySelectorAll('button')].map(b => [b.textContent, b.className, b.hasAttribute('data-review-open'), b.hasAttribute('data-review-skip')]);
      B().querySelector('[data-review-skip]').click(); out.skipHidden = B().hidden; out.skipVal = sessionStorage.getItem('brain-review-skip');
      stub(2026, 10, 11); renderReviewBanner(); out.wedHidden = B().hidden;
      stub(2026, 10, 8); const S = state.data.Settings, keep = S.slice(); S.push({ key: 'review_last', value: '2026-11-08', notes: '' }); sessionStorage.removeItem('brain-review-skip'); renderReviewBanner(); out.doneHidden = B().hidden; state.data.Settings = keep;
      window.Date = R; sessionStorage.removeItem('brain-review-skip'); renderReviewBanner(); out.first = B() === document.querySelector('#v-home').firstElementChild && B().nextElementSibling.id === 'homeToday';
      return out;
    });
    check('review banner: on a Sunday it shows the title, the line and both buttons', bn.sunHidden === false && /Sunday review/.test(bn.text) && /Look back at this week and set up the next\./.test(bn.text) && bn.btns.length === 2 && bn.btns[0][0] === 'Start review' && bn.btns[0][1].includes('btn-primary') && bn.btns[0][2] && bn.btns[1][0] === 'Not now' && bn.btns[1][1].includes('btn-ghost') && bn.btns[1][3], bn);
    check('review banner: Not now hides it for this session and remembers that Sunday', bn.skipHidden === true && bn.skipVal === '2026-11-08');
    check('review banner: hidden midweek and once the week is reviewed; sits first on Home', bn.wedHidden === true && bn.doneHidden === true && bn.first === true, bn);

    // data for the week on screen
    const ws = await page.evaluate(() => reviewWeek(todayIso()).start), we = ad(ws, 6);
    const used = new Set(db.Log.slice(1).map(r => toI(r[0]))), free = Array.from({ length: 7 }, (_, i) => ad(ws, i)).filter(d => !used.has(d));
    put('Plan', ['rv1', serial(ad(ws, 1)), '', '09:00', 'RV open one', 'Work', '', false, false, '']);
    put('Plan', ['rv2', serial(ad(ws, 1)), '', '08:00', 'RV done two', 'Social', 'Event ★', true, false, '']);
    put('Plan', ['rv3', serial(ad(ws, 3)), '', '', 'RV open three', 'Social', '', false, false, '']);
    put('Plan', ['rv4', serial(ad(ws, 2)), serial(ad(ws, 4)), '', 'RV trip', 'Home', 'Travel', false, false, '']);
    put('Plan', ['rv5', serial(ad(ws, 9)), '', '', 'RV next event', 'Social', 'Event ★', false, false, '']);
    put('Plan', ['rv6', serial(ad(ws, 5)), '', '10:00', 'RV remove me', 'Other', '', false, false, '']);
    put('Log', [serial(free[0]), 12000, 8, 60, 50, 18, 9, 'G', '']);
    put('Log', [serial(free[1]), 8000, 5, 40, 150, 17, 8, 'F', '']);
    await sync();

    // expectations worked out from the fake sheet itself
    const P = db.Plan.slice(1).filter(r => r[0] && r[1]).map(r => ({ id: r[0], date: toI(r[1]), end: toI(r[2]), type: String(r[6] || ''), cat: r[5], done: r[7] === true, title: r[4] }));
    const inWk = p => p.date <= we && ((p.end && p.end > p.date) ? p.end : p.date) >= ws;
    const W = P.filter(inWk), X = W.filter(p => p.done).length, Y = W.length;
    const L = db.Log.slice(1).filter(r => r[0]).map(r => ({ date: toI(r[0]), steps: r[1], pages: r[4], mood: r[7], any: [1, 2, 3, 4].some(i => r[i] !== '' && r[i] != null) || !!r[7] })).filter(r => r.date >= ws && r.date <= we);
    const avg = k => { const v = L.map(r => r[k]).filter(x => x !== '' && x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const mid = ad(ws, 3), gr = db.Goals.slice(1).find(r => r[0] === Number(mid.slice(0, 4)) && r[1] === Number(mid.slice(5, 7)));
    const word = (k, gi) => { const a = avg(k), gl = gr && gr[gi] ? gr[gi] : null; return a == null ? 'Nothing logged' : !gl ? 'No goal set' : a >= gl ? 'Above goal' : 'Under goal'; };

    await page.evaluate(() => document.getElementById('moreDlg').showModal());
    await page.click('#moreDlg [data-review-open]'); await page.waitForTimeout(200);
    check('review: opens from the More sheet button and closes the sheet', await page.isVisible('#reviewDlg') && !(await page.isVisible('#moreDlg')));
    check('review: the title shows the week (en dash, en-AU)', /^Week of \d{1,2}(?: [A-Z][a-z]{2,4})?–\d{1,2} [A-Z][a-z]{2,4}$/.test(await page.innerText('#reviewTitle')) && (await page.innerText('#reviewTitle')).startsWith('Week of ' + Number(ws.slice(8)) ) && /WEEKLY REVIEW/i.test(await page.innerText('#reviewDlg .rv-head .eyebrow')), await page.innerText('#reviewTitle'));
    const bx = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
    { const A = await bx('#rvPlans'), B = await bx('#rvFit'), C = await bx('#rvPeople'), D = await bx('#rvAhead'), O = await bx('#rvOpen'), N = await bx('#rvNext');
      check('review: Plans and Fitness tiles are a matched pair (same row, width and height)', Math.abs(A.w - B.w) < 1 && Math.abs(A.h - B.h) < 1 && Math.abs(A.y - B.y) < 1 && B.x > A.x, [A, B]);
      check('review: People and Coming up are a matched pair', Math.abs(C.w - D.w) < 1 && Math.abs(C.h - D.h) < 1 && Math.abs(C.y - D.y) < 1 && D.x > C.x, [C, D]);
      check('review: Still open and Next week run the full width', Math.abs(O.w - N.w) < 1 && Math.abs(O.w - (A.w + B.w + 16)) < 2 && O.y > A.y && C.y > O.y && N.y > C.y, [O, N, A, B]); }
    check('review: Plans tile says X of Y done (' + X + ' of ' + Y + ')', (await page.innerText('#rvPlans .rv-big')) === `${X} of ${Y} done`);
    { const st = await page.getAttribute('#rvPlans .rv-bar i', 'style');
      check('review: the bar is green at 80% or more, yellow under', st.includes(X / Y >= 0.8 ? 'var(--ok)' : 'var(--under)') && st.includes('width:' + Math.round(X / Y * 100) + '%'), st); }
    { const ev = W.filter(p => p.type.endsWith('★')).length, so = W.filter(p => p.cat === 'Social').length;
      check('review: events and social counts', (await page.innerText('#rvPlans .rv-meta')) === `${ev} event${ev === 1 ? '' : 's'} · ${so} social`, await page.innerText('#rvPlans .rv-meta')); }
    { const sa = await page.innerText('#rvFit [data-rv-stat=steps]'), pa = await page.innerText('#rvFit [data-rv-stat=pages]');
      check('review: Fitness shows the weekly average steps and pages with the goal verdict', sa.includes(Math.round(avg('steps')).toLocaleString('en-AU')) && sa.includes(word('steps', 2)) && pa.includes(Math.round(avg('pages')).toLocaleString('en-AU')) && pa.includes(word('pages', 5)), [sa, pa]);
      const meta = await page.innerText('#rvFit .rv-meta'), g = L.filter(r => r.mood === 'G').length, f = L.filter(r => r.mood === 'F').length;
      check('review: days logged and mood chips', meta.includes(`Days logged ${L.filter(r => r.any).length} of 7`) && meta.includes('Good ' + g) && meta.includes('Fair ' + f) && !meta.includes('Poor'), meta); }
    { const txt = await page.innerText('#rvOpen'), open = W.filter(p => !p.done && !(p.end && p.end > p.date));
      check('review: Still open lists the open single-day items in date order, not done or multi-day ones', txt.includes('RV open one') && txt.includes('RV open three') && !txt.includes('RV done two') && !txt.includes('RV trip') && txt.indexOf('RV open one') < txt.indexOf('RV open three') && (await page.locator('#rvOpen .rv-row').count()) === open.length, txt);
      check('review: each open row has Done, Move and Remove', (await page.locator('[data-rv-row=rv1] .rv-acts button').allInnerTexts()).join('|').match(/^Done\|Move to (today|\w{3} \d{1,2} \w{3,4})\|Remove$/) !== null, await page.locator('[data-rv-row=rv1] .rv-acts button').allInnerTexts()); }
    check('review: next-week lines show the upcoming event and seven day rows', (await page.innerText('#rvAhead')).includes('RV next event') && (await page.locator('#rvNext .rv-day').count()) === 7 && (await page.innerText('#rvNext')).includes('★ RV next event'));
    await page.screenshot({ path: path.join(OUT, 'shot-review-1000.png') });
    await page.setViewportSize({ width: 1360, height: 1500 }); await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, 'shot-review.png') });
    await page.setViewportSize({ width: 1360, height: 1000 }); await page.waitForTimeout(100);
    await page.click('[data-rv-edit=rv1]'); await page.waitForTimeout(150);
    check('review: the title button opens the item', await page.isVisible('#itemDlg') && (await page.inputValue('#fTitle')) === 'RV open one');
    await page.click('#itemDlg [data-close]'); await page.waitForTimeout(150);
    check('review: stays open after the item closes', await page.isVisible('#reviewDlg') && !(await page.isVisible('#itemDlg')));
    await page.click('[data-rv-done=rv1]'); await live(); await page.waitForTimeout(250);
    check('review: Done ticks the item in the sheet and drops it from the list', db.Plan.find(r => r[0] === 'rv1')[7] === true && !(await page.innerText('#rvOpen')).includes('RV open one') && await page.isVisible('#reviewDlg'));
    const mvLbl = await page.innerText('[data-rv-move=rv3]'), tgt = (() => { const n = ad(we, 1); return n < T ? T : n; })();
    await page.click('[data-rv-move=rv3]'); await live(); await page.waitForTimeout(250);
    check('review: Move sends it to the Monday after the week (or today if that has passed)', toI(db.Plan.find(r => r[0] === 'rv3')[1]) === tgt && (tgt === T ? mvLbl === 'Move to today' : mvLbl.startsWith('Move to ')) && !(await page.innerText('#rvOpen')).includes('RV open three'), [mvLbl, tgt]);
    { const rm = page.locator('[data-rv-del=rv6]'), n0 = db.Plan.length;
      await rm.click(); await page.waitForTimeout(200);
      check('review: Remove first asks "Remove?" and deletes nothing', (await rm.innerText()) === 'Remove?' && db.Plan.some(r => r[0] === 'rv6') && db.Plan.length === n0);
      await rm.click(); await live(); await page.waitForTimeout(250);
      check('review: second press deletes the row', !db.Plan.some(r => r[0] === 'rv6') && !(await page.innerText('#rvOpen')).includes('RV remove me')); }
    check('review: Still open says so when empty', await page.evaluate(() => { const keep = state.data.Plan; state.data.Plan = keep.filter(p => !(p.date >= state.rvStart && p.date <= addDays(state.rvStart, 6))); renderReview(); const t = document.getElementById('rvOpen').innerText; state.data.Plan = keep; renderReview(); return t.includes('Nothing left open. Nice week.'); }));
    // stepping weeks
    const cur = ad(T, -dowOf(T)), shown0 = await page.evaluate(() => state.rvStart), title0 = await page.innerText('#reviewTitle');
    await page.click('[data-review-nav="-1"]'); await page.waitForTimeout(100);
    check('review: the previous-week button goes back one week', (await page.evaluate(() => state.rvStart)) === ad(shown0, -7) && (await page.innerText('#reviewTitle')) !== title0 && (await page.innerText('#reviewTitle')).startsWith('Week of ' + Number(ad(shown0, -7).slice(8))));
    await page.click('[data-review-nav="1"]'); await page.waitForTimeout(100);
    check('review: the next-week button returns, and cannot pass the current week', (await page.evaluate(() => state.rvStart)) === shown0 && (shown0 === cur) === (await page.isDisabled('[data-review-nav="1"]')) && await page.evaluate(c => { const b = document.querySelector('[data-review-nav="1"]'); for (let i = 0; i < 3; i++) { if (!b.disabled) b.click(); } return state.rvStart <= c; }, cur));
    await page.evaluate(() => { state.rvStart = reviewWeek(todayIso()).start; renderReview(); });
    check('review: footer says Not reviewed yet before any review', (await page.innerText('#reviewLast')) === 'Not reviewed yet');
    // mark reviewed
    const nS = db.Settings.length, shown = await page.evaluate(() => state.rvStart);
    await page.click('[data-review-done]'); await live(); await page.waitForTimeout(300);
    { const rows = db.Settings.filter(r => r[0] === 'review_last');
      check('review: Mark week reviewed saves review_last as the Sunday ending the week, closes and toasts', rows.length === 1 && rows[0][1] === serial(ad(shown, 6)) && db.Settings.length === nS + 1 && !(await page.isVisible('#reviewDlg')) && (await page.locator('#toast').innerText()) === 'Week reviewed', rows); }
    check('review: the banner is hidden once reviewed', await page.isHidden('#reviewBanner'));
    await page.evaluate(() => document.getElementById('moreDlg').showModal()); await page.click('#moreDlg [data-review-open]'); await page.waitForTimeout(200);
    check('review: footer shows the last reviewed date', /^Last reviewed: \w{3} \d{1,2} \w{3,4}$/.test(await page.innerText('#reviewLast')), await page.innerText('#reviewLast'));
    await page.click('[data-review-nav="-1"]'); await page.click('[data-review-done]'); await live(); await page.waitForTimeout(300);
    { const rows = db.Settings.filter(r => r[0] === 'review_last');
      check('review: a second save updates the same row (no duplicate)', rows.length === 1 && rows[0][1] === serial(ad(shown, -1)) && db.Settings.length === nS + 1, rows); }

    // phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.getElementById('moreDlg').showModal()); await page.click('#moreDlg [data-review-open]'); await page.waitForTimeout(250);
    { const d = await bx('#reviewDlg'), rad = await page.evaluate(() => getComputedStyle(document.getElementById('reviewDlg')).borderTopLeftRadius), A = await bx('#rvPlans'), B = await bx('#rvFit'), C = await bx('#rvPeople'), D = await bx('#rvAhead');
      check('review phone: the dialog is full screen with square corners', Math.abs(d.x) < 1 && Math.abs(d.y) < 1 && Math.abs(d.w - 390) < 1 && Math.abs(d.h - 844) < 1 && rad === '0px', [d, rad]);
      check('review phone: no sideways scroll', await page.evaluate(() => { const b = document.getElementById('reviewBody'); return document.documentElement.scrollWidth <= innerWidth && b.scrollWidth <= b.clientWidth; }));
      check('review phone: pairs stack at the same width', Math.abs(A.w - B.w) < 1 && Math.abs(A.x - B.x) < 1 && B.y > A.y && Math.abs(C.w - D.w) < 1 && D.y > C.y, [A, B, C, D]);
      check('review phone: header and footer stay in view', await page.evaluate(() => { const h = document.querySelector('.rv-head').getBoundingClientRect(), f = document.querySelector('.rv-foot').getBoundingClientRect(); document.getElementById('reviewBody').scrollTop = 99999; const f2 = document.querySelector('.rv-foot').getBoundingClientRect(); document.getElementById('reviewBody').scrollTop = 0; return h.top >= 0 && Math.abs(f.bottom - innerHeight) < 1 && Math.abs(f2.bottom - innerHeight) < 1; })); }
    await page.screenshot({ path: path.join(OUT, 'shot-review-390.png') });
    await page.evaluate(() => { document.getElementById('reviewBody').scrollTop = 700; }); await page.screenshot({ path: path.join(OUT, 'shot-review-390b.png') });
    await page.setViewportSize({ width: 1360, height: 1500 }); await page.waitForTimeout(100);
    // Stone (light)
    const prev = await page.evaluate(() => { const r = document.documentElement, o = [r.dataset.theme, r.dataset.mode]; r.dataset.theme = 'stone'; r.dataset.mode = 'light'; return o; });
    await page.waitForTimeout(150); await page.screenshot({ path: path.join(OUT, 'shot-review-stone.png') });
    { const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
      const cols = await page.evaluate(() => { const q = (s, p = 'color') => getComputedStyle(document.querySelector(s))[p]; return { big: q('#rvPlans .rv-big'), muted: q('#rvPlans .rv-meta'), title: q('#reviewTitle'), bg: q('#reviewDlg', 'backgroundColor'), card: q('#rvPlans', 'backgroundColor'), ok: q('#rvFit [data-rv-stat] b') }; });
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      check('review Stone: headline, muted and verdict text are readable on the light card', ratio(cols.big, cols.card) >= 4.5 && ratio(cols.muted, cols.card) >= 3.5 && ratio(cols.title, cols.card) >= 4.5 && (!cols.ok || ratio(cols.ok, cols.card) >= 3), cols); }
    await page.evaluate(p => { const r = document.documentElement; r.dataset.theme = p[0]; if (p[1] == null) delete r.dataset.mode; else r.dataset.mode = p[1]; if (p[0] == null) delete r.dataset.theme; }, prev);
    await page.setViewportSize({ width: 1360, height: 1000 }); await page.click('[data-review-close]'); await page.waitForTimeout(100);
    check('review: Close closes it', !(await page.isVisible('#reviewDlg')));
    // clean up the rows this block added
    for (const id of ['rv1', 'rv2', 'rv3', 'rv4', 'rv5', 'rv6']) { const i = db.Plan.findIndex(r => r[0] === id); if (i > 0) db.Plan.splice(i, 1); }
    for (const d of free.slice(0, 2)) { const i = db.Log.findIndex((r, ix) => ix > 0 && toI(r[0]) === d); if (i > 0) db.Log.splice(i, 1); }
    { const i = db.Settings.findIndex(r => r[0] === 'review_last'); if (i > 0) db.Settings.splice(i, 1); }
    await sync();
    check('review: Plan my week closes the review and opens the planner', await (async () => { await page.evaluate(() => document.getElementById('moreDlg').showModal()); await page.click('#moreDlg [data-review-open]'); await page.waitForTimeout(150); await page.click('[data-review-plan]'); await page.waitForTimeout(200); const ok = await page.isVisible('#planDlg') && !(await page.isVisible('#reviewDlg')); await page.evaluate(() => document.getElementById('planDlg').close()); return ok; })());
  }
  await page.fill('#sApp [data-k=weather_place]', 'Perth'); await page.click('#sApp button[type=submit]'); await live();
  check('setup: new setting row added', db.Settings.some(r => r[0] === 'weather_place' && r[1] === 'Perth'));
  await page.screenshot({ path: path.join(OUT, 'shot-setup-1280b.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'shot-setup-390.png'), fullPage: true });
  check('setup: no horizontal scroll at 390', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  await page.setViewportSize({ width: 1360, height: 1000 });
  // drafts: typing survives the refresh that runs when you come back to the tab, and a full reload
  const backToTab = async () => { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(150); await page.waitForSelector('#status[data-state=live]'); };
  await page.click('.tab[data-tab=fitness]'); await page.waitForTimeout(150);
  await page.fill('#logDate', add(-4)); await page.dispatchEvent('#logDate', 'change'); await page.waitForTimeout(100);
  await page.fill('#lSteps', '7777'); await page.fill('#lNote', 'half typed'); await page.click('.mood[data-m=P]');
  check('unsaved note shows while typing', await page.isVisible('[data-draftflag]'));
  await backToTab();
  check('log typing survives coming back to the tab', (await page.inputValue('#lSteps')) === '7777' && (await page.inputValue('#lNote')) === 'half typed' && (await page.getAttribute('.mood[data-m=P]', 'aria-pressed')) === 'true');
  await page.click('.tab[data-tab=home]'); await page.click('[data-addmode=date]'); await page.fill('#ahText', 'Buy milk 5pm');
  await backToTab();
  check('add box typing survives coming back to the tab', (await page.inputValue('#ahText')) === 'Buy milk 5pm' && await page.isVisible('#addHome'));
  if (!(await page.isVisible(`#acc-${add(1)}`))) await page.click(`[data-acc="${add(1)}"]`);
  await page.locator(`#acc-${add(1)} [data-add]`).click(); await page.fill('#fTitle', 'Half-written plan'); await page.fill('#fNotes', 'details');
  await page.reload(); await page.waitForSelector('#status[data-state=live]'); await page.waitForTimeout(300);
  check('add-item pop-up comes back after a reload', await page.isVisible('#itemDlg[open]') && (await page.inputValue('#fTitle')) === 'Half-written plan');
  await page.click('#itemDlg [data-close]');
  check('cancel throws the pop-up draft away', !(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('brain-drafts') || '{}')).some(k => k.startsWith('item@')))));
  check('add box typing survives a reload (box reopens with the preview)', (await page.inputValue('#ahText')) === 'Buy milk 5pm' && await page.isVisible('#addHome') && /Buy milk/.test(await page.locator('#addHome .qa-prev').innerText()));
  await page.click('#addHome button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  check('saving clears the add box draft', db.Plan.some(r => r[4] === 'Buy milk' && r[3] === '17:00') && (await page.inputValue('#ahText')) === '');
  await page.click('.tab[data-tab=fitness]'); await page.waitForTimeout(150);
  check('log typing survives a reload', (await page.inputValue('#lSteps')) === '7777');
  await page.click('[data-draftdiscard]'); await page.waitForTimeout(100);
  check('discard puts the saved values back', (await page.inputValue('#lSteps')) !== '7777' && !(await page.isVisible('[data-draftflag]')));
  await page.fill('#lSteps', '8888'); await page.click('#logForm button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  check('saving the log clears its draft', !(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('brain-drafts') || '{}')).some(k => k.startsWith('log@')))));

  // home quick add: one line, read for date, time and category; quick note
  await page.click('.tab[data-tab=home]'); await page.waitForTimeout(150);
  const fri = (() => { const d = new Date(today); let n = (5 - d.getDay() + 7) % 7; if (n === 0) n = 7; return add(n); })();
  if (!(await page.isVisible('#addHome')) || (await page.getAttribute('[data-addmode=date]', 'aria-expanded')) !== 'true') await page.click('[data-addmode=date]');
  await page.fill('#ahText', 'Dinner IV fri 7pm');
  check('quick add preview reads the line', /Dinner IV/.test(await page.locator('#addHome .qa-prev').innerText()) && /19:00/.test(await page.locator('#addHome .qa-prev').innerText()) && /Social/.test(await page.locator('#addHome .qa-prev').innerText()));
  await page.press('#ahText', 'Enter'); await page.waitForSelector('#status[data-state=live]');
  const qa1 = db.Plan.find(r => r[4] === 'Dinner IV');
  check('quick add: friday 7pm social', !!qa1 && qa1[1] === serial(fri) && qa1[3] === '19:00' && qa1[5] === 'Social' && (await page.inputValue('#ahText')) === '', qa1);
  await page.fill('#ahText', 'gym tomorrow at 6:30am'); await page.press('#ahText', 'Enter'); await page.waitForSelector('#status[data-state=live]');
  const qa2 = db.Plan.find(r => r[4] === 'Gym');
  check('quick add: tomorrow 06:30 fitness', !!qa2 && qa2[1] === serial(add(1)) && qa2[3] === '06:30' && qa2[5] === 'Fitness', qa2);
  await page.fill('#ahText', 'Sort winter clothes'); await page.press('#ahText', 'Enter'); await page.waitForSelector('#status[data-state=live]');
  const qa3 = db.Plan.find(r => r[4] === 'Sort winter clothes');
  check('quick add: no date means today', !!qa3 && qa3[1] === serial(T) && qa3[3] === '', qa3);
  check('quick add: shows on home straight away', (await page.locator('#homeToday').innerText()).includes('Sort winter clothes'));
  await page.click('[data-addmode=note]'); check('add note switches the box to notes', await page.isVisible('#addHome') && (await page.getAttribute('[data-addmode=note]', 'aria-expanded')) === 'true' && (await page.getAttribute('[data-addmode=date]', 'aria-expanded')) === 'false');
  await page.fill('#ahText', 'Gift ideas: a book for Sam'); check('quick note preview shows the topic', /Gift ideas/.test(await page.locator('#addHome .qa-prev').innerText()));
  await page.press('#ahText', 'Enter'); await page.waitForSelector('#status[data-state=live]');
  const nt = db.Notes.find(r => r[2] === 'Gift ideas');
  check('quick note: topic and text saved with today\'s date', !!nt && nt[3] === 'a book for Sam' && nt[1] === serial(T) && (await page.inputValue('#ahText')) === '', nt);
  await page.fill('#ahText', 'Remember the bins'); await page.press('#ahText', 'Enter'); await page.waitForSelector('#status[data-state=live]');
  check('quick note: no topic goes under Quick note', db.Notes.some(r => r[2] === 'Quick note' && r[3] === 'Remember the bins'));
  await page.click('.tab[data-tab=notes]'); await page.waitForTimeout(100);
  check('quick notes show on the Notes tab', (await page.locator('#notes').innerText()).includes('a book for Sam'));
  // notes: ideas map
  await page.waitForSelector('#ideaMap .inode');
  const nrow = id => db.Notes.find(r => r[0] === id), gid = nt[0], saved = async () => { await page.waitForSelector('#status[data-state=live]'); await page.waitForTimeout(250); };
  check('ideas map: opens as the Map view with a hub per topic', (await page.locator('#ideaMap .inode.t').count()) === 3 && (await page.locator('[data-iview=map]').getAttribute('aria-pressed')) === 'true');
  check('ideas map: a node per note', (await page.locator('#ideaMap .inode.n').count()) === db.Notes.length - 1);
  check('ideas map: edges drawn, svg hidden from screen readers', (await page.locator('#ideaMap svg[aria-hidden=true] .ie').count()) === 3 && (await page.locator('#ideaMap .ispark').count()) === 3);
  await page.screenshot({ path: path.join(OUT, 'shot-ideas.png'), fullPage: true });
  await page.click('[data-ik="n:n1"]');
  check('ideas map: selecting a note shows its text in the side panel', (await page.locator('#ideaSide').innerText()).includes('Line two') && (await page.locator('[data-ik="n:n1"]').getAttribute('aria-pressed')) === 'true');
  await page.click('[aria-label="Colour: Teal"]'); await saved();
  check('ideas map: choosing a colour saves color', nrow('n1')[5] === 'teal' && (await page.locator('[aria-label="Colour: Teal"]').getAttribute('aria-pressed')) === 'true', nrow('n1'));
  const edges0 = await page.locator('#ideaMap .ie').count();
  await page.selectOption('#ideaLink', 'n:' + gid); await saved();
  check('ideas map: Link to… saves n:<id> and draws an extra edge', nrow('n1')[4] === 'n:' + gid && (await page.locator('#ideaMap .ie').count()) === edges0 + 1, nrow('n1'));
  await page.click('[data-ik="n:' + gid + '"]');
  check('ideas map: the link shows from the other end', (await page.locator('#ideaSide .ichip').allInnerTexts()).join('').includes('Line one'));
  await page.click('[data-ik="n:n1"]'); await page.click(`[data-iunlink="n:${gid}"]`); await saved();
  check('ideas map: removing the link clears it and the edge', !nrow('n1')[4] && (await page.locator('#ideaMap .ie').count()) === edges0);
  await page.click('[data-ik="n:' + gid + '"]');
  check('ideas map: a plain click does not save pos', !nrow(gid)[6]);
  const bb = await page.locator('[data-ik="n:n1"]').boundingBox(), cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 30, cy + 20, { steps: 4 }); await page.mouse.move(cx - 80, cy + 50, { steps: 4 }); await page.mouse.up(); await saved();
  const bb2 = await page.locator('[data-ik="n:n1"]').boundingBox();
  check('ideas map: dragging a note saves pos', /^\d+,\d+$/.test(nrow('n1')[6] || '') && Math.abs(bb.x - bb2.x - 80) < 8, [nrow('n1')[6], bb2.x - bb.x]);
  await page.click('[data-icf="teal"]'); await page.waitForTimeout(450);
  const ops = await page.locator('#ideaMap .inode.n').evaluateAll(els => els.map(e => [e.dataset.ik, Number(getComputedStyle(e).opacity)]));
  check('ideas map: colour filter dims non-matching notes and keeps matching ones', ops.find(o => o[0] === 'n:n1')[1] === 1 && ops.some(o => o[1] < 0.5), ops);
  await page.click('[data-icf=""]');
  await page.click('[data-iview=list]');
  check('ideas map: List view still shows the notes with the map hidden', (await page.locator('#notes').isVisible()) && (await page.locator('#notes').innerText()).includes('a book for Sam') && !(await page.locator('#ideaMap').isVisible()) && (await page.locator('#notes .note .isw').count()) === 3);
  await page.click('[data-iview=map]');
  await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(250);
  check('ideas map: no sideways page scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) && (await page.evaluate(() => { const w = document.querySelector('.imapwrap'); return w.scrollWidth > w.clientWidth; })));
  await page.screenshot({ path: path.join(OUT, 'shot-ideas-390.png'), fullPage: true });
  check('ideas map: phones open Notes as a list until Map is picked', await page.evaluate(() => { state.notesView = null; renderNotes(); const r = document.getElementById('notes').offsetParent !== null && document.querySelector('[data-iview=list]').getAttribute('aria-pressed') === 'true'; state.notesView = 'map'; renderNotes(); return r; }));
  await page.setViewportSize({ width: 1360, height: 1000 }); await page.waitForTimeout(200);
  await page.click('.tab[data-tab=home]');

  // push to tomorrow: today's open items get a button; done or other days don't
  check('push: shown on today\'s open items only', await page.locator('#homeToday [data-push]').count() > 0 && await page.locator('#homeToday [data-push="e1"]').count() === 0 && await page.locator('#nextBody [data-push]').count() === 0);
  await page.click('#homeToday [aria-label="Push to tomorrow: Sort winter clothes"]'); await page.waitForSelector('#status[data-state=live]');
  { const r = db.Plan.find(x => x[4] === 'Sort winter clothes');
    check('push: moves the item to tomorrow in the sheet and off today', !!r && r[1] === serial(add(1)) && !(await page.locator('#homeToday').innerText()).includes('Sort winter clothes'), r); }

  // themes: monthly rotation by default, picker saves to Settings
  { const th = await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.mode]);
    const exp = ['nebula', 'ember', 'solar', 'citrine', 'verdant'][today.getMonth() % 5];
    check('theme: this month\'s theme applied by default (' + th + ')', th[0] === exp && th[1] === 'dark', th);
    check('theme: animated backdrop drawn', await page.locator('#fx > *').count() > 0); }
  await page.click('#themeBtn'); await page.waitForSelector('#themeDlg[open]');
  check('theme: picker lists auto, five dark themes and Stone', await page.locator('#themeList [data-theme-pick]').count() === 7);
  await page.click('#themeList [data-theme-pick=stone]'); await page.waitForSelector('#status[data-state=live]'); await page.waitForTimeout(100);
  check('theme: Stone is light and saved to Settings', await page.evaluate(() => document.documentElement.dataset.theme === 'stone' && document.documentElement.dataset.mode === 'light') && db.Settings.some(r => r[0] === 'theme' && r[1] === 'stone'), db.Settings);
  if (await page.isVisible('#themeDlg')) await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(OUT, 'shot-home-stone.png'), fullPage: true });
  await page.reload(); await page.waitForSelector('#status[data-state=live]'); await page.waitForTimeout(200);
  check('theme: choice survives a reload', await page.evaluate(() => document.documentElement.dataset.theme) === 'stone');
  await page.click('#themeBtn'); await page.waitForSelector('#themeDlg[open]'); await page.click('#themeList [data-theme-pick=ember]'); await page.waitForSelector('#status[data-state=live]');
  check('theme: switching again updates the same Settings row', db.Settings.filter(r => r[0] === 'theme').length === 1 && db.Settings.find(r => r[0] === 'theme')[1] === 'ember' && await page.evaluate(() => document.documentElement.dataset.mode) === 'dark');
  if (await page.isVisible('#themeDlg')) await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(OUT, 'shot-home-ember.png'), fullPage: true });

  // search everything: palette (Ctrl/Cmd+K, "/", header button)
  {
    await page.setViewportSize({ width: 1360, height: 1000 }); await page.waitForTimeout(100);
    const sOpen = () => page.evaluate(() => document.getElementById('searchDlg').open);
    const sTexts = sel => page.locator('#searchResults ' + sel).allInnerTexts();
    const sOpts = () => page.locator('#searchResults [role=option]').count();
    await page.keyboard.press('Control+k'); await page.waitForTimeout(80);
    check('search: Ctrl+K opens the dialog with the input focused', await sOpen() && await page.evaluate(() => document.activeElement.id) === 'searchInput');
    check('search: empty state shows Coming up and the hint', (await sTexts('.sgh')).some(h => /^coming up$/i.test(h)) && (await page.innerText('#searchResults')).includes('Type to search everything.') && await sOpts() > 0 && await sOpts() <= 5);
    await page.keyboard.press('Escape'); await page.waitForTimeout(80);
    check('search: Esc closes it', !(await sOpen()));
    await page.keyboard.press('/'); await page.waitForTimeout(80);
    check('search: "/" opens it', await sOpen());
    check('search: "/" typed in the box is not swallowed', (await (async () => { await page.keyboard.type('a/b'); return page.inputValue('#searchInput'); })()) === 'a/b');
    await page.keyboard.press('Escape');
    await page.click('#searchBtn'); await page.waitForTimeout(80);
    check('search: header button opens it, clearing the old query', await sOpen() && await page.inputValue('#searchInput') === '');
    await page.fill('#searchInput', 'work');
    const w1 = await sOpts(), w1t = await sTexts('.s1'); await page.fill('#searchInput', 'work ' + w1t[0].split(' ')[0]); const w2 = await sOpts();
    check('search: a one-word query finds Plan items and a second word narrows (AND)', w1 >= 2 && w2 >= 1 && w2 < w1, [w1, w2, w1t]);
    await page.fill('#searchInput', 'dinner');
    check('search: matches are marked', (await sTexts('mark')).length > 0 && (await sTexts('mark')).every(m => m.toLowerCase() === 'dinner'));
    await page.screenshot({ path: path.join(OUT, 'shot-search.png') });
    await page.fill('#searchInput', 'a');
    const heads = await sTexts('.sgh');
    check('search: results are grouped under the right headings', heads.includes('PLANS') || heads.includes('Plans') ? ['Plans', 'People', 'Lists', 'Links'].every(h => heads.map(x => x.toLowerCase()).includes(h.toLowerCase())) : false, heads);
    check('search: the first option is active and aria-activedescendant follows', await page.evaluate(() => { const o = document.querySelector('#searchResults [role=option]'); return o.getAttribute('aria-selected') === 'true' && document.getElementById('searchInput').getAttribute('aria-activedescendant') === o.id; }));
    await page.fill('#searchInput', 'dinner'); await page.keyboard.press('ArrowDown'); const pick = await page.locator('#searchResults [aria-selected=true] .s1').innerText(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    check('search: Enter on a Plan result opens the item editor', !(await sOpen()) && await page.isVisible('#itemDlg') && await page.inputValue('#fTitle') === pick, [pick, await sOpen(), await page.isVisible('#itemDlg'), await page.inputValue('#fTitle')]);
    await page.keyboard.press('Escape'); await page.waitForTimeout(80);
    await page.keyboard.press('Control+k'); await page.fill('#searchInput', 'ideas'); await page.locator('#searchResults [role=option]').first().click(); await page.waitForTimeout(150);
    check('search: a note result opens the note dialog', await page.isVisible('#noteDlg') && await page.inputValue('#nTopic') === 'Ideas');
    await page.keyboard.press('Escape'); await page.waitForTimeout(80);
    await page.click('#searchBtn'); await page.fill('#searchInput', 'alex'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    check('search: a person result opens the person dialog', await page.isVisible('#personDlg') && await page.inputValue('#pName') === 'Alex');
    await page.keyboard.press('Escape'); await page.waitForTimeout(80);
    await page.click('#searchBtn'); await page.fill('#searchInput', 'dentist'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    check('search: a list result jumps to Notes and highlights the panel', await page.evaluate(() => state.tab === 'notes' && !!document.querySelector('.search-flash')));
    await page.click('#searchBtn'); await page.fill('#searchInput', 'rain'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    check('search: a log result opens that day in Fitness', await page.evaluate(() => state.tab === 'fitness' && document.getElementById('logDate').value === state.logDate && !!state.logDate));
    await page.evaluate(() => showTab('home')); await page.waitForTimeout(100);
    await page.click('#searchBtn'); await page.fill('#searchInput', 'zzzqq');
    check('search: no-match text', (await page.innerText('#searchResults')).includes('Nothing matches “zzzqq”.'));
    await page.evaluate(() => { state.data.Notes.push({ id: 'nx', date: todayIso(), topic: 'Café', note: 'Flat white', links: '', color: '', pos: '' }); });
    await page.fill('#searchInput', 'cafe');
    check('search: diacritic-insensitive matching (cafe finds Café)', (await sTexts('.s1')).some(t => t === 'Café') && (await sTexts('mark')).includes('Café'));
    await page.fill('#searchInput', 'CAFÉ'); check('search: and the other way round', (await sTexts('.s1')).some(t => t === 'Café'));
    await page.evaluate(() => { state.data.Notes = state.data.Notes.filter(n => n.id !== 'nx'); });
    await page.fill('#searchInput', '<img src=x onerror=1>');
    check('search: markup in the query is not injected', await page.locator('#searchResults img').count() === 0 && (await page.innerText('#searchResults')).includes('<img src=x onerror=1>'));
    await page.keyboard.press('Escape');
    // stone theme
    await page.evaluate(() => { document.documentElement.dataset.theme = 'stone'; document.documentElement.dataset.mode = 'light'; });
    await page.click('#searchBtn'); await page.fill('#searchInput', 'dinner'); await page.waitForTimeout(80);
    check('search: works in the Stone theme', await sOpts() >= 1 && (await sTexts('mark')).length >= 1);
    await page.screenshot({ path: path.join(OUT, 'shot-search-stone.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'ember'; document.documentElement.dataset.mode = 'dark'; });
    // phone
    await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(150);
    check('phone: search button sits on the same header row as the others', await page.evaluate(() => { const ys = ['searchBtn', 'themeBtn', 'refreshBtn', 'settingsBtn'].map(i => Math.round(document.getElementById(i).getBoundingClientRect().top)); return new Set(ys).size === 1; }), await page.evaluate(() => ['searchBtn', 'themeBtn', 'refreshBtn', 'settingsBtn'].map(i => Math.round(document.getElementById(i).getBoundingClientRect().top))));
    check('phone: the Search label is visually hidden', await page.evaluate(() => document.querySelector('#searchBtn .slabel').getBoundingClientRect().width <= 1));
    await page.click('#searchBtn'); await page.fill('#searchInput', 'dinner'); await page.waitForTimeout(80);
    check('phone: search dialog fits with a 16px gutter and no sideways scroll', await page.evaluate(() => { const r = document.getElementById('searchDlg').getBoundingClientRect(); return Math.abs(r.left - 16) <= 1 && Math.abs(innerWidth - r.right - 16) <= 1 && document.documentElement.scrollWidth <= innerWidth; }), await page.evaluate(() => { const r = document.getElementById('searchDlg').getBoundingClientRect(); return [r.left, r.right, innerWidth, document.documentElement.scrollWidth]; }));
    await page.screenshot({ path: path.join(OUT, 'shot-search-390.png') });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1360, height: 1000 }); await page.waitForTimeout(150);
    check('search: left the page as it found it (closed, home tab)', !(await sOpen()) && await page.evaluate(() => state.tab) === 'home');
  }

  // phone: bottom tab bar, add sheet (planner and notes), More sheet
  await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(200);
  check('phone: bottom bar replaces the top tabs', await page.isVisible('.bbar') && !(await page.isVisible('.tabs')));
  check('phone: bottom bar has five equal slots', await page.evaluate(() => document.querySelectorAll('.bbar > *').length === 5));
  check('phone: home pairs stack, nothing scrolls sideways', await page.evaluate(() => { const a = document.getElementById('homeNews').getBoundingClientRect(), b = document.getElementById('homeWx').getBoundingClientRect(); return b.top > a.bottom - 1 && Math.abs(a.width - b.width) < 1 && document.documentElement.scrollWidth <= innerWidth; }));
  check('phone: header buttons stay on one row', await page.evaluate(() => { const ys = ['themeBtn', 'refreshBtn', 'settingsBtn'].map(i => document.getElementById(i)).filter(Boolean).map(b => Math.round(b.getBoundingClientRect().top)); return ys.length >= 2 && new Set(ys).size === 1; }));
  await page.screenshot({ path: path.join(OUT, 'shot-home-390.png'), fullPage: true });
  await page.click('.bbar [data-qaopen]'); await page.waitForSelector('#qaDlg[open]');
  await page.fill('#qsText', 'Call the bank thu'); await page.screenshot({ path: path.join(OUT, 'shot-sheet-390.png') }); await page.press('#qsText', 'Enter'); await page.waitForSelector('#status[data-state=live]');
  check('phone: + sheet adds to the planner and closes', db.Plan.some(r => r[4] === 'Call the bank' && r[5] === 'Home') && !(await page.isVisible('#qaDlg')));
  await page.click('.bbar [data-qaopen]'); await page.waitForSelector('#qaDlg[open]'); await page.fill('#nsText', 'Phone note'); await page.press('#nsText', 'Enter'); await page.waitForSelector('#status[data-state=live]');
  check('phone: + sheet adds a note too', db.Notes.some(r => r[3] === 'Phone note'));
  await page.click('.bbar [data-more]'); await page.waitForSelector('#moreDlg[open]');
  check('phone: More lists the rest of the tabs', JSON.stringify(await page.locator('#moreDlg .more button').allInnerTexts()) === JSON.stringify(['Paper', 'Family & Friends', 'Notes', 'Setup', 'Settings', 'Weekly review']));
  await page.click('#moreDlg [data-go=people]'); await page.waitForTimeout(150);
  check('phone: More opens other sections', await page.isVisible('#v-people') && !(await page.isVisible('#moreDlg')) && (await page.getAttribute('.bbar [data-more]', 'aria-current')) === 'page');
  await page.click('.bbar [data-go=upcoming]'); await page.waitForTimeout(150);
  check('phone: bar marks the open section', (await page.getAttribute('.bbar [data-go=upcoming]', 'aria-current')) === 'page' && await page.isVisible('#v-upcoming'));
  await page.screenshot({ path: path.join(OUT, 'shot-upcoming-390.png'), fullPage: true });
  check('phone: calendar fits the screen', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // mobile
  await page.setViewportSize({ width: 390, height: 900 }); await page.click('.bbar [data-go=home]'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'shot-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('no horizontal scroll on phone', !overflow);

  console.log(log.join('\n'));
  console.log('errors:', errors);
  await b.close();
})();
