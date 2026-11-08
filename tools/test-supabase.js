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
    Notes: [['ID', 'Date', 'Topic', 'Note', 'Links', 'Color', 'Pos'], ['n1', serial(add(-5)), 'Ideas', 'Line one\nLine two', '', '', '']],
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
  const w = { sheets: sheetsDb(), sheetCalls: [], sb: {}, sbCalls: [], nextId: 1, refreshes: 0, logouts: 0, forced401: 0, authorize: [], sharedCalls: [], activity: [] };
  w.feed = (date, amount, extra = {}) => w.activity.push({ date, app: 'books', item_id: 1, title: 'A Book', amount, unit: 'pages', logged_at: date + 'T10:00:00Z', source: 'tracker', note: null, ...extra });
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
  // fake Supabase Realtime: answers joins and heartbeats; tests push postgres_changes through w.rt.push
  w.rt = { socks: [], joins: [], tokens: [], push(rec) { this.socks.forEach(ws => ws.send(JSON.stringify({ topic: 'realtime:brain', event: 'postgres_changes', payload: { data: rec }, ref: null }))); } };
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, ws => { w.rt.socks.push(ws); w.rt.url = ws.url();
    ws.onMessage(m => { let o; try { o = JSON.parse(m); } catch (e) { return; }
      if (o.event === 'phx_join') { w.rt.joins.push(o.payload); ws.send(JSON.stringify({ topic: o.topic, event: 'phx_reply', payload: w.rtFail ? { status: 'error', response: { reason: 'no publication' } } : { status: 'ok', response: { postgres_changes: [{ id: 1, event: '*', schema: 'brain' }] } }, ref: o.ref })); }
      else if (o.event === 'access_token') w.rt.tokens.push(o.payload.access_token);
      else if (o.event === 'heartbeat') ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: o.ref })); });
    ws.onClose(() => { w.rt.socks = w.rt.socks.filter(x => x !== ws); }); });
  await page.route(SBU + '/**', async r => {
    const req = r.request(), u = new URL(req.url()), method = req.method(), h = req.headers();
    const json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') { const b = JSON.parse(req.postData()); w.pwTries = (w.pwTries || []).concat(b);
      return b.password === 'correct horse battery staple' && b.email === 'me@example.com' ? json({ access_token: GOOD, refresh_token: 'rtP', expires_in: 3600, token_type: 'bearer' }) : json({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400); }
    if (u.pathname === '/auth/v1/user' && method === 'PUT') { w.pwSet = { auth: h.authorization, apikey: h.apikey, body: JSON.parse(req.postData()) }; return json({ id: 'u1', email: 'me@example.com' }); }
    if (u.pathname === '/auth/v1/token') { w.refreshes++; if (w.onRefresh) await w.onRefresh(); if (w.refreshStatus) return json({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, w.refreshStatus); return json({ access_token: FRESH, refresh_token: 'rt2', expires_in: 3600 }); }
    if (u.pathname === '/auth/v1/logout') { w.logouts++; return r.fulfill({ status: 204, body: '' }); }
    if (u.pathname === '/auth/v1/otp') { w.otp = (w.otp || []).concat({ url: req.url(), body: JSON.parse(req.postData()) }); return w.otpFail ? json({ msg: 'email rate limit exceeded' }, 429) : json({}); }
    if (u.pathname === '/auth/v1/authorize') { w.authorize.push(req.url()); return r.fulfill({ contentType: 'text/html', body: '<p>google</p>' }); }
    if (u.pathname === '/rest/v1/activity') { // the Library's view in schema `shared`: read-only; every call is logged apart from the brain calls
      w.sharedCalls.push({ method, query: u.search, headers: h, body: req.postData() });
      if (h.authorization === 'Bearer ' + EXPIRED) { w.forced401++; return json({ message: 'JWT expired' }, 401); }
      if (w.noView) return json({ code: 'PGRST205', message: "Could not find the table 'shared.activity' in the schema cache" }, 404);
      if (h['accept-profile'] !== 'shared') return json({ message: 'wrong schema' }, 406);
      if (method !== 'GET') return json({ message: 'a view cannot be written' }, 405);
      const q = u.searchParams, app = (q.get('app') || '').replace(/^eq\./, ''), cols = (q.get('select') || '*').split(','), off = Number(q.get('offset') || 0), lim = Math.min(Number(q.get('limit') || 1000), 1000);
      const rows = w.activity.filter(x => !app || x.app === app).sort((a, b) => a.date.localeCompare(b.date) || a.logged_at.localeCompare(b.logged_at)).map(x => cols[0] === '*' ? x : Object.fromEntries(cols.map(c => [c, x[c]])));
      return json(rows.slice(off, off + lim));
    }
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
  w.insert('notes', { id: 'n1', date: add(-5), topic: 'Ideas', note: 'Line one\nLine two', links: null, color: null, pos: null });
  w.insert('settings', { key: 'birthday_window', value: '60', notes: '' });
};

async function scenario(browser, name, { init = {}, vp = { width: 1280, height: 900 }, url = 'https://brain.test/', setup, run }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
  const w = world(); w.page = page; w.warns = []; page.on('console', m => { if (m.type() === 'warning') w.warns.push(m.text()); }); if (setup) setup(w);
  await install(page, w);
  await page.addInitScript(i => { if (sessionStorage.getItem('__seeded')) return; sessionStorage.setItem('__seeded', '1'); Object.entries(i).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))); }, init);
  try { await page.goto(url); await run(page, w); } catch (e) { check(name + ' ran without throwing', false, String(e.message).slice(0, 300)); }
  await ctx.close();
}
const ses = (at = GOOD, exp = Date.now() + 3600e3) => ({ 'jcm-sb-session': { at, rt: 'rt1', exp, email: 'me@example.com' } });
const cfgSb = { 'brain_config': { backend: 'supabase', clientId: 'abc.apps.googleusercontent.com', sheetId: 'TESTSHEET1234567890abc' } };
const live = page => page.waitForSelector('#status[data-state=live]', { timeout: 8000 });
const writes = w => w.sbCalls.filter(c => c.method !== 'GET');

