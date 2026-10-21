// Headless test for "Copy Supabase → Sheet": a writable fake Sheets API and a read-only fake Supabase, via page.route.
// Run: NODE_PATH=$(npm root -g) node tools/test-copyback.js <outdir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SBU = 'https://apeflgdzclpxiktaxyfk.supabase.co';
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(), T = iso(today);
const add = n => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const serial = s => { const [y, m, d] = s.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5); };
const fromSerial = n => { const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = 'x.' + b64u({ email: 'me@example.com', sub: 'u1' }) + '.y';

const log = [], errors = [];
const check = (name, ok, extra) => log.push((ok ? 'PASS ' : 'FAIL ') + name + (!ok && extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : ''));

// Sheet tabs (header + rows) and the matching table columns, in the same order.
const COLS = {
  Plan: ['id', 'date', 'end_date', 'time', 'title', 'category', 'type', 'done', 'countdown', 'notes'],
  Routine: ['day', 'category', 'time', 'title', 'active'],
  Log: ['date', 'steps', 'km', 'active_mins', 'pages', 'max_c', 'min_c', 'mood', 'note'],
  Goals: ['year', 'month', 'steps', 'km', 'active_mins', 'pages'],
  People: ['id', 'name', 'birthday', 'last_seen', 'to_see', 'see_every_days', 'notes', 'groups', 'links', 'next_catchup', 'next_time', 'catchup_plan', 'plan_id'],
  Lists: ['id', 'list', 'item', 'status', 'added', 'notes'],
  Notes: ['id', 'date', 'topic', 'note'],
  Links: ['name', 'category', 'url', 'pin', 'sort_order', 'notes'],
  Settings: ['key', 'value', 'notes']
};
const DATES = new Set(['date', 'end_date', 'birthday', 'last_seen', 'next_catchup', 'added']);
const TABLE = { Plan: 'plan', Routine: 'routine', Log: 'log', Goals: 'goals', People: 'people', Lists: 'lists', Notes: 'notes', Links: 'links', Settings: 'settings' };
const KEYI = { Plan: 0, Routine: 3, Log: 0, Goals: 0, People: 0, Lists: 0, Notes: 0, Links: 0, Settings: 0 };
function sheetRows() {
  return {
    Plan: [['e1', serial(T), '', '07:00', 'Gym', 'Fitness', 'Gym', false, false, ''], ['e2', serial(T), '', '', 'Office', 'Work', 'Routine', true, false, ''],
      ['e4', serial(add(2)), '', '', 'Dinner', 'Social', 'Catch up', false, true, ''], ['e6', serial(add(3)), serial(add(5)), '', 'Housesitting', 'Home', '', false, false, 'Feed cat']],
    Routine: [['Mon', 'Fitness', '', '12000 steps', true], ['Tue', 'Fitness', '0700', 'Kickboxing', true], ['Sat', 'Fitness', '', 'Walk', false], ['Sun', 'Fitness', '', 'Walk', false]],
    Log: [[serial(add(-2)), 4000, 2.9, 30, 120, 15, 8, 'F', 'Rain'], [serial(add(-1)), 14000, 10.1, 120, 90, 20, 10, 'G', '']],
    Goals: [[today.getFullYear(), today.getMonth() + 1, 11000, 8, 90, 100]],
    People: [['p1', 'Sam', serial('1904-03-04'), '', true, '', 'Ask about job', 'IV', '', '', '', '', ''], ['p2', 'Alex', '', serial(add(-100)), false, 60, '', 'HFP', 'p1:Friend', '', '', '', '']],
    Lists: [['l1', 'Reading', 'A Book', 'Current', serial(T), '']],
    Notes: [['n1', serial(add(-5)), 'Ideas', 'Line one\nLine two']],
    Links: [['Books', 'Entertainment', 'https://example.com/books', true, 1, ''], ['NRL', 'Sport', 'https://example.com/nrl', true, 2, '']],
    Settings: [['payday_anchor', serial('2026-01-09'), ''], ['payday_every', 14, ''], ['birthday_window', 60, '']]
  };
}
// Supabase starts as a faithful copy of the Sheet, then each test edits it.
function sbFrom(rows) {
  const sb = {}; let id = 1;
  Object.entries(rows).forEach(([tab, rs]) => { sb[TABLE[tab]] = rs.map(r => { const o = { row_id: id++ };
    COLS[tab].forEach((c, i) => { let v = r[i]; if (DATES.has(c)) v = v === '' ? null : fromSerial(v); else if (v === '') v = typeof r[i] === 'number' ? null : (['steps', 'km', 'active_mins', 'pages', 'max_c', 'min_c', 'see_every_days', 'sort_order', 'month'].includes(c) ? null : '');
      if (c === 'value') v = String(r[i]); o[c] = v; }); return o; }); });
  return sb;
}
function parseA1(r) { const [tab, rng] = r.split('!'); const [a, b] = rng.split(':'); const p = s => { const m = s.match(/^([A-Z])(\d*)$/); return { c: m[1].charCodeAt(0) - 65, r: m[2] ? Number(m[2]) : null }; }; const A = p(a), B = b ? p(b) : A; return { tab, r0: A.r, c0: A.c, r1: B.r, c1: B.c }; }
const entered = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? serial(v) : typeof v === 'string' && v.startsWith("'") ? v.slice(1) : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;

function world(edit, extraTabs = []) {
  const rows = sheetRows(), w = { calls: [], tabs: [] }; let nextSid = 100;
  Object.keys(COLS).forEach((t, i) => w.tabs.push({ sheetId: i, title: t, hidden: false, rowCount: 200, data: [COLS[t].map(c => c.toUpperCase())].concat(JSON.parse(JSON.stringify(rows[t]))) }));
  extraTabs.forEach(t => w.tabs.push({ sheetId: nextSid++, title: t, hidden: true, rowCount: 10, data: [['old']] }));
  w.sb = sbFrom(rows); if (edit) edit(w.sb);
  w.tab = t => w.tabs.find(x => x.title === t); w.byId = id => w.tabs.find(x => x.sheetId === id); w.nextSid = () => nextSid++;
  return w;
}
async function install(page, w) {
  await page.route('https://brain.test/**', r => r.fulfill({ contentType: 'text/html', body: HTML }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: '' }));
  await page.route(/accounts\.google\.com/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/api\.open-meteo\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], weathercode: [] } }) }));
  await page.route(/jcm-book-library\.github\.io/, r => r.fulfill({ contentType: 'text/html', body: '<p>stub</p>' }));
  await page.route(/sheets\.googleapis\.com/, r => {
    const req = r.request(), u = new URL(req.url()), method = req.method(), p = decodeURIComponent(u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''));
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    w.calls.push({ method, p, body });
    const json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '') return json({ sheets: w.tabs.map(t => ({ properties: { sheetId: t.sheetId, title: t.title, gridProperties: { rowCount: t.rowCount } } })) });
    if (p === '/values:batchGet') return json({ valueRanges: u.searchParams.getAll('ranges').map(rg => { const a = parseA1(rg); return { range: rg, values: w.tab(a.tab).data.slice(a.r0 - 1).map(row => row.slice(a.c0, a.c1 + 1)) }; }) });
    const put = (rg, vals) => { const a = parseA1(rg), d = w.tab(a.tab).data; vals.forEach((rv, i) => { const ri = a.r0 - 1 + i; while (d.length <= ri) d.push([]); rv.forEach((v, j) => { d[ri][a.c0 + j] = entered(v); }); }); };
    if (p === '/values:batchUpdate') { body.data.forEach(x => put(x.range, x.values)); return json({}); }
    if (p.startsWith('/values/') && method === 'PUT') { put(p.slice(8), body.values); return json({}); }
    if (p === ':batchUpdate') {
      const replies = [];
      for (const q of body.requests) {
        if (q.duplicateSheet) { const src = w.byId(q.duplicateSheet.sourceSheetId), t = { sheetId: w.nextSid(), title: q.duplicateSheet.newSheetName, hidden: false, rowCount: src.rowCount, data: JSON.parse(JSON.stringify(src.data)) };
          w.tabs.push(t); replies.push({ duplicateSheet: { properties: { sheetId: t.sheetId, title: t.title } } }); continue; }
        if (q.updateSheetProperties) { Object.assign(w.byId(q.updateSheetProperties.properties.sheetId), { hidden: q.updateSheetProperties.properties.hidden }); }
        if (q.deleteSheet) w.tabs.splice(w.tabs.indexOf(w.byId(q.deleteSheet.sheetId)), 1);
        if (q.deleteDimension) w.byId(q.deleteDimension.range.sheetId).data.splice(q.deleteDimension.range.startIndex, 1);
        if (q.appendDimension) w.byId(q.appendDimension.sheetId).rowCount += q.appendDimension.length;
        replies.push({});
      }
      return json({ replies });
    }
    return r.fulfill({ status: 404, body: '{}' });
  });
  await page.route(SBU + '/**', r => {
    const u = new URL(r.request().url()), m = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m || r.request().method() !== 'GET') { w.sbWrites = (w.sbWrites || 0) + 1; return r.fulfill({ status: 405, body: '{}' }); }
    const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 1000);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(w.sb[m[1]].slice(off, off + lim)) });
  });
}
const INIT = { 'jm-google-token': { t: 'x', exp: Date.now() + 3600e3 }, 'brain-sb-session': { at: TOKEN, rt: 'rt1', exp: Date.now() + 3600e3, email: 'me@example.com' },
  'brain_config': { backend: 'supabase', clientId: 'abc.apps.googleusercontent.com', sheetId: 'TESTSHEET1234567890abc' } };
