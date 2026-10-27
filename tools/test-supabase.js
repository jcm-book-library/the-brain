// Headless test for Supabase mode: fake Supabase (auth + PostgREST) and a read-only fake Sheets API, all via page.route.
// Run: NODE_PATH=$(npm root -g) node tools/test-supabase.js <outdir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const OUT = process.argv[2] || __dirname;
const SBU = 'https://apeflgdzclpxiktaxyfk.supabase.co';
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(), T = iso(today);
const add = n => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const serial = s => { const [y, m, d] = s.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5); };
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (email = 'me@example.com') => 'x.' + b64u({ email, sub: 'u1' }) + '.y';
const GOOD = jwt(), EXPIRED = 'EXPIRED_TOKEN', FRESH = jwt('me@example.com') + 'f';
const TABLES = ['plan', 'routine', 'log', 'goals', 'people', 'lists', 'notes', 'links', 'settings'];
const TAB_OF = { plan: 'Plan', routine: 'Routine', log: 'Log', goals: 'Goals', people: 'People', lists: 'Lists', notes: 'Notes', links: 'Links', settings: 'Settings' };

const log = [];
const check = (name, ok, extra) => log.push((ok ? 'PASS ' : 'FAIL ') + name + (!ok && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''));
const errors = [];

function sheetsDb() {
  return {
    Plan: [['ID', 'Date', 'End', 'Time', 'Title', 'Category', 'Type', 'Done', 'Countdown', 'Notes'],
      ['e1', serial(T), '', '07:00', 'Strength & Conditioning', 'Fitness', 'Gym', false, false, ''],
      ['e2', serial(T), '', '', 'Office', 'Work', 'Routine', true, false, ''],
      ['e3', serial(add(1)), '', '15:00', 'Finance Coaching', 'Work', 'Work', false, false, ''],
      ['e4', serial(add(2)), '', '', 'Dinner with friends', 'Social', 'Catch up', false, true, ''],
      ['e6', serial(add(3)), serial(add(5)), '', 'Housesitting', 'Home', 'Housesitting', false, false, ''],
      ['', '', '', '', '', '', '', false, false, '']],
    Routine: [['Day', 'Category', 'Time', 'Title', 'Active'], ['Mon', 'Fitness', '', '12000 steps', true], ['Tue', 'Fitness', '0700', 'Kickboxing', true], ['Sat', 'Fitness', '', 'Walk', false]],
    Log: [['Date', 'Steps', 'KM', 'Active mins', 'Pages', 'Max', 'Min', 'Mood', 'Note'], [serial(add(-3)), 10000, 7.2, 60, 100, 18, 9, 'G', ''], [serial(add(-2)), 4000, 2.9, 30, 120, 15, 8, 'F', 'Rain'], [serial(add(-1)), 14000, 10.1, 120, 90, 20, 10, 'G', '']],
    Goals: [['Year', 'Month', 'Steps', 'KM', 'Active', 'Pages'], [today.getFullYear(), today.getMonth() + 1, 11000, 8, 90, 100]],
    People: [['ID', 'Name', 'Birthday', 'Last seen', 'To see', 'Every', 'Notes', 'Groups', 'Links', 'Next', 'Time', 'Plan', 'PlanID'], ['p1', 'Sam', serial('1990-03-04'), '', true, '', 'Ask about the new job', 'IV', '', '', '', '', ''], ['p2', 'Alex', '', serial(add(-100)), false, 60, '', 'HFP, IV', 'p3:Parent of', '', '', '', ''], ['p3', 'Jo', '', '', false, '', '', 'HFP', '', '', '', '', '']],
    Lists: [['ID', 'List', 'Item', 'Status', 'Added', 'Notes'], ['l1', 'Reading', 'A Book', 'Current', serial(T), ''], ['l2', 'To book', 'Dentist', 'Open', serial(add(-10)), '']],
    Notes: [['ID', 'Date', 'Topic', 'Note'], ['n1', serial(add(-5)), 'Ideas', 'Line one\nLine two']],
    Links: [['Name', 'Category', 'URL', 'Pin', 'Order', 'Notes'], ['Books', 'Entertainment', 'https://example.com/books', true, 1, ''], ['NRL', 'Sport', 'https://example.com/nrl', true, 2, ''], ['Other', 'Sport', '', false, '', '']],
    Settings: [['Key', 'Value', 'Notes'], ['payday_anchor', serial('2026-01-09'), ''], ['payday_every', 14, ''], ['birthday_window', 60, '']]
  };
}
const sids = { Plan: 0, Routine: 1, Log: 2, Goals: 3, People: 4, Lists: 5, Notes: 6, Links: 7, Settings: 8 };
const keyIdx = { Plan: 0, Routine: 3, Log: 0, Goals: 0, People: 0, Lists: 0, Notes: 0, Links: 0, Settings: 0 };
const realRows = (db, t) => db[t].slice(1).filter(r => r[keyIdx[t]] !== '' && r[keyIdx[t]] != null).length;
function parseA1(r) { const [tab, rng] = r.split('!'); const [a, b] = rng.split(':'); const p = s => { const m = s.match(/^([A-Z])(\d*)$/); return { c: m[1].charCodeAt(0) - 65, r: m[2] ? Number(m[2]) : null }; }; const A = p(a), B = b ? p(b) : A; return { tab, r0: A.r, c0: A.c, r1: B.r, c1: B.c }; }

