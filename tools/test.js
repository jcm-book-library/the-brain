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
  Notes: [['ID', 'Date', 'Topic', 'Note'], ['n1', serial(add(-5)), 'Ideas', 'Line one\nLine two']],
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
  await page.route('https://jcm-book-library.github.io/daily-paper/', r => r.fulfill({ contentType: 'text/html', body: '<h1 style="font-family:serif">The Overnight Sentinel (stub)</h1>' }));
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
  await page.screenshot({ path: path.join(OUT, 'shot-week.png'), fullPage: true });
  const log = [];
  const check = (name, ok) => log.push((ok ? 'PASS ' : 'FAIL ') + name);

  check('chips include payday', await page.locator('.cd.pay').count() === 1); { const pd = await page.locator('.cd.pay b').innerText(); const exp = (()=>{const a=Date.UTC(2026,0,9);const n=Date.UTC(today.getFullYear(),today.getMonth(),today.getDate());const d=Math.round((n-a)/864e5);const r=((14-(d%14))%14);return r===0?'Today':r===1?'Tomorrow':r+' days';})(); check('payday countdown correct ('+pd+')', pd===exp); }
  check('ticked countdown shown', (await page.locator('#chips').innerText()).includes('Dinner with friends'));
  check('today items rendered', (await page.locator('#focusPanel').innerText()).includes('Strength & Conditioning'));
  check('six day cards', await page.locator('.dcard').count() === 6);
  check('day cards stack in one column', await page.evaluate(() => getComputedStyle(document.getElementById('days')).gridTemplateColumns.split(' ').length === 1));
  check('pinned links', await page.locator('#links a').count() === 2);

  // tick an item
  await page.locator('[data-tick="e1"]').check(); await page.waitForSelector('#status[data-state=live]');
  check('tick saved to sheet', db.Plan[1][7] === true);

  // quick add
  await page.fill('#qaTitle', 'Call Mum'); await page.fill('#qaTime', '730pm'); await page.selectOption('#qaCat', 'Social');
  await page.click('#quickAdd button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  const added = db.Plan.find(r => r[4] === 'Call Mum');
  check('quick add wrote row after last item (row 10)', db.Plan.indexOf(added) === 9 && added[3] === '19:30' && added[5] === 'Social' && added[1] === serial(T));

  // edit via dialog
  await page.click('[data-edit="e2"]'); await page.fill('#fTitle', 'WFH'); await page.click('#itemForm button[type=submit]'); await page.waitForSelector('#status[data-state=live]');
  check('edit saved', db.Plan[2][4] === 'WFH');

  // delete
  await page.click('[data-edit="e3"]'); await page.click('#itemDel'); await page.waitForSelector('#status[data-state=live]');
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

  // focus another day
  await page.locator('.dcard-h button').nth(2).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'shot-week2.png'), fullPage: true });

  // to book tick
  await page.locator('[data-booked="l2"]').check(); await page.waitForSelector('#status[data-state=live]');
  check('to-book ticked -> Done', db.Lists.find(r => r[0] === 'l2')[3] === 'Done');

  await page.click('.tab[data-tab=paper]'); await page.waitForTimeout(400);
  check('paper tab embeds the paper', (await page.locator('#paperFrame').getAttribute('src')) === 'https://jcm-book-library.github.io/daily-paper/' && (await page.frameLocator('#paperFrame').locator('h1').innerText()).includes('Sentinel'));
  await page.screenshot({ path: path.join(OUT, 'shot-paper.png') });
  check('calendar sits on the week tab', await page.locator('#v-week #cal .c').count() > 300 && await page.locator('.tab[data-tab=calendar]').count() === 0);

  // stats tab: backdate a log
  await page.click('.tab[data-tab=stats]'); await page.waitForTimeout(200);
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
  check('this month panel shows totals', (await page.locator('#monthPanel .tile').count()) === 6 && (await page.locator('#monthPanel').innerText()).includes('so far'));
  const cellsWithSteps = await page.locator('#monthPanel .v[data-g]').count();
  check('day grid colours days against goal', cellsWithSteps >= 3);
  await page.locator('#monthPanel .v[data-logday]').first().click(); await page.waitForTimeout(100);
  check('clicking a day opens it in the log', (await page.inputValue('#logDate')).endsWith('-01'));
  await page.click('[data-month="-1"]'); await page.waitForTimeout(100);
  check('month nav goes back', !(await page.locator('#monthPanel h2').innerText()).startsWith(new Date().toLocaleDateString('en-AU', { month: 'long' })));
  await page.click('[data-month="1"]');
  await page.screenshot({ path: path.join(OUT, 'shot-month.png'), fullPage: true });

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
  await page.click('.tab[data-tab=stats]'); await page.waitForTimeout(150);
  const xs = []; for (let i = 0; i < 6; i++) { xs.push(Math.round((await page.locator('[data-month="1"]').boundingBox()).x)); await page.click('[data-month="-1"]'); await page.waitForTimeout(50); }
  check('month arrow stays put (' + [...new Set(xs)].join(',') + ')', new Set(xs).size === 1);
  await page.click('.tab[data-tab=week]'); await page.waitForTimeout(100);
  const wx2 = []; for (let i = 0; i < 6; i++) { wx2.push(Math.round((await page.locator('#nextWk').boundingBox()).x)); await page.click('#nextWk'); await page.waitForTimeout(50); }
  check('week arrow stays put (' + [...new Set(wx2)].join(',') + ')', new Set(wx2).size === 1);
  await page.click('#todayBtn');

  // lists: status dropdown
  await page.click('.tab[data-tab=lists]'); await page.selectOption('[data-status="l1"]', 'Done'); await page.waitForSelector('#status[data-state=live]');
  check('list status dropdown saves', db.Lists.find(r => r[0] === 'l1')[3] === 'Done');

  check('lists and notes share a tab', (await page.locator('.tab[data-tab=notes]').count()) === 0 && (await page.locator('#v-lists #notes').count()) === 1);
  for (const t of ['week', 'stats', 'people', 'lists', 'links']) {
    await page.click(`.tab[data-tab=${t}]`); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `shot-${t}.png`), fullPage: true });
  }
  await page.click('.tab[data-tab=people]'); await page.click('[data-seen="p1"]'); await page.waitForSelector('#status[data-state=live]');
  check('seen today', db.People[1][3] === serial(T) && db.People[1][4] === false);
  await page.click('.tab[data-tab=lists]'); await page.fill('form[data-list="Watching"] input', 'New Show'); await page.click('form[data-list="Watching"] button'); await page.waitForSelector('#status[data-state=live]');
  check('list add', db.Lists.some(r => r[2] === 'New Show' && r[3] === 'Up next'));

  // mobile
  await page.setViewportSize({ width: 390, height: 900 }); await page.click('.tab[data-tab=week]'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'shot-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('no horizontal scroll on phone', !overflow);

  console.log(log.join('\n'));
  console.log('errors:', errors);
  await b.close();
})();