async function scenario(browser, name, w, run, init = INIT) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage();
  page.on('pageerror', e => errors.push(name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
  await install(page, w);
  await page.addInitScript(i => { if (sessionStorage.getItem('__seeded')) return; sessionStorage.setItem('__seeded', '1'); Object.entries(i).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v))); }, init);
  try { await page.goto('https://brain.test/'); await page.waitForSelector('#status[data-state=live]', { timeout: 8000 }); await run(page); }
  catch (e) { check(name + ' ran without throwing', false, String(e.message).slice(0, 300)); }
  await ctx.close();
}
const sheetWrites = w => w.calls.filter(c => c.method !== 'GET');
const msg = page => page.locator('#sbMsg').innerText();
const openSet = async page => { await page.click('#settingsBtn'); await page.waitForSelector('#setDlg[open]'); };
const waitMsg = (page, re) => page.waitForFunction(r => new RegExp(r).test(document.getElementById('sbMsg').textContent), re.source, { timeout: 8000 });
const rowsOf = (w, t) => w.tab(t).data.slice(1).filter(r => r[KEYI[t]] !== '' && r[KEYI[t]] != null);
const old = ['Plan backup 2026-01-01', 'Plan backup 2026-01-02', 'Plan backup 2026-01-03'];

(async () => {
  const b = await chromium.launch();

  // 1. Full copy back: changes, additions, removals; backups first; only changed cells written; checked after.
  const w1 = world(sb => {
    sb.plan.find(r => r.id === 'e1').done = true;                                   // one cell
    sb.plan.find(r => r.id === 'e6').notes = '=not a formula';                       // text that looks like a formula
    sb.plan.push({ row_id: 900, id: 'e9', date: add(4), end_date: null, time: '18:30', title: 'Footy', category: 'Sport', type: 'Sport', done: false, countdown: false, notes: '' });
    sb.plan = sb.plan.filter(r => r.id !== 'e4');                                    // removed in Supabase
    sb.routine.find(r => r.title === 'Walk' && r.day === 'Sun').active = true;       // second of two "Walk" rows
    sb.settings.find(r => r.key === 'payday_every').value = '21';
    sb.log.push({ row_id: 901, date: T, steps: 9000, km: 6.5, active_mins: 50, pages: 20, max_c: 22, min_c: 11, mood: 'G', note: '' });
  }, old);
  await scenario(b, 'copyback', w1, async page => {
    await openSet(page);
    check('label follows source: Supabase mode copies to the Sheet', (await page.locator('#sbCopy').innerText()).includes('Copy Supabase → Sheet'));
    await page.click('#sbCopy'); await waitMsg(page, /This will change your Sheet/);
    const m = await msg(page);
    check('preview lists Plan changes', /Plan: 2 cells changed, 1 new row, 1 row removed/.test(m), m);
    check('preview lists Routine, Log, Settings', /Routine: 1 cell changed/.test(m) && /Log: 1 new row/.test(m) && /Settings: 1 cell changed/.test(m), m);
    check('preview leaves untouched tabs out', !/People|Lists|Notes|Links|Goals/.test(m), m);
    check('preview writes nothing', sheetWrites(w1).length === 0, sheetWrites(w1));
    check('button asks to confirm', (await page.locator('#sbCopy').innerText()) === 'Write these to the Sheet');
    const before = w1.calls.length;
    await page.click('#sbCopy'); await waitMsg(page, /^(Sheet updated|Copy stopped)/);
    const done = await msg(page);
    check('reports success and check', /Sheet updated \(7 changes\) and checked: it matches Supabase/.test(done), done);
    const wr = w1.calls.slice(before).filter(c => c.method !== 'GET');
    const firstValue = wr.findIndex(c => c.p !== ':batchUpdate' || c.body.requests.some(q => q.deleteDimension));
    const dup = wr.findIndex(c => c.p === ':batchUpdate' && c.body.requests.some(q => q.duplicateSheet));
    check('backups made before any data is written', dup >= 0 && dup < firstValue, wr.map(c => c.p));
    const today4 = ['Plan', 'Routine', 'Log', 'Settings'].map(t => w1.tab(`${t} backup ${T}`));
    check('backup tab for each changed tab, hidden', today4.every(t => t && t.hidden), w1.tabs.map(t => t.title));
    check('backups hold the Sheet as it was', JSON.stringify(w1.tab(`Plan backup ${T}`).data.slice(1)) === JSON.stringify(sheetRows().Plan));
    check('no backup for untouched tabs', !w1.tabs.some(t => /^(People|Lists|Notes|Links|Goals) backup/.test(t.title)));
    check('old backups pruned to newest 3', JSON.stringify(w1.tabs.filter(t => /^Plan backup/.test(t.title)).map(t => t.title).sort()) === JSON.stringify(['Plan backup 2026-01-02', 'Plan backup 2026-01-03', `Plan backup ${T}`]), w1.tabs.map(t => t.title));
    const cells = wr.filter(c => c.p === '/values:batchUpdate').flatMap(c => c.body.data.map(d => d.range)).sort();
    check('only changed cells written', JSON.stringify(cells) === JSON.stringify(['Plan!H2', 'Plan!J5', 'Routine!E5', 'Settings!B3']), cells);
    check('formula-looking text kept as text', w1.tab('Plan').data.find(r => r[0] === 'e6')[9] === '=not a formula', w1.tab('Plan').data);
    const plan = rowsOf(w1, 'Plan');
    check('Plan: e4 removed, e9 added, e1 ticked', !plan.some(r => r[0] === 'e4') && plan.some(r => r[0] === 'e9' && r[3] === '18:30' && r[1] === serial(add(4))) && plan.find(r => r[0] === 'e1')[7] === true, plan);
    check('Routine: second Walk active, first untouched', rowsOf(w1, 'Routine')[2][4] === false && rowsOf(w1, 'Routine')[3][4] === true);
    check('Log: new day appended at the end', rowsOf(w1, 'Log').length === 3 && rowsOf(w1, 'Log')[2][0] === serial(T));
    check('People, Lists, Notes, Links, Goals untouched', ['People', 'Lists', 'Notes', 'Links', 'Goals'].every(t => JSON.stringify(rowsOf(w1, t)) === JSON.stringify(sheetRows()[t])));
    check('nothing written to Supabase', !w1.sbWrites);
    // second run: nothing left to do
    const n = sheetWrites(w1).length;
    await page.click('#sbCopy'); await waitMsg(page, /already matches|This will change/);
    check('second run: already matches, nothing written', /already matches/.test(await msg(page)) && sheetWrites(w1).length === n, await msg(page));
  });

  // 2. Sheet edited between the preview and the write -> stops before writing anything.
  const w2 = world(sb => { sb.plan.find(r => r.id === 'e1').done = true; });
  await scenario(b, 'changed', w2, async page => {
    await openSet(page); await page.click('#sbCopy'); await waitMsg(page, /This will change/);
    w2.tab('Plan').data.splice(1, 0, ['e0', serial(T), '', '', 'Typed by hand', 'Work', '', false, false, '']);
    await page.click('#sbCopy'); await waitMsg(page, /^(Sheet updated|Copy stopped)/);
    check('stops if the Sheet changed since the preview', /the Sheet changed since the check/.test(await msg(page)), await msg(page));
    check('stopped before any write or backup', sheetWrites(w2).length === 0, sheetWrites(w2));
  });

  // 3. Already in step: nothing to copy, nothing written.
  const w3 = world();
  await scenario(b, 'same', w3, async page => {
    await openSet(page); await page.click('#sbCopy'); await waitMsg(page, /already matches|This will change/);
    check('in step: says nothing to copy', /already matches Supabase/.test(await msg(page)), await msg(page));
    check('in step: nothing written', sheetWrites(w3).length === 0);
  });

  // 4. Sheet mode: the button copies the other way and never writes to the Sheet.
  const w4 = world();
  await scenario(b, 'sheetmode', w4, async page => {
    await openSet(page);
    check('label follows source: Sheet mode copies to Supabase', (await page.locator('#sbCopy').innerText()).includes('Copy Sheet → Supabase'));
  }, { ...INIT, brain_config: { clientId: 'abc.apps.googleusercontent.com', sheetId: 'TESTSHEET1234567890abc' } });

  await b.close();
  log.forEach(l => console.log(l));
  console.log('errors:', JSON.stringify(errors));
  process.exit(log.some(l => l.startsWith('FAIL')) || errors.length ? 1 : 0);
})();