// A fresh world: fake Sheets + fake Supabase, each with its own call log.
function world() {
  const w = { sheets: sheetsDb(), sheetCalls: [], sb: {}, sbCalls: [], nextId: 1, refreshes: 0, logouts: 0, forced401: 0, authorize: [] };
  TABLES.forEach(t => { w.sb[t] = []; });
  w.insert = (t, o) => { w.sb[t].push({ row_id: w.nextId++, ...o }); };
  return w;
}
async function install(page, w) {
  await page.route('https://brain.test/**', r => r.fulfill({ contentType: 'text/html', body: HTML }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: '' }));
  await page.route(/accounts\.google\.com/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/api\.open-meteo\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], weathercode: [] } }) }));
  await page.route(/jcm-book-library\.github\.io/, r => r.fulfill({ contentType: 'text/html', body: '<p>stub</p>' }));
  await page.route(/sheets\.googleapis\.com/, r => { // read-only fake; any write is logged and still answered
    const u = new URL(r.request().url()), method = r.request().method(), p = decodeURIComponent(u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''));
    w.sheetCalls.push(method + ' ' + p);
    const json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '') return json({ sheets: Object.keys(w.sheets).map(t => ({ properties: { sheetId: sids[t], title: t, gridProperties: { rowCount: 1000 } } })) });
    if (p === '/values:batchGet') return json({ valueRanges: u.searchParams.getAll('ranges').map(rg => { const a = parseA1(rg); return { range: rg, values: w.sheets[a.tab].slice(a.r0 - 1).map(row => row.slice(a.c0, a.c1 + 1)) }; }) });
    return json({});
  });
  await page.route(SBU + '/**', async r => {
    const req = r.request(), u = new URL(req.url()), method = req.method(), h = req.headers();
    const json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/auth/v1/token') { w.refreshes++; return json({ access_token: FRESH, refresh_token: 'rt2', expires_in: 3600 }); }
    if (u.pathname === '/auth/v1/logout') { w.logouts++; return r.fulfill({ status: 204, body: '' }); }
    if (u.pathname === '/auth/v1/otp') { w.otp = (w.otp || []).concat({ url: req.url(), body: JSON.parse(req.postData()) }); return w.otpFail ? json({ msg: 'email rate limit exceeded' }, 429) : json({}); }
    if (u.pathname === '/auth/v1/authorize') { w.authorize.push(req.url()); return r.fulfill({ contentType: 'text/html', body: '<p>google</p>' }); }
    const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m || !w.sb[m[1]]) return json({ message: 'no such table' }, 404);
    const t = m[1], q = u.searchParams;
    w.sbCalls.push({ method, table: t, query: u.search, body: req.postData() ? JSON.parse(req.postData()) : null, headers: h });
    if (h.authorization === 'Bearer ' + EXPIRED) { w.forced401++; return json({ message: 'JWT expired' }, 401); }
    if (h['accept-profile'] !== 'brain' && h['content-profile'] !== 'brain') return json({ message: 'wrong schema' }, 406);
    const filt = rows => { const f = q.get('row_id'); if (!f) return rows; const [op, v] = [f.split('.')[0], Number(f.split('.')[1])]; return rows.filter(x => op === 'eq' ? x.row_id === v : op === 'gt' ? x.row_id > v : true); };
    if (method === 'GET') { const off = Number(q.get('offset') || 0), lim = Math.min(Number(q.get('limit') || 1000), 1000); return json(filt(w.sb[t]).sort((a, b) => a.row_id - b.row_id).slice(off, off + lim)); }
    if (method === 'POST') { req.postDataJSON().forEach(o => w.insert(t, o)); return r.fulfill({ status: 201, body: '' }); }
    if (method === 'PATCH') { const hit = filt(w.sb[t]); const b = req.postDataJSON(); hit.forEach(x => Object.assign(x, b)); return json(hit); }
    if (method === 'DELETE') { const hit = filt(w.sb[t]); w.sb[t] = w.sb[t].filter(x => !hit.includes(x)); return (h.prefer || '').includes('representation') ? json(hit) : r.fulfill({ status: 204, body: '' }); }
    return json({}, 405);
  });
}
const seedSbBasic = w => {
  w.insert('plan', { id: 'e1', date: T, end_date: null, time: '07:00', title: 'Strength & Conditioning', category: 'Fitness', type: 'Gym', done: false, countdown: false, notes: '' });
  w.insert('plan', { id: 'e2', date: T, end_date: null, time: null, title: 'Office', category: 'Work', type: 'Routine', done: true, countdown: false, notes: '' });
  w.insert('plan', { id: 'e3', date: add(1), end_date: null, time: '15:00', title: 'Finance Coaching', category: 'Work', type: 'Work', done: false, countdown: false, notes: '' });
  w.insert('lists', { id: 'l1', list: 'Reading', item: 'A Book', status: 'Current', added: T, notes: '' });
  w.insert('lists', { id: 'l2', list: 'To book', item: 'Dentist', status: 'Open', added: add(-10), notes: '' });
  w.insert('settings', { key: 'birthday_window', value: '60', notes: '' });
};