(async () => {
  const b = await chromium.launch();

  // 1. Redirect return
  await scenario(b, 'redirect', { url: `https://brain.test/#access_token=${GOOD}&refresh_token=rtX&expires_in=3600&token_type=bearer`, run: async (page) => {
    await page.waitForSelector('#setDlg[open]');
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('jcm-sb-session')));
    check('redirect: session saved', s && s.at === GOOD && s.rt === 'rtX' && s.email === 'me@example.com' && s.exp > Date.now() + 3000e3, s);
    check('redirect: hash removed from URL', !(await page.evaluate(() => location.hash)) && !page.url().includes('access_token'), page.url());
    check('redirect: settings says signed in as email', (await page.locator('#setMsg').innerText()).includes('Signed in to Supabase as me@example.com'), await page.locator('#setMsg').innerText());
    check('redirect: email sign-in row hidden once signed in', !(await page.locator('#sbEmail').isVisible()) && !(await page.locator('#sbIn').isVisible()));
  } });
  await scenario(b, 'redirect-error', { url: 'https://brain.test/#error=access_denied&error_description=Signups+not+allowed', run: async (page) => {
    await page.waitForSelector('#setDlg[open]');
    const m = await page.locator('#setMsg').innerText();
    check('redirect error: shows error text', m.includes('Signups not allowed'), m);
    check('redirect error: hash removed, no session', !(await page.evaluate(() => location.hash)) && !(await page.evaluate(() => localStorage.getItem('jcm-sb-session'))));
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
    check('sbmode: home shows seeded plan items', (await page.locator('#nextBody').textContent()).includes('Finance Coaching') && (await page.locator('#homeToday').innerText()).includes('Strength & Conditioning'));
    check('sbmode: sends apikey, bearer and schema headers', w.sbCalls.every(c => c.headers.apikey && c.headers.authorization === 'Bearer ' + GOOD && c.headers['accept-profile'] === 'brain'));
    const before = w.sbCalls.length;
    await page.locator('#homeToday [data-tick="e1"]').check(); await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live' && /Supabase/.test(document.getElementById('statusText').textContent));
    await page.waitForTimeout(300);
    const p = w.sbCalls.slice(before).filter(c => c.method === 'PATCH');
    check('sbmode: tick -> exactly one PATCH with only `done`', p.length === 1 && p[0].table === 'plan' && JSON.stringify(p[0].body) === '{"done":true}' && /row_id=eq\.1$/.test(p[0].query), p.map(x => [x.query, x.body]));
    check('sbmode: tick persisted', w.sb.plan.find(r => r.id === 'e1').done === true);
    await page.click('.tab[data-tab=notes]');
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
    const b4 = w.sbCalls.length;
    await page.click('[data-ik="n:n1"]'); await page.click('[aria-label="Colour: Teal"]');
    await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live'); await page.waitForTimeout(300);
    const pc = w.sbCalls.slice(b4).filter(c => c.method === 'PATCH');
    check('sbmode: note colour -> exactly one PATCH with only `color`', pc.length === 1 && pc[0].table === 'notes' && JSON.stringify(pc[0].body) === '{"color":"teal"}', pc.map(x => [x.query, x.body]));
    check('sbmode: zero calls to sheets.googleapis.com', w.sheetCalls.length === 0, w.sheetCalls);
  } });

  // 3a. Live sync: a change on another device shows here without pressing Refresh
  await scenario(b, 'realtime', { init: { ...cfgSb, ...ses() }, setup: seedSbBasic, run: async (page, w) => {
    await live(page); await page.waitForFunction(() => document.querySelector('#status .dot[data-sync]'), null, { timeout: 5000 });
    const j = w.rt.joins[0] || {};
    check('realtime: joins with the signed-in token and listens to the brain schema only', w.rt.joins.length === 1 && j.access_token === GOOD && JSON.stringify(j.config.postgres_changes) === JSON.stringify([{ event: '*', schema: 'brain' }]) && /apikey=/.test(w.rt.url) && /^wss:/.test(w.rt.url), [j, w.rt.url]);
    check('realtime: the status dot shows live sync is on', /Live sync on/.test(await page.getAttribute('#status .dot', 'title')));
    // another device adds a plan item
    w.insert('plan', { id: 'e9', date: T, end_date: null, time: '12:00', title: 'Lunch from the phone', category: 'Social', type: 'Social', done: false, countdown: false, notes: '' });
    const g0 = w.sbCalls.filter(c => c.method === 'GET').length;
    w.rt.push({ table: 'plan', type: 'INSERT', schema: 'brain' });
    await page.waitForFunction(() => document.getElementById('homeToday').innerText.includes('Lunch from the phone'), null, { timeout: 5000 }).catch(() => {});
    check('realtime: a change from another device appears without pressing Refresh', (await page.locator('#homeToday').innerText()).includes('Lunch from the phone'));
    check('realtime: one reload per burst of changes', await (async () => { const g1 = w.sbCalls.filter(c => c.method === 'GET').length; w.rt.push({ table: 'plan', type: 'UPDATE' }); w.rt.push({ table: 'plan', type: 'UPDATE' }); w.rt.push({ table: 'log', type: 'UPDATE' }); await page.waitForTimeout(1600); const g2 = w.sbCalls.filter(c => c.method === 'GET').length; return g1 > g0 && g2 - g1 > 0 && g2 - g1 === g1 - g0; })());
    // our own save: its echo doesn't cause a second reload
    await page.locator('#homeToday [data-tick="e1"]').check(); await live(page);
    const g3 = w.sbCalls.filter(c => c.method === 'GET').length;
    w.rt.push({ table: 'plan', type: 'UPDATE' }); await page.waitForTimeout(1400);
    check('realtime: the echo of our own save is ignored', w.sbCalls.filter(c => c.method === 'GET').length === g3);
    // the socket drops: it reconnects by itself
    w.rt.socks.forEach(ws => ws.close()); await page.waitForTimeout(300);
    check('realtime: dot drops back when the socket closes', !(await page.$('#status .dot[data-sync]')));
    await page.waitForFunction(() => document.querySelector('#status .dot[data-sync]'), null, { timeout: 6000 }).catch(() => {});
    check('realtime: reconnects by itself', w.rt.joins.length === 2 && !!(await page.$('#status .dot[data-sync]')));
  } });
  await scenario(b, 'realtime-off', { init: { ...cfgSb, ...ses() }, setup: w => { seedSbBasic(w); w.rtFail = true; }, run: async (page, w) => {
    await live(page); await page.waitForTimeout(400);
    check('realtime: if the tables are not published yet, the app still works and just shows no sync', !(await page.$('#status .dot[data-sync]')) && (await page.locator('#homeToday').innerText()).includes('Strength'));
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
    await page.click('[data-ssec=Links]'); await page.waitForSelector('[data-sadd=Links]');
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
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('jcm-sb-session')));
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

  // 6b. Sign in with email and password (works inside a home-screen app); set the password while signed in
  await scenario(b, 'password', { init: { ...cfgSb }, setup: seedSbBasic, run: async (page, w) => {
    await page.waitForSelector('#notice:not([hidden])'); await page.click('#refreshBtn'); await page.waitForSelector('#setDlg[open]');
    check('password: sign-in box shown while signed out, set-password box hidden', await page.locator('#sbPw').isVisible() && !(await page.locator('#sbNewPw').isVisible()) && !(await page.locator('#sbCheck').isVisible()));
    await page.click('#sbPwIn'); check('password: asks for the email first', (await page.locator('#sbMsg').innerText()).includes('Type your email'));
    await page.fill('#sbEmail', 'me@example.com'); await page.click('#sbPwIn'); check('password: asks for the password', (await page.locator('#sbMsg').innerText()).includes('Type your password'));
    await page.fill('#sbPw', 'not the password'); await page.click('#sbPwIn'); await page.waitForFunction(() => document.getElementById('sbMsg').textContent.includes('Couldn'));
    check('password: wrong password explained, still signed out', (await page.locator('#sbMsg').innerText()).includes('didn\'t match') && !(await page.evaluate(() => localStorage.getItem('jcm-sb-session'))));
    await page.fill('#sbPw', 'correct horse battery staple'); await page.press('#sbPw', 'Enter'); await page.waitForFunction(() => document.getElementById('sbMsg').textContent.includes('Signed in to Supabase'));
    const t = (w.pwTries || []).slice(-1)[0], s = await page.evaluate(() => JSON.parse(localStorage.getItem('jcm-sb-session')));
    check('password: Enter signs in, session kept, dialog still open', t.email === 'me@example.com' && s && s.at === GOOD && s.rt === 'rtP' && s.email === 'me@example.com' && await page.isVisible('#setDlg[open]'), [t, s]);
    check('password: password box emptied and never stored', (await page.inputValue('#sbPw')) === '' && !(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes('correct horse'));
    check('password: sign-in rows hide, set-password and Check show', !(await page.locator('#sbPwRow').isVisible()) && await page.locator('#sbSetRow').isVisible() && await page.locator('#sbCheck').isVisible());
    await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live', null, { timeout: 8000 });
    check('password: this device then loads Supabase data', w.sbCalls.some(c => c.method === 'GET'));
  } });
  await scenario(b, 'setpw', { init: { ...cfgSb, ...ses() }, setup: seedSbBasic, run: async (page, w) => {
    await live(page); await page.click('#settingsBtn'); await page.waitForSelector('#setDlg[open]');
    await page.fill('#sbNewPw', 'short'); await page.click('#sbSetPw');
    check('set password: too short is refused locally, nothing sent', (await page.locator('#sbMsg').innerText()).includes('at least 12') && !w.pwSet);
    await page.fill('#sbNewPw', 'four random words here'); await page.press('#sbNewPw', 'Enter'); await page.waitForFunction(() => document.getElementById('sbMsg').textContent.includes('Password set'));
    check('set password: sent once with this session, Enter did not close Settings', w.pwSet && w.pwSet.auth === 'Bearer ' + GOOD && w.pwSet.body.password === 'four random words here' && await page.isVisible('#setDlg[open]'), w.pwSet);
    check('set password: box emptied and the password is not kept in the browser', (await page.inputValue('#sbNewPw')) === '' && !(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes('four random'));
    await page.screenshot({ path: path.join(OUT, 'shot-sb-password.png') });
  } });

  // 6c. Check: Sheet against Supabase, read-only
  await scenario(b, 'check', { init: copyInit, run: async (page, w) => {
    await page.click('#settingsBtn'); await page.waitForSelector('#setDlg[open]');
    const say = async () => page.locator('#sbMsg').innerText();
    await page.click('#sbCheck'); await page.waitForFunction(() => /differ|match/.test(document.getElementById('sbMsg').textContent));
    let m = await say();
    check('check: empty Supabase reads as different, tab by tab, in plain words', m.startsWith('They differ') && /✗ Plan: Sheet 5 · Supabase 0 \(5 only in the Sheet\)/.test(m) && /using the Sheet on this device/.test(m), m);
    await page.click('#sbCopy'); await page.click('#sbCopy'); await page.waitForFunction(() => /^(Copied|Copy stopped)/.test(document.getElementById('sbMsg').textContent), null, { timeout: 8000 });
    await page.click('#sbCheck'); await page.waitForFunction(() => /match on every tab/.test(document.getElementById('sbMsg').textContent), null, { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, 'shot-sb-check.png') });
    m = await say(); check('check: after the copy every tab matches', /^Supabase and your Sheet match on every tab/.test(m) && !/✗/.test(m) && /✓ Plan/.test(m), m);
    await page.evaluate(() => 0); w.insert('plan', { id: 'extra', date: T, title: 'only here' });
    await page.click('#sbCheck'); await page.waitForFunction(() => /differ/.test(document.getElementById('sbMsg').textContent), null, { timeout: 8000 });
    check('check: a row only in Supabase is named', /✗ Plan: .*1 only in Supabase/.test(await say()), await say());
    check('check: never writes to the Sheet', w.sheetCalls.every(c => c.startsWith('GET ') || c.startsWith('GET')), w.sheetCalls.filter(c => !c.startsWith('GET')));
  } });

  // 8. Shared sign-in: one session key for every jcm-book-library app
  const OLD_SES = (at = GOOD, rt = 'rt1') => ({ 'brain-sb-session': { at, rt, exp: Date.now() + 3600e3, email: 'me@example.com' } });
  await scenario(b, 'migrate-old-key', { init: { ...cfgSb, ...OLD_SES() }, setup: seedSbBasic, run: async (page, w) => {
    await live(page);
    const m = await page.evaluate(() => ({ nu: JSON.parse(localStorage.getItem('jcm-sb-session')), old: localStorage.getItem('brain-sb-session') }));
    check('migrate: an old brain-sb-session is moved to jcm-sb-session (owner stays signed in)', m.nu && m.nu.at === GOOD && m.nu.rt === 'rt1' && m.nu.email === 'me@example.com', m);
    check('migrate: the old key is removed', m.old === null, m);
    check('migrate: data loaded with the moved session, no sign-in asked for', w.sbCalls.length > 0 && w.sbCalls.every(c => c.headers.authorization === 'Bearer ' + GOOD) && w.refreshes === 0);
  } });
  await scenario(b, 'migrate-both-keys', { init: { ...cfgSb, ...ses(), ...OLD_SES('OLD_AT', 'rtOLD') }, setup: seedSbBasic, run: async (page, w) => {
    await live(page);
    const m = await page.evaluate(() => ({ nu: JSON.parse(localStorage.getItem('jcm-sb-session')), old: localStorage.getItem('brain-sb-session') }));
    check('migrate: with both keys, jcm-sb-session is kept as it was', m.nu && m.nu.at === GOOD && m.nu.rt === 'rt1', m);
    check('migrate: with both keys, the old one is removed', m.old === null, m);
  } });
  await scenario(b, 'signout-note', { init: { ...cfgSb, ...ses() }, setup: seedSbBasic, run: async (page, w) => {
    await live(page); await page.click('#settingsBtn'); await page.waitForSelector('#setDlg[open]');
    check('sign out: the note about every jcm-book-library app is shown with the button', await page.locator('#sbOut').isVisible() && (await page.locator('#sbOutNote').innerText()) === 'This signs you out of every jcm-book-library app on this device.', await page.locator('#sbOutNote').innerText());
    await page.click('#sbOut'); await page.waitForFunction(() => /Signed out/.test(document.getElementById('sbMsg').textContent));
    check('sign out: the shared session key is removed and the server is told', (await page.evaluate(() => localStorage.getItem('jcm-sb-session'))) === null && w.logouts === 1);
    check('sign out: the note hides with the button', !(await page.locator('#sbOutNote').isVisible()));
  } });
  await scenario(b, 'token-concurrent', { init: { ...cfgSb, ...ses() }, setup: seedSbBasic, run: async (page, w) => {
    await live(page); await page.waitForTimeout(200); w.refreshes = 0;
    const r = await page.evaluate(() => Promise.all([sb.token(true), sb.token(true)]));
    check('token: two concurrent sb.token(true) make exactly one refresh request', w.refreshes === 1 && r[0] === FRESH && r[1] === FRESH, [w.refreshes, r]);
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('jcm-sb-session')));
    check('token: the rotated session is stored under the shared key', s.at === FRESH && s.rt === 'rt2', s);
  } });
  await scenario(b, 'token-lock', { init: { ...cfgSb, ...ses() }, setup: seedSbBasic, run: async (page, w) => {
    await live(page); await page.waitForTimeout(200); w.refreshes = 0;
    const r = await page.evaluate(async () => {
      let release; const held = new Promise(res => { release = res; }), got = new Promise(res => { navigator.locks.request('jcm-sb-refresh', async () => { res(); await held; }); });
      await got;                                            // another app holds the refresh lock
      const p = sb.token(true); await new Promise(x => setTimeout(x, 150));
      localStorage.setItem('jcm-sb-session', JSON.stringify({ at: 'NEWER_AT', rt: 'rtNEWER', exp: Date.now() + 3600e3, email: 'me@example.com' }));
      release(); return p;                                  // it refreshed while we waited
    });
    check('token: waits for the lock, then uses the session the other app stored (no refresh request)', r === 'NEWER_AT' && w.refreshes === 0, [r, w.refreshes]);
  } });
  await scenario(b, 'refresh-400-newer', { init: { ...cfgSb, ...ses(EXPIRED, Date.now() - 1000) }, setup: w => { seedSbBasic(w); w.refreshStatus = 400;
      w.onRefresh = () => w.page.evaluate(() => localStorage.setItem('jcm-sb-session', JSON.stringify({ at: 'NEWER_AT', rt: 'rtNEWER', exp: Date.now() + 3600e3, email: 'me@example.com' }))); }, run: async (page, w) => {
    await live(page);
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('jcm-sb-session')));
    check('refresh 400: when another app already stored a newer session, keep it instead of signing out', s && s.rt === 'rtNEWER' && w.refreshes === 1, [s, w.refreshes]);
    check('refresh 400: data loaded with the newer session', w.sbCalls.length > 0 && w.sbCalls.every(c => c.headers.authorization === 'Bearer NEWER_AT') && (await page.evaluate(() => state.data.Plan.length)) === 3);
  } });
  await scenario(b, 'refresh-400-alone', { init: { ...cfgSb, ...ses(EXPIRED, Date.now() - 1000) }, setup: w => { seedSbBasic(w); w.refreshStatus = 400; }, run: async (page, w) => {
    await page.waitForSelector('#notice:not([hidden])');
    check('refresh 400: with no newer session, signs out as before', (await page.evaluate(() => localStorage.getItem('jcm-sb-session'))) === null && (await page.locator('#refreshBtn').innerText()) === 'Connect' && (await page.locator('#notice').innerText()).includes('Supabase') && w.sbCalls.length === 0);
  } });

  // 9. Pages from The Library (shared.activity)
  const feedSetup = w => { seedSbBasic(w);
    w.insert('log', { date: '2025-03-10', steps: 5000, km: 3, active_mins: 30, pages: 120, max_c: null, min_c: null, mood: 'G', note: '' });   // typed pages beat the feed
    w.insert('log', { date: '2025-03-11', steps: 6000, km: null, active_mins: null, pages: null, max_c: null, min_c: null, mood: 'F', note: '' }); // blank pages: the feed applies
    w.feed('2025-03-10', 30); w.feed('2025-03-10', 40);                                     // summed per day = 70, ignored
    w.feed('2025-03-11', 50);
    w.feed('2025-03-12', 25);                                                               // no Log row at all
    w.feed('2025-03-13', 999, { app: 'other' });                                            // another app: not read
    w.feed(T, 77);                                                                          // today, no Log row
  };
  const FEED_SHOWN = [['2025-03-10', 70], ['2025-03-11', 50], ['2025-03-12', 25]];
  await scenario(b, 'feed', { init: { ...cfgSb, ...ses() }, setup: feedSetup, run: async (page, w) => {
    await live(page);
    const sc = w.sharedCalls[0] || {};
    check('feed: read once with the signed-in token, schema `shared`, filtered to app=books', w.sharedCalls.length === 1 && sc.method === 'GET' && sc.headers['accept-profile'] === 'shared' && sc.headers.authorization === 'Bearer ' + GOOD && sc.headers.apikey && /select=date,amount/.test(decodeURIComponent(sc.query)) && /app=eq\.books/.test(sc.query) && /limit=1000/.test(sc.query), sc);
    const f = await page.evaluate(() => [...state.feed.entries()]);
    check('feed: amounts summed per date into state.feed (other apps left out)', JSON.stringify(Object.fromEntries(f)) === JSON.stringify({ '2025-03-10': 70, '2025-03-11': 50, '2025-03-12': 25, [T]: 77 }), f);
    check('feed: state.data.Log is only what was typed (no feed-only rows, typed null stays null)', await page.evaluate(() => state.data.Log.length === 2 && state.data.Log.find(r => r.date === '2025-03-11').pages === null && state.data.Log.find(r => r.date === '2025-03-10').pages === 120));
    // Home: today's feed-only day counts in the average
    check('feed: Home "Average pages read" counts a feed-only day', (await page.locator('#homeStats [data-stat=pages] .big').innerText()).startsWith('77'), await page.locator('#homeStats [data-stat=pages] .big').innerText());
    // Fitness: month tile, grid, year table, trend chart
    await page.click('.tab[data-tab=fitness]');
    await page.evaluate(() => { state.month = '2025-03'; renderMonth(); });
    const tile = await page.locator('#monthPanel .tile', { hasText: 'Pages' }).first().locator('.num').innerText();
    check('feed: month total pages = typed 120 + feed 50 + feed-only 25 (typed beats the feed)', tile === '195', tile);
    check('feed: year-to-date line includes feed pages', (await page.locator('#monthPanel .ytd').innerText()).includes('195 pages'), await page.locator('#monthPanel .ytd').innerText());
    const cell = d => page.locator(`.mgrid .v[data-logday="${d}"]`).nth(3);
    check('feed: grid shows the typed 120 (no marker) on 10 Mar, feed 50 on 11 Mar and feed-only 25 on 12 Mar', (await cell('2025-03-10').innerText()) === '120' && (await cell('2025-03-11').innerText()) === '50' && (await cell('2025-03-12').innerText()) === '25');
    check('feed: feed pages carry the "From The Library" label; typed ones do not', (await cell('2025-03-11').getAttribute('title')).includes('From The Library') && (await cell('2025-03-12').getAttribute('title')).includes('From The Library') && !(await cell('2025-03-10').getAttribute('title')).includes('From The Library') && (await cell('2025-03-10').getAttribute('data-feed')) === null);
    await page.selectOption('#statYear', '2025');
    const tr = await page.locator('#statTable tbody tr', { hasText: 'Mar' }).first().locator('td').allInnerTexts();
    check('feed: year table, March average pages = (120 + 50 + 25) / 3 = 65', tr[8] === '65', tr);
    await page.click('[data-trend-stat=pages]');
    const tn = await page.locator('#trendPanel .tr-tiles .tile .num').first().innerText();
    check('feed: trend chart draws a feed-only day (this month so far = 77)', tn === '77' && (await page.locator('#trendPanel svg').first().innerHTML()).includes('This month 77') && !(await page.locator('#trendPanel').innerText()).includes('Nothing logged yet'), tn);
    // Log form
    const form = async d => { await page.evaluate(x => { state.logDate = x; renderLog(); }, d); return page.evaluate(() => ({ v: document.getElementById('lPages').value, ph: document.getElementById('lPages').placeholder })); };
    let fm = await form('2025-03-10'); check('feed: Log form shows the typed 120 and no placeholder', fm.v === '120' && fm.ph === '', fm);
    fm = await form('2025-03-11'); check('feed: Log form, blank pages -> value stays blank, placeholder "50 from The Library"', fm.v === '' && fm.ph === '50 from The Library', fm);
    fm = await form('2025-03-14'); check('feed: Log form, no feed for the day -> plain blank', fm.v === '' && fm.ph === '', fm);
    // save with pages blank
    await form('2025-03-11'); const b0 = w.sbCalls.length;
    await page.fill('#lSteps', '6100'); await page.click('#logForm button[type=submit]');
    await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live' && /Supabase/.test(document.getElementById('statusText').textContent)); await page.waitForTimeout(300);
    let wr = w.sbCalls.slice(b0).filter(c => c.method !== 'GET');
    check('feed: saving an existing day with pages blank -> one PATCH of the changed field, no pages value', wr.length === 1 && wr[0].method === 'PATCH' && wr[0].table === 'log' && JSON.stringify(wr[0].body) === '{"steps":6100}', wr.map(x => [x.method, x.body]));
    await form('2025-03-12'); const b1 = w.sbCalls.length;
    await page.fill('#lNote', 'quiet day'); await page.click('#logForm button[type=submit]');
    await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live' && /Supabase/.test(document.getElementById('statusText').textContent)); await page.waitForTimeout(300);
    wr = w.sbCalls.slice(b1).filter(c => c.method !== 'GET');
    check('feed: saving a feed-only day with pages blank -> new row has no pages value', wr.length === 1 && wr[0].method === 'POST' && wr[0].table === 'log' && wr[0].body.length === 1 && wr[0].body[0].pages == null && wr[0].body[0].date === '2025-03-12', wr.map(x => [x.method, x.body]));
    const saved = w.sb.log.find(r => r.date === '2025-03-12');
    check('feed: stored Log rows hold only typed pages', saved && saved.pages == null && w.sb.log.find(r => r.date === '2025-03-11').pages === null && w.sb.log.find(r => r.date === '2025-03-10').pages === 120, w.sb.log);
    await page.evaluate(() => { state.month = '2025-03'; renderMonth(); });
    check('feed: after saving, the feed still fills the blank pages', (await cell('2025-03-12').innerText()) === '25' && (await cell('2025-03-11').innerText()) === '50');
    check('feed: no write anywhere carries a feed value', writes(w).every(c => [].concat(c.body || []).every(o => o.pages == null || o.pages === 120)), writes(w).map(x => x.body));
    check('feed: never a POST, PATCH or DELETE against `shared`', w.sharedCalls.length >= 1 && w.sharedCalls.every(c => c.method === 'GET'), w.sharedCalls.map(c => c.method));
    check('feed: no console warning when the view works', w.warns.length === 0, w.warns);
  } });
  await scenario(b, 'feed-missing-view', { init: { ...cfgSb, ...ses() }, setup: w => { feedSetup(w); w.noView = true; }, run: async (page, w) => {
    await live(page);
    check('missing view (404): app loads and works, no error notice', (await page.locator('#notice').isHidden()) && (await page.locator('#homeToday').innerText()).includes('Strength & Conditioning') && (await page.locator('#statusText').innerText()).startsWith('Supabase ·'));
    check('missing view: state.feed is an empty Map and exactly one console.warn', await page.evaluate(() => state.feed instanceof Map && state.feed.size === 0) && w.warns.filter(x => /The Library/.test(x)).length === 1, w.warns);
    check('missing view: Home shows no pages from the feed', !(await page.locator('#homeStats [data-stat=pages] .big').innerText()).startsWith('77'));
    await page.click('.tab[data-tab=fitness]'); await page.evaluate(() => { state.month = '2025-03'; renderMonth(); });
    const tile = await page.locator('#monthPanel .tile', { hasText: 'Pages' }).first().locator('.num').innerText();
    check('missing view: month shows only typed pages (120)', tile === '120', tile);
    check('missing view: still no calls other than reads', writes(w).length === 0 && w.sharedCalls.every(c => c.method === 'GET'));
  } });
  await scenario(b, 'feed-paging', { init: { ...cfgSb, ...ses() }, setup: w => { seedSbBasic(w); for (let i = 0; i < 1500; i++) w.feed('2025-04-01', 1, { logged_at: '2025-04-01T' + pad(Math.floor(i / 60) % 24) + ':' + pad(i % 60) + ':00Z' }); for (let i = 0; i < 700; i++) w.feed('2025-04-02', 2, { logged_at: '2025-04-02T' + pad(Math.floor(i / 60) % 24) + ':' + pad(i % 60) + ':00Z' }); }, run: async (page, w) => {
    await live(page);
    const offs = w.sharedCalls.map(c => /offset=(\d+)/.exec(c.query)[1]);
    check('feed paging: 2200 rows read 1000 at a time', offs.join() === '0,1000,2000', offs);
    check('feed paging: all pages summed per day', await page.evaluate(() => state.feed.get('2025-04-01') === 1500 && state.feed.get('2025-04-02') === 1400));
  } });
  await scenario(b, 'feed-sheet-mode', { init: copyInit, setup: w => { w.feed(T, 5); }, run: async (page, w) => {
    await live(page);
    check('feed: Sheet mode never reads it, state.feed is empty', w.sharedCalls.length === 0 && (await page.evaluate(() => state.feed instanceof Map && state.feed.size === 0)));
    check('feed: Sheet mode still shows the sheet\'s own pages (100, 120, 90)', await page.evaluate(() => statLog() === state.data.Log && state.data.Log.map(r => r.pages).join() === '100,120,90'));
  } });
  await scenario(b, 'feed-check-copy', { init: { ...copyInit, brain_config: { backend: 'supabase', clientId: 'abc.apps.googleusercontent.com', sheetId: 'TESTSHEET1234567890abc' } }, setup: w => {
      [[add(-3), 10000, 7.2, 60, 100, 18, 9, 'G', ''], [add(-2), 4000, 2.9, 30, 120, 15, 8, 'F', 'Rain'], [add(-1), 14000, 10.1, 120, 90, 20, 10, 'G', '']].forEach(([date, steps, km, a, pages, mx, mn, mood, note]) => w.insert('log', { date, steps, km, active_mins: a, pages, max_c: mx, min_c: mn, mood, note }));
      w.feed(add(-3), 999); w.feed(add(-1), 1); w.feed(add(-10), 500); }, run: async (page, w) => {
    await live(page);
    check('check/copy: the feed was read', w.sharedCalls.length >= 1 && (await page.evaluate(() => state.feed.size)) === 3);
    await page.click('#settingsBtn'); await page.waitForSelector('#setDlg[open]');
    await page.click('#sbCheck'); await page.waitForFunction(() => /differ|match/.test(document.getElementById('sbMsg').textContent), null, { timeout: 8000 });
    const m = await page.locator('#sbMsg').innerText();
    check('check: Log matches (feed pages and feed-only days are not counted as differences)', /✓ Log/.test(m) && !/✗ Log/.test(m), m);
    await page.click('#sbCopy'); await page.waitForFunction(() => !/^(Comparing|Checking|Reading|Check|They differ|Supabase and your Sheet match)/.test(document.getElementById('sbMsg').textContent) && document.getElementById('sbMsg').textContent.length > 0, null, { timeout: 8000 });
    const pv = await page.locator('#sbMsg').innerText();
    check('copy: the preview does not list the Log tab or any feed value', !/Log/.test(pv) && !/999|500/.test(pv), pv);
    check('copy: no Sheet write carries a feed value', w.sheetCalls.every(c => c.startsWith('GET ')), w.sheetCalls.filter(c => !c.startsWith('GET')));
  } });
  await scenario(b, 'feed-phone', { init: { ...cfgSb, ...ses() }, vp: { width: 390, height: 900 }, setup: feedSetup, run: async (page) => {
    await live(page); await page.click('.tab[data-tab=fitness]').catch(() => {});
    await page.evaluate(() => { showTab('fitness'); state.month = '2025-03'; renderMonth(); state.logDate = '2025-03-11'; renderLog(); });
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check('feed layout 390px: no horizontal scroll on the Fitness tab with feed pages', m.sw <= m.iw + 1, m);
    await page.screenshot({ path: path.join(OUT, 'shot-feed-390.png') });
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