async function scenario(browser, name, { init = {}, vp = { width: 1280, height: 900 }, url = 'https://brain.test/', setup, run }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
  const w = world(); if (setup) setup(w);
  await install(page, w);
  await page.addInitScript(i => { if (sessionStorage.getItem('__seeded')) return; sessionStorage.setItem('__seeded', '1'); Object.entries(i).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))); }, init);
  try { await page.goto(url); await run(page, w); } catch (e) { check(name + ' ran without throwing', false, String(e.message).slice(0, 300)); }
  await ctx.close();
}
const ses = (at = GOOD, exp = Date.now() + 3600e3) => ({ 'brain-sb-session': { at, rt: 'rt1', exp, email: 'me@example.com' } });
const cfgSb = { 'brain_config': { backend: 'supabase', clientId: 'abc.apps.googleusercontent.com', sheetId: 'TESTSHEET1234567890abc' } };
const live = page => page.waitForSelector('#status[data-state=live]', { timeout: 8000 });
const writes = w => w.sbCalls.filter(c => c.method !== 'GET');

(async () => {
  const b = await chromium.launch();

  // 1. Redirect return
  await scenario(b, 'redirect', { url: `https://brain.test/#access_token=${GOOD}&refresh_token=rtX&expires_in=3600&token_type=bearer`, run: async (page) => {
    await page.waitForSelector('#setDlg[open]');
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('brain-sb-session')));
    check('redirect: session saved', s && s.at === GOOD && s.rt === 'rtX' && s.email === 'me@example.com' && s.exp > Date.now() + 3000e3, s);
    check('redirect: hash removed from URL', !(await page.evaluate(() => location.hash)) && !page.url().includes('access_token'), page.url());
    check('redirect: settings says signed in as email', (await page.locator('#setMsg').innerText()).includes('Signed in to Supabase as me@example.com'), await page.locator('#setMsg').innerText());
    check('redirect: email sign-in row hidden once signed in', !(await page.locator('#sbEmail').isVisible()) && !(await page.locator('#sbIn').isVisible()));
  } });
  await scenario(b, 'redirect-error', { url: 'https://brain.test/#error=access_denied&error_description=Signups+not+allowed', run: async (page) => {
    await page.waitForSelector('#setDlg[open]');
    const m = await page.locator('#setMsg').innerText();
    check('redirect error: shows error text', m.includes('Signups not allowed'), m);
    check('redirect error: hash removed, no session', !(await page.evaluate(() => location.hash)) && !(await page.evaluate(() => localStorage.getItem('brain-sb-session'))));
  } });

  // 2. Copy Sheet -> Supabase
  const copyInit = { 'jm-google-token': { t: 'x', exp: Date.now() + 3600e3 }, 'brain_config': { clientId: 'abc.apps.googleusercontent.com', sheetId: 'TESTSHEET1234567890abc' }, ...ses() };
  const pressCopy = async page => { await page.click('#settingsBtn'); await page.waitForSelector('#setDlg[open]'); await page.click('#sbCopy'); await page.click('#sbCopy');
    await page.waitForFunction(() => /^(Copied|Copy stopped)/.test(document.getElementById('sbMsg').textContent), null, { timeout: 8000 }); return page.locator('#sbMsg').innerText(); };
  await scenario(b, 'copy', { init: copyInit, setup: w => { w.insert('plan', { id: 'old', date: T, title: 'stale row' }); }, run: async (page, w) => {
    await live(page);
    const base = w.sheetCalls.length;
    const msg = await pressCopy(page);
    const N = Object.keys(w.sheets).reduce((t, n) => t + realRows(w.sheets, n), 0);
    check(`copy: message "Copied ${N} rows and checked them"`, msg.startsWith(`Copied ${N} rows and checked them`), msg);
    const counts = Object.fromEntries(Object.keys(w.sheets).map(n => [n, realRows(w.sheets, n)]));
    check('copy: every Supabase table has the right row count', TABLES.every(t => w.sb[t].length === counts[TAB_OF[t]] && w.sb[t].length > 0), TABLES.map(t => t + ':' + w.sb[t].length));
    check('copy: stale Supabase row replaced', !w.sb.plan.some(r => r.id === 'old'));
    const l = w.sb.log.find(r => r.steps === 10000);
    check('copy: values typed correctly (date string, numbers, nulls)', l && l.date === add(-3) && l.km === 7.2 && typeof l.steps === 'number' && w.sb.plan.find(r => r.id === 'e1').end_date === null && w.sb.plan.find(r => r.id === 'e6').end_date === add(5), [l, w.sb.plan.find(r => r.id === 'e6')]);
    const wr = w.sheetCalls.filter(c => !c.startsWith('GET '));
    check('copy: zero write calls to the Sheets fake', wr.length === 0, wr);
    check('copy: Sheet was read', w.sheetCalls.length > base);
  } });
  await scenario(b, 'copy-dupe', { init: copyInit, setup: w => { w.sheets.Plan.splice(2, 0, ['e1', serial(T), '', '', 'Duplicate', 'Work', 'Work', false, false, '']); w.insert('plan', { id: 'keep', date: T, title: 'keep me' }); }, run: async (page, w) => {
    await live(page);
    const msg = await pressCopy(page);
    check('copy duplicate: refused naming the id', /Copy stopped/.test(msg) && /Plan: e1/.test(msg), msg);
    check('copy duplicate: nothing written to Supabase', writes(w).length === 0 && w.sb.plan.length === 1 && w.sb.plan[0].id === 'keep', writes(w).length);
    check('copy duplicate: zero Sheets writes', w.sheetCalls.every(c => c.startsWith('GET ')));
  } });

  // 3. Supabase mode
  await scenario(b, 'sbmode', { init: { ...cfgSb, ...ses() }, setup: seedSbBasic, run: async (page, w) => {
    await live(page);
    check('sbmode: status starts "Supabase ·"', (await page.locator('#statusText').innerText()).startsWith('Supabase ·'), await page.locator('#statusText').innerText());
    await page.click('.tab[data-tab=week]'); await page.waitForTimeout(150);
    check('sbmode: week view shows seeded plan items', (await page.locator('#days').innerText()).includes('Finance Coaching') && (await page.locator('#focusPanel').innerText()).includes('Strength & Conditioning'));
    check('sbmode: sends apikey, bearer and schema headers', w.sbCalls.every(c => c.headers.apikey && c.headers.authorization === 'Bearer ' + GOOD && c.headers['accept-profile'] === 'brain'));
    const before = w.sbCalls.length;
    await page.locator('#v-week [data-tick="e1"]').check(); await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live' && /Supabase/.test(document.getElementById('statusText').textContent));
    await page.waitForTimeout(300);
    const p = w.sbCalls.slice(before).filter(c => c.method === 'PATCH');
    check('sbmode: tick -> exactly one PATCH with only `done`', p.length === 1 && p[0].table === 'plan' && JSON.stringify(p[0].body) === '{"done":true}' && /row_id=eq\.1$/.test(p[0].query), p.map(x => [x.query, x.body]));
    check('sbmode: tick persisted', w.sb.plan.find(r => r.id === 'e1').done === true);
    await page.click('.tab[data-tab=lists]');
    const b2 = w.sbCalls.length;
    await page.fill('form[data-list="Watching"] input', 'New Show'); await page.click('form[data-list="Watching"] button');
    await page.waitForFunction(() => document.getElementById('lists').innerText.includes('New Show'));
    const po = w.sbCalls.slice(b2).filter(c => c.method === 'POST');
    check('sbmode: list add -> POST to lists', po.length === 1 && po[0].table === 'lists' && po[0].body.length === 1 && po[0].body[0].item === 'New Show' && po[0].body[0].status === 'Up next' && /^\d{4}-\d{2}-\d{2}$/.test(po[0].body[0].added), po);
    const dentist = w.sb.lists.find(r => r.item === 'Dentist');
    const b3 = w.sbCalls.length;
    const x = page.locator(`[data-ldel="l2"]`); await x.click(); check('sbmode: first press arms Remove?', (await x.innerText()) === 'Remove?'); await x.click();
    await page.waitForFunction(() => !document.getElementById('lists').innerText.includes('Dentist'));
    const d = w.sbCalls.slice(b3).filter(c => c.method === 'DELETE');
    check('sbmode: remove list item -> DELETE row_id=eq.N', d.length === 1 && d[0].table === 'lists' && d[0].query === `?row_id=eq.${dentist.row_id}`, d.map(x => x.query));
    check('sbmode: zero calls to sheets.googleapis.com', w.sheetCalls.length === 0, w.sheetCalls);
  } });

  // 3b. Setup tab in Supabase mode
  await scenario(b, 'setup', { init: { ...cfgSb, ...ses() }, setup: w => { seedSbBasic(w); w.insert('routine', { day: 'Mon', category: 'Fitness', time: '', title: '12000 steps', active: true }); w.insert('routine', { day: 'Tue', category: 'Work', time: '07:00', title: 'Kickboxing', active: true }); w.insert('links', { name: 'Books', category: 'Entertainment', url: 'https://example.com/books', pin: true, sort_order: 1, notes: '' }); }, run: async (page, w) => {
    await live(page); await page.click('.tab[data-tab=setup]'); await page.waitForSelector('[data-srow=Routine]');
    const id = w.sb.routine.find(r => r.title === 'Kickboxing').row_id, b0 = w.sbCalls.length;
    await page.locator(`[data-srow=Routine][data-row="${id}"] [name=time]`).fill('8am'); await page.locator(`[data-srow=Routine][data-row="${id}"] button[type=submit]`).click();
    await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live' && /Supabase/.test(document.getElementById('statusText').textContent)); await page.waitForTimeout(300);
    const p = w.sbCalls.slice(b0).filter(c => c.method !== 'GET');
    check('setup sb: one PATCH with only the changed column', p.length === 1 && p[0].method === 'PATCH' && p[0].table === 'routine' && p[0].query === `?row_id=eq.${id}` && JSON.stringify(p[0].body) === '{"time":"08:00"}', p.map(x => [x.method, x.query, x.body]));
    const b1 = w.sbCalls.length;
    await page.fill('[data-sadd=Links] [name=name]', 'Weather'); await page.fill('[data-sadd=Links] [name=url]', 'https://example.com/w'); await page.click('[data-sadd=Links] button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('[data-srow=Links]').length === 2); await page.waitForTimeout(200);
    const q = w.sbCalls.slice(b1).filter(c => c.method !== 'GET');
    check('setup sb: add link -> one POST to links', q.length === 1 && q[0].method === 'POST' && q[0].table === 'links' && q[0].body.length === 1 && q[0].body[0].name === 'Weather' && q[0].body[0].url === 'https://example.com/w' && q[0].body[0].pin === false, q.map(x => [x.method, x.table, x.body]));
    check('setup sb: zero Sheets calls', w.sheetCalls.length === 0);
  } });

  // 4. Pagination
  await scenario(b, 'paging', { init: { ...cfgSb, ...ses() }, setup: w => { seedSbBasic(w); for (let i = 0; i < 2300; i++) w.insert('log', { date: add(-4000 + i), steps: 1000 + i, km: 1.5, active_mins: null, pages: null, max_c: null, min_c: null, mood: '', note: '' }); }, run: async (page, w) => {
    await live(page);
    const n = await page.evaluate(() => state.data.Log.length);
    check('paging: all 2300 log rows loaded', n === 2300, n);
    const gets = w.sbCalls.filter(c => c.table === 'log' && c.method === 'GET').map(c => /offset=(\d+)/.exec(c.query)[1]);
    check('paging: log fetched in 3 pages', gets.join() === '0,1000,2000', gets);
    check('paging: order preserved (first/last)', await page.evaluate(() => state.data.Log[0].steps === 1000 && state.data.Log[2299].steps === 3299));
  } });

  // 5. Token refresh
  await scenario(b, 'refresh-expired', { init: { ...cfgSb, ...ses(EXPIRED, Date.now() - 1000) }, setup: seedSbBasic, run: async (page, w) => {
    await live(page);
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('brain-sb-session')));
    check('refresh: expired session -> exactly one refresh call', w.refreshes === 1, w.refreshes);
    check('refresh: new token stored (and refresh token rotated)', s.at === FRESH && s.rt === 'rt2' && s.exp > Date.now(), s);
    check('refresh: data loaded with new token, expired token never sent', w.forced401 === 0 && w.sbCalls.length > 0 && w.sbCalls.every(c => c.headers.authorization === 'Bearer ' + FRESH));
  } });
  await scenario(b, 'refresh-401', { init: { ...cfgSb, ...ses(EXPIRED, Date.now() + 3600e3) }, setup: seedSbBasic, run: async (page, w) => {
    await live(page);
    check('401: one forced refresh', w.refreshes === 1, w.refreshes);
    check('401: retried with new token and loaded', (await page.evaluate(() => state.data.Plan.length)) === 3 && w.sbCalls.some(c => c.headers.authorization === 'Bearer ' + FRESH), w.forced401);
  } });

  // 6. Signed out in Supabase mode
  await scenario(b, 'signedout', { init: { ...cfgSb }, run: async (page, w) => {
    await page.waitForSelector('#notice:not([hidden])');
    check('signed out: refresh button reads Connect', (await page.locator('#refreshBtn').innerText()) === 'Connect');
    check('signed out: notice mentions Supabase', (await page.locator('#notice').innerText()).includes('Supabase'));
    await page.click('#refreshBtn');
    await page.waitForSelector('#setDlg[open]');
    check('signed out: Connect opens Settings with sign-in options', await page.locator('#sbEmail').isVisible() && await page.locator('#sbIn').isVisible() && (await page.locator('#setMsg').innerText()).includes('Sign in to Supabase'));
    await page.click('#sbMail');
    check('email: asks for an address when empty', (await page.locator('#sbMsg').innerText()).includes('Type your email'));
    await page.fill('#sbEmail', 'me@example.com'); await page.click('#sbMail');
    await page.waitForFunction(() => document.getElementById('sbMsg').textContent.includes('Check your email'));
    const o = (w.otp || [])[0], ou = o && new URL(o.url);
    check('email: sends one link request to Supabase', w.otp && w.otp.length === 1 && o.body.email === 'me@example.com' && o.body.create_user === true && ou.searchParams.get('redirect_to') === 'https://brain.test/', o);
    check('email: remembers the address in this browser', (await page.evaluate(() => JSON.parse(localStorage.getItem('brain_config')).sbEmail)) === 'me@example.com');
    w.otpFail = true; await page.click('#sbMail');
    await page.waitForFunction(() => document.getElementById('sbMsg').textContent.includes('Couldn'));
    check('email: rate limit explained', (await page.locator('#sbMsg').innerText()).includes('too many emails'));
    const req = page.waitForRequest(r => r.url().includes('/auth/v1/authorize'));
    await page.click('#sbIn');
    const u = new URL((await req).url());
    check('signed out: Google button goes to Supabase Google authorize', u.origin === SBU && u.pathname === '/auth/v1/authorize' && u.searchParams.get('provider') === 'google' && u.searchParams.get('redirect_to') === 'https://brain.test/', u.href);
    check('signed out: no data calls made', w.sbCalls.length === 0 && w.sheetCalls.length === 0);
  } });

  // 7. Layout
  for (const [label, width] of [['phone', 390], ['laptop', 1280]]) {
    await scenario(b, 'layout-' + label, { init: { ...cfgSb, ...ses() }, vp: { width, height: 900 }, setup: seedSbBasic, run: async (page) => {
      await live(page); await page.click('#settingsBtn'); await page.waitForSelector('#setDlg[open]');
      const m = await page.evaluate(() => { const d = document.getElementById('setDlg').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, dl: d.left, dr: d.right }; });
      check(`layout ${width}px: no horizontal scroll`, m.sw <= m.iw + 1, m);
      check(`layout ${width}px: dialog inside viewport`, m.dl >= -1 && m.dr <= m.iw + 1, m);
      await page.screenshot({ path: path.join(OUT, `shot-sb-settings-${width}.png`) });
    } });
  }

  check('no page errors', errors.length === 0, errors);
  console.log(log.join('\n'));
  await b.close();
  if (log.some(l => l.startsWith('FAIL'))) process.exit(1);
})();
