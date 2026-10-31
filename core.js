/* Playbook core v1 — shared engine for the vZNY airport Playbooks.
   An airport page loads core.css, core.js, then its airport.js, which calls
   Playbook.start(H => ({...airport definition...})). See README.md for the contract.
   For VATSIM use only. */
window.Playbook = {start(def){
'use strict';
const HOST = 'host:claude_browser';
const URLS = {
  vatsim: 'https://data.vatsim.net/v3/afv-atis-data.json',
  rw: icao => 'https://atis.info/api/K' + icao
};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let A = null;
const H = {
  $: id => $(id), esc: s => esc(s),
  get state(){ return state; }, get test(){ return test; }, get fs(){ return fs; },
  parseAtis: t => parseAtis(t), uniq: a => uniq(a), inRange: (d, a, b) => inRange(d, a, b),
  minRvr: p => minRvr(p), isVMC: p => isVMC(p), meets: (p, c, v) => meets(p, c, v),
  windStr: w => windStr(w), wxStr: p => wxStr(p), verdict: (k, t) => verdict(k, t), gateCell: l => gateCell(l),
  cur: ap => cur(ap), pad: (n, w) => pad(n, w), fmtVis: v => fmtVis(v), num: id => num(id), checked: id => checked(id), zulu: () => zulu(),
  onTestChange: () => onTestChange(), altFeet: a => altFeet(a), sayAlt: n => sayAlt(n), ftTxt: n => ftTxt(n),
  get GATE(){ return GATE; }
};
A = Object.assign({
  cards: null, groups: [], climbWords: [], gateFixes: {}, exits: {}, exitRules: {}, amdAirway: {}, amdFix: {},
  sidRe: /^$/, initialAlt: 5000, samples: [], depFreqs: [], apreq: [], stripsPage: 'p10', groundNm: 3,
  vfrPrefix: 'CLEARED OUT OF BRAVO AIRSPACE VIA', noAtisText: () => 'Refresh, or paste an ATIS.',
  noCtxText: null
}, def(H));
const ICAO = 'K' + A.id;
if (!A.cards) A.cards = [A.id];
if (!A.noCtxText) A.noCtxText = 'No active ' + A.id + ' configuration: load or paste the ' + A.id + ' ATIS, or use Test mode.';
const AIRPORTS = A.airports;
const atisSrc = Object.fromEntries(AIRPORTS.map(ap => [ap, 'auto']));  // per-airport ATIS source; see the card toggles
const PAGES = A.pages;

// Pages serves Stable at / and the Lab at /lab/ on one site: keep their saved settings apart.
const STORE_PREFIX = /\/lab\//.test(location.pathname) ? A.store + 'lab.' : A.store + '.';
const store = {
  get(k, d){ try{ const v = localStorage.getItem(STORE_PREFIX+k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(STORE_PREFIX+k, JSON.stringify(v)); }catch(e){} }
};

const state = {
  atis: Object.fromEntries(AIRPORTS.map(ap => [ap, null])),  // {text, code, time, origin}
  pasting: Object.fromEntries(AIRPORTS.map(ap => [ap, false])),
  rwcmp: Object.fromEntries(A.cards.map(ap => [ap, null])),  // real-world runways for comparing against a VATSIM ATIS: {land, dep, code, time}
  livePage: null,
  liveVfr: null,
  ctx: null,  // VFR Departures page for the active configuration
  busy: false
};
/* ---------- ATIS parsing ---------- */
const normRwy = r => r.replace(/^0+(?=\d)/, '');
const RWY = '(\\d{1,2}[LRC]?)';
const LIST_TAIL = '((?:\\s*(?:,|AND|&|/)\\s*(?:RWYS?\\s*|RYS?\\s*|RUNWAYS?\\s*)?\\d{1,2}[LRC]?\\b)*)';
function grabList(first, tail){
  const out = [normRwy(first)];
  (tail || '').replace(/(\d{1,2}[LRC]?)/g, m => { out.push(normRwy(m)); return m; });
  return out;
}
function uniq(a){ return [...new Set(a)]; }

function parseAtis(raw){
  const t = ' ' + String(raw || '').toUpperCase().replace(/\s+/g, ' ') + ' ';
  const res = {land:[], dep:[], appr:[], wind:null, vis:null, ceil:null, rvr:[], climbs:[]};
  // approaches: "ILS RWY 22", "RNAV Z RWY 31", "VIS APCH RWY 4", "RIVER VISUAL RWY 13", "PARKWAY VISUAL 13L"
  const apRe = new RegExp('\\b(ILS|LOC(?:ALIZER)?|RNAV(?:\\s*\\(?GPS\\)?)?|RNP|GPS|VOR|VIS(?:UAL)?|RIVER|EXPRESSWAY|EXPWY|PARKWAY|PARK|CANARSIE)(?:\\s+[XYZ]\\b)?(?:\\s+(?:VISUAL|VIS))?(?:\\s+(?:APCHS?|APPROACH(?:ES)?|APPS))?\\s*(?:TO\\s+)?(?:RWYS?|RYS?|RUNWAYS?)?\\s*' + RWY + '\\b' + LIST_TAIL, 'g');
  let m;
  while ((m = apRe.exec(t))){
    const kind = m[1].replace(/\s.*/, '');
    const variant = (m[0].match(/\b(RNAV(?:\s*\(?GPS\)?)?)\s+([XYZ])\b/) || [])[2] || '';
    grabList(m[2], m[3]).forEach(r => res.appr.push({kind, variant, rwy:r}));
  }
  const landRe = new RegExp('\\b(?:LDG|LNDG|LANDING|LAND|LND|ARR(?:IVALS?|IVING)?)\\s+(?:RWYS?|RYS?|RUNWAYS?)\\s*' + RWY + '\\b' + LIST_TAIL, 'g');
  while ((m = landRe.exec(t))) res.land.push(...grabList(m[1], m[2]));
  const depRe = new RegExp('\\b(?:DEPG|DEPTG|DEPTNG|DEPARTING|DEPART|DEPARTURES?|DEPS?|DEPTS?)\\s+(?:RWYS?|RYS?|RUNWAYS?)\\s*' + RWY + '\\b' + LIST_TAIL, 'g');
  while ((m = depRe.exec(t))) res.dep.push(...grabList(m[1], m[2]));
  // "LANDING AND DEPARTING 34, 29" / "LDG AND DEPG RWY 22": the same runways both ways
  const bothRe = new RegExp('\\b(?:LDG|LNDG|LANDING|LAND|ARRIVING|ARRIVALS?)\\s+(?:AND|&|/)\\s+(?:DEPG|DEPTG|DEPARTING|DEPARTURES?|DEPS?)\\s+(?:(?:RWYS?|RYS?|RUNWAYS?)\\s*)?' + RWY + '\\b' + LIST_TAIL, 'g');
  while ((m = bothRe.exec(t))){ const l = grabList(m[1], m[2]); res.land.push(...l); res.dep.push(...l); }
  res.land = uniq([...res.land, ...res.appr.map(a => a.rwy)]);
  res.dep = uniq(res.dep);
  // weather
  const w = t.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (w) res.wind = {dir: w[1] === 'VRB' ? null : +w[1], spd: +w[2], gust: w[3] ? +w[3] : null, vrb: w[1] === 'VRB'};
  const v = t.match(/\b(M|P)?(\d{1,2}(?:\s\d\/\d)?|\d\/\d{1,2})SM\b/);
  if (v){
    const parts = v[2].split(' ');
    let val = 0;
    parts.forEach(p => { if (p.includes('/')){ const [a,b] = p.split('/'); val += (+a)/(+b); } else val += +p; });
    res.vis = val;
  }
  const layers = [...t.matchAll(/\b(BKN|OVC|VV)(\d{3})\b/g)].map(x => +x[2] * 100);
  if (layers.length) res.ceil = Math.min(...layers);
  else if (/\b(CLR|SKC|NSC|FEW\d{3}|SCT\d{3})\b/.test(t) && w) res.ceil = Infinity;
  for (const r of t.matchAll(/\bR(\d{1,2}[LRC]?)\/[MP]?(\d{4})(?:V[MP]?(\d{4}))?FT\b/g)) res.rvr.push({rwy: normRwy(r[1]), ft: +r[2]});
  A.climbWords.forEach(c => { if (t.includes(c)) res.climbs.push(c); });
  return res;
}

/* ---------- weather and wind helpers ---------- */
const inRange = (d, a, b) => a <= b ? (d >= a && d <= b) : (d >= a || d <= b);
const PAGE_LABEL = Object.fromEntries(PAGES.map(p => [p.id, p.n]));
function minRvr(p){ return p && p.rvr.length ? Math.min(...p.rvr.map(r => r.ft)) : null; }
function isVMC(p){ return p && p.ceil !== null && p.vis !== null && p.ceil >= 1000 && p.vis >= 3; }
function meets(p, ceil, vis){ return p && p.ceil !== null && p.vis !== null && p.ceil >= ceil && p.vis >= vis; }
function windStr(w){
  if (!w) return '—';
  const d = w.vrb ? 'VRB' : String(w.dir).padStart(3, '0');
  return d + '@' + w.spd + (w.gust ? 'G' + w.gust : '') + ' kt';
}
function wxStr(p){
  if (!p) return '—';
  const c = p.ceil === null ? '—' : p.ceil === Infinity ? 'no ceiling' : p.ceil.toLocaleString() + ' ft';
  const v = p.vis === null ? '—' : (Math.round(p.vis * 100) / 100) + ' SM';
  return c + ' / ' + v;
}

/* Exit fixes per departure gate, under each gate label (from the airport's gateFixes) */
function gateCell(label){
  const dirs = ['North','East','South','West'].filter(d => new RegExp('\\b' + d + '\\b').test(label));
  return esc(label) + dirs.map(d => '<span class="gfx">' + (dirs.length > 1 ? '<b>' + d.charAt(0) + '</b> ' : '') + (A.gateFixes[d] || []).join(' ') + '</span>').join('');
}

/* ---------- rendering ---------- */
function verdict(kind, text){ return '<span class="verdict v-' + kind + '">' + esc(text) + '</span>'; }

// ATIS letter: green when the VATSIM ATIS lands and departs the same runways as the real-world ATIS, red when not,
// neutral when there is no VATSIM ATIS (or nothing to compare against).
// Landing runways with their advertised approach: "ILS 22", "RNAV Z 13L"; a runway with no named approach shows alone
const APPR_NAME = {VIS:'VIS', VISUAL:'VIS', LOC:'LOC', LOCALIZER:'LOC', EXPRESSWAY:'EXPWY VIS', EXPWY:'EXPWY VIS', PARKWAY:'PARKWAY VIS', PARK:'PARKWAY VIS', RIVER:'RIVER VIS', CANARSIE:'CANARSIE VIS'};
function ldgStr(p){
  if (!p.land.length) return '—';
  return p.land.map(r => {
    const names = uniq(p.appr.filter(a => a.rwy === r).map(a => (APPR_NAME[a.kind] || a.kind) + (a.variant ? ' ' + a.variant : '')));
    return (names.length ? names.join('/') + ' ' : '') + r;
  }).join(', ');
}
function rwySetEq(a, b){ const x = [...new Set(a)].sort(), y = [...new Set(b)].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); }
function codeBox(ap, a, p){
  const letter = esc(a && a.code ? a.code : '–');
  const r = state.rwcmp[ap];
  const isVatsim = a && !test.on && !a.rw && a.origin !== 'Pasted';
  if (!isVatsim || !r || !p || !p.land.length || !p.dep.length || !r.land.length || !r.dep.length)
    return '<div class="code" aria-label="ATIS code ' + letter + '">' + letter + '</div>';
  const ok = rwySetEq(p.land, r.land) && rwySetEq(p.dep, r.dep);
  const rwTxt = 'Real world' + (r.code ? ' ' + r.code : '') + ': LDG ' + r.land.join(', ') + ' · DEP ' + r.dep.join(', ');
  return '<div class="code ' + (ok ? 'm-ok' : 'm-bad') + '" title="' + esc((ok ? 'Matches real world. ' : 'Differs from real world. ') + rwTxt) + '" aria-label="ATIS code ' + letter + ', ' + (ok ? 'runways match' : 'runways differ from') + ' real world">' + letter + '</div>';
}
function renderCard(ap){
  const el = $('card-' + ap);
  const a = cur(ap);
  el.classList.toggle('test', test.on);
  const p = a ? parseAtis(a.text) : null;
  el.classList.toggle('none', !a);
  el.classList.toggle('rw', !!(a && a.rw));
  const pasting = state.pasting[ap];
  const tag = !a ? '' : test.on ? '<span class="src-tag src-t">Test</span>' : a.rw ? '<span class="src-tag src-r">Real world</span>' : a.origin === 'Pasted' ? '<span class="src-tag src-p">Pasted</span>' : '<span class="src-tag src-v">VATSIM</span>';
  let html = '<div class="atis-head"><div><div class="atis-id">K' + ap + tag + '</div><div class="muted" style="font-size:.78rem">' +
    (a ? esc(a.origin) + (a.time ? ' · ' + esc(a.time) : '') : 'No ATIS') + '</div></div>' +
    codeBox(ap, a, p) + '</div>';
  if (!test.on){
    html += '<div class="seg sm" role="group" aria-label="K' + ap + ' ATIS source" title="Auto: VATSIM first, real-world D-ATIS where VATSIM has none. Resets to Auto on reload.">' +
      [['auto','Auto'],['vatsim','VATSIM'],['rw','Real world']].map(([v, l]) =>
        '<button type="button" data-ap="' + ap + '" data-src="' + v + '" aria-pressed="' + (atisSrc[ap] === v) + '">' + l + '</button>').join('') + '</div>';
  }
  if (p){
    html += '<div class="atis-meta">' +
      '<span class="chip">LDG <b>' + esc(ldgStr(p)) + '</b></span>' +
      '<span class="chip">DEP <b>' + esc(p.dep.join(', ') || '—') + '</b></span>' +
      '<span class="chip">' + esc(windStr(p.wind)) + '</span>' +
      '<span class="chip">' + esc(wxStr(p)) + '</span>' +
      (p.rvr.length ? '<span class="chip">RVR ' + esc(p.rvr.map(r => r.rwy + ' ' + r.ft).join(', ')) + '</span>' : '') +
      '</div>';
    html += '<div class="atis-text">' + esc(a.text) + '</div>';
  } else if (!pasting){
    html += '<p class="muted" style="font-size:.85rem">' + esc(A.noAtisText(ap)) + '</p>';
  }
  if (test.on){
    /* no paste controls while testing */
  } else if (pasting){
    html += '<label class="muted" for="paste-' + ap + '" style="font-size:.78rem">Paste the K' + ap + ' ATIS text</label>' +
      '<textarea id="paste-' + ap + '" spellcheck="false">' + esc(a && a.origin === 'Pasted' ? a.text : '') + '</textarea>' +
      '<div style="display:flex;gap:8px"><button type="button" class="btn" data-apply="' + ap + '">Use this ATIS</button><button type="button" class="btn ghost" data-cancel="' + ap + '">Cancel</button>' +
      (a ? '<button type="button" class="btn ghost" data-clear="' + ap + '">Clear</button>' : '') + '</div>';
  } else {
    html += '<button type="button" class="linkbtn" data-paste="' + ap + '">Paste ATIS</button>';
  }
  el.innerHTML = html;
}

// The airport draws the Active block: A.active() → {html, ctx, liveVfr, pageId}
function renderActive(){
  const r = A.active() || {};
  state.ctx = r.ctx || null;
  state.liveVfr = r.liveVfr || null;
  const sec = $('active');
  sec.classList.toggle('test', test.on);
  sec.innerHTML = r.html || '';
  setLivePage(r.pageId || null);
}

function setLivePage(id){
  const changed = state.livePage !== id;
  state.livePage = id;
  renderRail();
  if (changed && id && !userPickedPage) showPage(id, false);
}

let userPickedPage = !!location.hash && PAGES.some(p => '#' + p.id === location.hash);
// Grouped pages get one tab each, with the group's pages in a second row; every other page keeps its own tab.
// A.groups: [{key, ids, n, r, live: () => page id, pageN: true (tab shows the page's own label), dropN: true (second row drops the label), subLabel}]
const DD_GROUPS = A.groups;
const lastInGroup = {};  // the page last shown in each group, so its tab returns there
function railLink(p, cur, liveId){
  return '<a href="#' + p.id + '"' + (p.id === cur ? ' aria-current="page"' : '') + (p.id === liveId ? ' class="live"' : '') + '>' +
    '<span class="n">' + esc(p.n) + '</span><span class="r">' + esc(p.r) + '</span></a>';
}
// A group's tab goes straight to: the page on screen if it's in the group, else the LIVE page, else the last one viewed, else the first.
function groupTarget(g, cur){
  if (g.ids.includes(cur)) return cur;
  return g.live() || (g.ids.includes(lastInGroup[g.key]) ? lastInGroup[g.key] : g.ids[0]);
}
function groupTab(g, cur){
  const inG = PAGES.filter(p => g.ids.includes(p.id)), liveId = g.live();
  const shown = inG.find(p => p.id === cur), live = inG.find(p => p.id === liveId);
  const face = shown || live;
  const cls = ['grp'].concat(live ? ['live'] : []).join(' ');
  return '<a href="#' + groupTarget(g, cur) + '" class="' + cls + '"' + (shown ? ' aria-current="page"' : '') + '>' +
    '<span class="n">' + esc(face && g.pageN ? face.n : g.n) + '</span><span class="r">' + esc(face ? face.r : g.r) + '</span></a>';
}
function renderRail(){
  const cur = currentPage();
  const g0 = DD_GROUPS.find(g => g.ids.includes(cur));
  if (g0) lastInGroup[g0.key] = cur;
  let html = '';
  const placed = new Set();
  PAGES.forEach(p => {
    const g = DD_GROUPS.find(g => g.ids.includes(p.id));
    if (g){ if (!placed.has(g.key)){ html += groupTab(g, cur); placed.add(g.key); } return; }
    html += railLink(p, cur, state.livePage);
  });
  $('rail').innerHTML = html;
  // second row: the pages of the group on screen
  const sub = $('subrail');
  if (g0){
    const liveId = g0.live();
    sub.innerHTML = PAGES.filter(p => g0.ids.includes(p.id)).map(p => railLink(g0.dropN ? {id: p.id, n: '', r: p.r} : p, cur, liveId)).join('');
    sub.setAttribute('aria-label', g0.subLabel || 'Pages');
    sub.hidden = false;
  } else { sub.innerHTML = ''; sub.hidden = true; }
}
function currentPage(){
  const h = location.hash.slice(1);
  const valid = PAGES.some(p => p.id === h);
  if (userPickedPage && valid) return h;
  return state.livePage || (valid ? h : 'overview');
}
function showPage(id, fromHash){
  document.querySelectorAll('[data-page]').forEach(s => { s.hidden = s.id !== id; });
  if (!fromHash) { /* keep hash clean when auto-selected */ }
  renderRail();
}
window.addEventListener('hashchange', () => { userPickedPage = true; showPage(currentPage(), true); });
['rail', 'subrail'].forEach(id => $(id).addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]'); if (!a) return;
  userPickedPage = true;
  if (a.getAttribute('href') === location.hash){ e.preventDefault(); showPage(location.hash.slice(1), true); }
}));

function renderAll(){
  A.cards.forEach(renderCard); renderActive(); if (A.renderPages) A.renderPages(); showPage(currentPage(), true);
  try { renderStrips(); } catch(e){ /* strips not initialised yet on first paint */ }
}

/* ---------- test mode ---------- */
const test = {on:false, atis:Object.fromEntries(AIRPORTS.map(ap => [ap, null]))};
function cur(ap){ return test.on ? test.atis[ap] : state.atis[ap]; }

const pad = (n, w) => String(Math.max(0, Math.round(n))).padStart(w, '0');
function fmtVis(v){
  if (!(v >= 0)) return '10';
  const q = Math.round(v * 4) / 4, whole = Math.floor(q), frac = q - whole;
  const f = {0.25:'1/4', 0.5:'1/2', 0.75:'3/4'}[frac];
  if (!f) return String(whole);
  return whole ? whole + ' ' + f : f;
}
const num = id => { const v = $(id).value.trim(); return v === '' ? null : +v; };
const checked = id => [...$(id).querySelectorAll('input:checked')].map(i => i.value);
function zulu(){ const d = new Date(); return pad(d.getUTCHours(), 2) + pad(d.getUTCMinutes(), 2); }

const PRESETS = A.presets || [];
if ($('presets')){
  $('presets').innerHTML = PRESETS.map((p, i) => '<button type="button" data-preset="' + i + '">' + esc(p.label) + '</button>').join('');
  $('presets').addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if (b) A.applyPreset(PRESETS[+b.dataset.preset]); });
}
function onTestChange(){ A.buildTest(); userPickedPage = false; renderAll(); }
$('testpanel').addEventListener('input', onTestChange);
$('testpanel').addEventListener('change', onTestChange);

function setTest(on){
  test.on = on;
  $('testpanel').hidden = !on;
  $('testbtn').setAttribute('aria-pressed', String(on));
  $('testbtn').textContent = on ? 'Test mode on' : 'Test mode';
  if (on){ if (!test.atis[A.id]) A.applyPreset(PRESETS[0]); else onTestChange(); }
  else { userPickedPage = false; renderAll(); }
}
$('testbtn').addEventListener('click', () => setTest(!test.on));
$('testexit').addEventListener('click', () => setTest(false));
/* ---------- card interactions ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.paste){ state.pasting[b.dataset.paste] = true; renderCard(b.dataset.paste); const ta = $('paste-' + b.dataset.paste); if (ta) ta.focus(); }
  if (b.dataset.cancel){ state.pasting[b.dataset.cancel] = false; renderCard(b.dataset.cancel); }
  if (b.dataset.clear){ const ap = b.dataset.clear; state.atis[ap] = null; state.pasting[ap] = false; renderAll(); }
  if (b.dataset.apply){
    const ap = b.dataset.apply, txt = ($('paste-' + ap).value || '').trim();
    if (!txt) return;
    const code = (txt.toUpperCase().match(/\b(?:INFO(?:RMATION)?|ATIS)\s+([A-Z])\b/) || [])[1] || '';
    const time = (txt.match(/\b(\d{4})Z\b/) || [])[1];
    state.atis[ap] = {text: txt, code, time: time ? time + 'Z' : '', origin: 'Pasted'};
    state.pasting[ap] = false;
    renderAll();
  }
});

/* ---------- live fetch through the desktop app's browser ---------- */
let mcp = null, tabId = null;
const statusEl = $('status');
function setStatus(msg, err){ statusEl.textContent = msg; statusEl.classList.toggle('err', !!err); }

function resultText(res){
  if (!res) return '';
  if (typeof res.payload === 'string') return res.payload;
  const b = (res.content || []).find(c => c.type === 'text');
  return b ? b.text : '';
}
function bodyOf(text){
  let s = text;
  const i = s.indexOf('\n---\n'); if (i >= 0) s = s.slice(i + 5);
  const j = s.lastIndexOf('\n\nTab Context:'); if (j >= 0) s = s.slice(0, j);
  return s.trim();
}
function jsonOf(text){
  const s = bodyOf(text);
  const a = s.search(/[\[{]/);
  const z = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
  if (a < 0 || z < a) throw new Error('No JSON on page');
  return JSON.parse(s.slice(a, z + 1));
}
async function openUrl(url){
  if (tabId){
    try { await mcp.callTool(HOST, 'navigate', {tabId, url}, {cache:false}); return; }
    catch(e){ tabId = null; }
  }
  const r = await mcp.callTool(HOST, 'preview_start', {url}, {cache:false});
  const m = resultText(r).match(/tabId[:\s]+([\w-]+)/);
  tabId = m ? m[1] : null;
}
async function readPage(max){
  const r = await mcp.callTool(HOST, 'get_page_text', tabId ? {tabId, max_chars:max} : {max_chars:max}, {cache:false});
  return resultText(r);
}
// Outside Claude (GitHub Pages, a local file) there is no window.claude: fetch the feeds directly.
const DIRECT = !(window.claude && typeof window.claude.use === 'function');
async function directText(url){
  let r;
  try { r = await fetch(url, {cache: 'no-store'}); }
  catch(e){ throw {code: 'network', message: url.replace(/^https:\/\//, '').split('/')[0]}; }
  if (!r.ok) throw {code: 'http', message: 'HTTP ' + r.status + ' from ' + url.replace(/^https:\/\//, '').split('/')[0]};
  return r.text();
}
async function fetchJson(url, max){
  if (DIRECT) return JSON.parse(await directText(url));
  await openUrl(url);
  let txt = await readPage(max);
  let tries = 0;
  while (/^\s*$/.test(bodyOf(txt)) && tries < 2){ await new Promise(r => setTimeout(r, 1200)); txt = await readPage(max); tries++; }
  return jsonOf(txt);
}

function errMsg(e){
  const c = e && e.code;
  if (c === 'network') return 'Couldn\u2019t reach ' + e.message + '. Check your internet connection and try again.';
  if (c === 'http') return 'The data source answered with an error (' + e.message + '). Try again in a minute.';
  if (c === 'server_not_connected' || c === 'not_granted' || c === 'capability_disabled' || c === 'capability_removed')
    return 'Live ATIS needs this page open in the Claude desktop app. Paste ATIS into the strips instead.';
  if (c === 'not_in_manifest' || c === 'approval_required') return 'The desktop browser wasn\'t allowed for this page. Allow it when asked, or paste ATIS instead.';
  if (c === 'cancelled') return 'The browser action was declined. Paste ATIS instead, or refresh again.';
  if (c === 'server_unavailable' || c === 'upstream_error') return 'The desktop app didn\'t answer. Check that it\'s open and online, then refresh.';
  if (c === 'tool_error') return 'The browser couldn\'t load the ATIS source. If it asks you to allow the site, allow it and refresh.';
  return 'Couldn\'t read the ATIS (' + (e && (e.message || e.code) || 'unknown error') + '). Paste ATIS instead.';
}

async function refresh(){
  if (state.busy) return;
  if (!DIRECT && !mcp){ setStatus('Live ATIS needs this page open in the Claude desktop app. Paste ATIS into the strips instead.', true); return; }
  state.busy = true; $('refresh').disabled = true;
  // Per airport: 'auto' (VATSIM first, real world fallback), 'vatsim' only, or 'rw' only
  const mode = {...atisSrc};
  try {
    const got = {};
    // 1. VATSIM first, all three airports from one feed
    let data = null;
    if (AIRPORTS.some(ap => mode[ap] !== 'rw')){
      setStatus('Reading VATSIM ATIS…');
      try { data = await fetchJson(URLS.vatsim, 400000); }
      catch(e){ if (e && e.code) throw e; data = null; }
    }
    const missing = [];
    AIRPORTS.forEach(ap => {
      const hits = (Array.isArray(data) ? data : []).filter(a => new RegExp('^K' + ap + '(_[A-Z])?_ATIS$').test(a.callsign || ''));
      if (mode[ap] === 'rw' || !hits.length){
        if (mode[ap] === 'vatsim'){ if (!(state.atis[ap] && state.atis[ap].origin === 'Pasted')) state.atis[ap] = null; }
        else missing.push(ap);
        return;
      }
      hits.sort((a, b) => (a.callsign || '').localeCompare(b.callsign || ''));
      const text = hits.map(h => (h.text_atis || []).join(' ')).join('  ');
      const t = hits.map(h => h.last_updated).filter(Boolean).sort().pop();
      state.atis[ap] = {text, code: hits.map(h => h.atis_code).filter(Boolean).join('/'), time: t ? t.slice(11, 16) + 'Z' : '', origin: hits.map(h => h.callsign).join(', '), rw: false};
      got[ap] = 'VATSIM';
    });
    // 2. Real-world D-ATIS for airports set to Real world, and Auto airports without a VATSIM ATIS
    for (const ap of missing){
      setStatus(mode[ap] === 'rw' ? 'Reading real-world D-ATIS for K' + ap + '…' : 'No VATSIM ATIS for K' + ap + '. Reading real-world D-ATIS…');
      try {
        const d = await fetchJson(URLS.rw(ap), 20000);
        const arr = (Array.isArray(d) ? d : [d]).filter(x => x && x.datis);
        if (!arr.length){ if (!(state.atis[ap] && state.atis[ap].origin === 'Pasted')) state.atis[ap] = null; continue; }
        state.atis[ap] = {text: arr.map(x => x.datis).join('  '), code: arr.map(x => x.code).filter(Boolean).join('/'), time: arr[0].time ? arr[0].time + 'Z' : '', origin: 'D-ATIS ' + arr.map(x => x.type).join('/'), rw: true};
        got[ap] = 'real world';
      } catch(e){
        if (e && e.code) throw e;
        if (!(state.atis[ap] && state.atis[ap].origin === 'Pasted')) state.atis[ap] = null;
      }
    }
    // 3. Real-world runways for every card showing a VATSIM ATIS, so its letter can show whether the configs agree
    for (const ap of Object.keys(state.rwcmp)){
      state.rwcmp[ap] = null;
      if (got[ap] !== 'VATSIM') continue;
      try {
        const d = await fetchJson(URLS.rw(ap), 20000);
        const arr = (Array.isArray(d) ? d : [d]).filter(x => x && x.datis);
        if (!arr.length) continue;
        const rp = parseAtis(arr.map(x => x.datis).join('  '));
        state.rwcmp[ap] = {land: rp.land, dep: rp.dep, code: arr.map(x => x.code).filter(Boolean).join('/'), time: arr[0].time ? arr[0].time + 'Z' : ''};
      } catch(e){ /* comparison is optional: leave the letter neutral */ }
    }
    setStatus('ATIS read at ' + new Date().toISOString().slice(11, 16) + 'Z · ' +
      AIRPORTS.map(ap => 'K' + ap + ': ' + (got[ap] || (state.atis[ap] && state.atis[ap].origin === 'Pasted' ? 'pasted' : 'none')) +
        (mode[ap] === 'auto' ? '' : ' (forced)')).join(' · '));
    renderAll();
  } catch(e){
    setStatus(errMsg(e), true);
  } finally {
    state.busy = false; $('refresh').disabled = false;
  }
}

/* ---------- reference pop-ups ---------- */
document.querySelectorAll('[data-pop]').forEach(b => b.addEventListener('click', () => {
  const d = $('pop-' + b.dataset.pop);
  if (!d) return;
  try { d.showModal(); } catch(e){ d.setAttribute('open', ''); }
  if (b.dataset.pop === 'amend'){ const f = $('amend-filter'); if (f) f.focus(); }
}));
document.querySelectorAll('dialog.pop').forEach(d => {
  d.addEventListener('click', e => { if (e.target === d) d.close(); });   // click outside the box
  d.querySelectorAll('[data-close]').forEach(x => x.addEventListener('click', () => d.close()));
});
if ($('amend-filter')) $('amend-filter').addEventListener('input', e => {
  const q = e.target.value.trim().toUpperCase();
  ['amend-airway','amend-exit'].filter(id => $(id)).forEach(id => $(id).querySelectorAll('tbody tr').forEach(tr => {
    tr.hidden = !!q && !tr.textContent.toUpperCase().includes(q);
    tr.classList.toggle('hit', !!q && !tr.hidden);
  }));
});
/* ---------- page 10: live VATSIM flight strips ---------- */
const FEED = 'https://data.vatsim.net/v3/vatsim-data.json';
const fs = {pilots: [], prefiles: [], controllers: [], ts: '', complete: true, loaded: false, byKey: {}};
const HEADSET_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 15a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3z"/><path d="M3 15a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1H3z"/><path d="M19 17v1a3 3 0 0 1-3 3h-3"/></svg>';
const fsStatus = (m, err) => { const s = $('fs-status'); s.textContent = m; s.classList.toggle('err', !!err); };

// Reads every complete object in a JSON array, even if the text was cut off partway.
function extractArray(raw, key){
  let i = raw.indexOf('"' + key + '"');
  if (i < 0) return {items: [], found: false, complete: false};
  i = raw.indexOf('[', i);
  const items = [];
  let depth = 0, inStr = false, escp = false, start = -1;
  for (let p = i + 1; p < raw.length; p++){
    const ch = raw[p];
    if (inStr){ if (escp) escp = false; else if (ch === '\\') escp = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"'){ inStr = true; continue; }
    if (ch === '{'){ if (depth === 0) start = p; depth++; }
    else if (ch === '}'){ depth--; if (depth === 0 && start >= 0){ try { items.push(JSON.parse(raw.slice(start, p + 1))); } catch(e){} start = -1; } }
    else if (ch === ']' && depth === 0) return {items, found: true, complete: true};
  }
  return {items, found: true, complete: false};
}
function nmFromAirport(lat, lon){
  const P = A.pos;
  const r = Math.PI / 180, dLat = (lat - P.lat) * r, dLon = (lon - P.lon) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(P.lat * r) * Math.cos(lat * r) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(a));
}
function alt3(a){
  a = String(a || '').toUpperCase().trim();
  if (!a) return '—';
  let m = a.match(/^F?L?(\d{2,3})$/); if (m && a.startsWith('F')) return m[1].padStart(3, '0');
  m = a.match(/^(\d+)$/);
  if (m){ const n = +m[1]; return (n >= 1000 ? String(Math.round(n / 100)) : String(n)).padStart(3, '0'); }
  return a;
}
const hhmm = s => { s = String(s || '').replace(/\D/g, ''); return s ? s.padStart(4, '0').replace(/(\d\d)(\d\d)/, '$1+$2') : '—'; };


/* ---------- departure-procedure engine (airport data: A.exits, A.exitRules, A.amdAirway, A.amdFix, A.sidRe, A.assignSid) ---------- */
const GATE = {N:'North', E:'East', S:'South', W:'West'};
function altFeet(a){
  a = String(a || '').toUpperCase().trim();
  let m = a.match(/^FL?(\d{2,3})$/); if (m) return +m[1] * 100;
  m = a.match(/^(\d+)$/); if (m){ const n = +m[1]; return n < 1000 ? n * 100 : n; }
  return null;
}
const ftTxt = n => n >= 18000 ? 'FL' + String(n / 100).padStart(3, '0') : n.toLocaleString();
function exitWarnings(fix, cls, rnav, altStr){
  const r = A.exitRules[fix]; if (!r) return [];
  const w = [], alt = altFeet(altStr);
  if (r.tprop && cls === 'JET') w.push(fix + ' is a turboprop-only exit (as much as practicable), filed by a jet.');
  if (r.rnav && rnav.known && !rnav.ok) w.push(fix + ' is an RNAV-only exit; aircraft is /' + rnav.suffix + ' (not RNAV).');
  if (r.minAlt && alt !== null && alt < r.minAlt) w.push(fix + ' is only for traffic filed FL180 and above; filed ' + ftTxt(alt) + '.');
  if (r.alts && alt !== null && !r.alts.includes(alt)) w.push(fix + ' is only for traffic filed 14,000 or 16,000; filed ' + ftTxt(alt) + '.');
  return w;
}
const SPEED_RE = /^[NMK]\d{3,4}[FASM]\d{3,4}$/;

// Jet / turboprop / prop. The SOP's "props" rules use PROP; "jets" rules use JET.
const PROP_TYPES = new Set(('C150 C152 C162 C170 C172 C175 C177 C77R C180 C182 C82R C185 C195 C206 T206 C207 C210 T210 P210 C303 C310 C320 C335 C340 C402 C404 C414 C421 ' +
  'PA18 PA20 PA22 PA23 PA24 PA25 PA28 P28A P28B P28R P28T PA30 PA31 PA32 P32R P32T PA34 PA38 PA44 PA46 PA60 ' +
  'SR20 SR22 S22T DA20 DA40 DA42 DA62 BE23 BE24 BE33 BE35 BE36 BE55 BE58 BE60 BE76 BE95 M20P M20T M20J M20R M20K ' +
  'AA1 AA5 RV6 RV7 RV8 RV10 RV12 GLAS COL3 COL4 TB20 TB21 P2008 G115 DR40 J3 CUB AN2 DC3 C46').split(' '));
const TPROP_TYPES = new Set(('AT43 AT45 AT46 AT72 AT73 AT75 AT76 DH8A DH8B DH8C DH8D DHC6 DHC7 SF34 SW4 B190 BE20 BE30 BE9L BE9T BE99 BE10 ' +
  'PC12 PC6T PC21 TBM7 TBM8 TBM9 P46T C208 C425 C441 KODI E120 JS31 JS32 JS41 C27J C130 P180 MU2 D328 L410 AN26 AN24 SB20 F27 F50 PAY1 PAY2 PAY3 PAY4 ' +
  'M7T B350 B200 E110 G21').split(' '));
const clsStore = store.get('acclass', {});
function icaoType(fp){
  if (fp.aircraft_short) return String(fp.aircraft_short).toUpperCase();
  const parts = String(fp.aircraft_faa || fp.aircraft || '').toUpperCase().split(/[\/-]/);
  return parts.find(p => p.length >= 3 && /[A-Z]/.test(p)) || '';
}
function acClass(x){
  if (clsStore[x.callsign]) return clsStore[x.callsign];
  const t = icaoType(x.fp || {});
  return PROP_TYPES.has(t) ? 'PROP' : TPROP_TYPES.has(t) ? 'TPROP' : 'JET';
}
function rnavCapable(fp){
  const faa = String(fp.aircraft_faa || '').toUpperCase();
  const m = faa.match(/\/([A-Z])$/);
  if (!m || faa.split('/').length < 2) return {ok: true, known: false};
  return {ok: /^[GLZIVS]$/.test(m[1]), known: true, suffix: m[1]};
}

// Builds the amended route: [{t, k}] where k = '' plain, 'sid' (red), 'amd' (Common Amendments), 'fsid' (filed SID kept).
function planDeparture(x){
  const fp = x.fp || {}, ctx = state.ctx;
  const out = {segs: [], flags: [], warns: [], notes: [], gate: '', exit: '', proc: null, amended: '', filedSid: '', cls: acClass(x), rnav: rnavCapable(fp)};
  const tokens = String(fp.route || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  let i = 0;
  const skip = () => { while (i < tokens.length && (tokens[i] === 'DCT' || tokens[i] === ICAO || tokens[i] === A.id || SPEED_RE.test(tokens[i]))) i++; };
  skip();
  if (i < tokens.length && A.sidRe.test(tokens[i])){ out.filedSid = tokens[i]; i++; skip(); }
  let rest = tokens.slice(i);
  const base = t => String(t || '').split('/')[0];
  const first = base(rest[0]);
  let amd = [];
  if (!first){ if (fp.flight_rules !== 'V') out.flags.push('No route filed'); }
  else if (A.exits[first]){ /* valid exit as filed */ }
  else {
    const j = A.amdFix[first] ?? A.amdAirway[first];
    if (typeof j === 'object' && j){
      out.flags.push(first + ': the SOP lists two joins (' + Object.entries(j).map(([g, s]) => g + ': ' + s).join(' or ') + '). Pick one.');
    } else if (typeof j === 'string'){
      if (j.startsWith('=')){ amd = j.slice(1).split(' '); rest = rest.slice(1); }        // SOP join replaces the airway
      else { const jt = j.split(' '); if (jt[jt.length - 1] === first) jt.pop(); amd = jt; }
      out.amended = first + ' → ' + j.replace(/^=/, '');
    } else if (A.exitRules[first] && A.exitRules[first].sat){
      out.flags.push(first + ' is a satellite-only exit (KHPN/KDXR), not for ' + A.id + ' departures.');
    } else {
      out.flags.push(first + ' is not a valid ' + A.id + ' exit and has no Common Amendment.');
    }
  }
  const exitFix = base(amd.length ? amd[0] : first);
  const gate = A.exits[exitFix] || '';
  out.exit = exitFix; out.gate = gate;
  if (first && !out.flags.length && !gate) out.flags.push(exitFix + ' (from the amendment) is not in the Valid Exits table.');
  if (gate && fp.flight_rules !== 'V') out.warns = exitWarnings(exitFix, out.cls, out.rnav, fp.altitude);
  // Airport-specific route changes (A.amendRoute)
  if (A.amendRoute){ const r = A.amendRoute(ctx, exitFix, amd); if (r){ amd = r.amd; out.amended = (out.amended ? out.amended + '; ' : '') + r.note; } }
  // Pick the procedure
  if (fp.flight_rules === 'V') out.notes.push('VFR: no IFR departure procedure; use the SVD for the departure runway.');
  else if (!ctx) out.notes.push(A.noCtxText);
  else if (gate) out.proc = A.assignSid(ctx, gate, exitFix, out.cls, out.rnav.ok);
  // Compose
  const segs = [{t: fp.departure || ICAO, k: ''}];
  const p = out.proc;
  if (p){
    const filedBase = out.filedSid ? out.filedSid.replace(/\d$/, '#') : '';
    if (out.filedSid && filedBase === p.base){
      segs.push({t: out.filedSid, k: 'fsid'});
      if (p.extra) segs.push({t: p.extra, k: 'sid'});
      else out.notes.push('Filed SID ' + out.filedSid + ' already matches.');
    } else {
      segs.push({t: p.text, k: 'sid'});
      if (out.filedSid){ segs.push({t: out.filedSid, k: 'fsid'}); out.notes.push('Filed SID ' + out.filedSid + ' does not match; correct procedure added in red.'); }
    }
  } else if (out.filedSid) segs.push({t: out.filedSid, k: 'fsid'});
  amd.forEach(t => segs.push({t, k: 'amd'}));
  rest.forEach(t => segs.push({t, k: ''}));
  if (fp.arrival) segs.push({t: fp.arrival, k: ''});
  out.segs = segs; out.amdTokens = amd; out.rest = rest;
  return out;
}
function routeHTML(segs){
  return segs.map(s => s.k ? '<span class="r-' + s.k + '">' + esc(s.t) + '</span>' : esc(s.t)).join(' ');
}

function stripHTML(x){
  const fp = x.fp || {};
  const sq = fp.assigned_transponder && fp.assigned_transponder !== '0000' ? fp.assigned_transponder : '—';
  const type = fp.aircraft_faa || fp.aircraft_short || fp.aircraft || '—';
  const rules = fp.flight_rules === 'V' ? '<span class="fs-tag vfr">VFR</span>' : '';
  const tag = (x.kind === 'pre' ? '<span class="fs-tag pre">Prefile</span>' : '<span class="fs-tag gnd">Ground</span>') +
    (x.test ? '<span class="fs-tag tst">Test</span><button type="button" class="fs-del" data-del="' + esc(x.id) + '" aria-label="Delete test strip ' + esc(x.callsign) + '" title="Delete test strip">×</button>' +
      '<button type="button" class="fs-sid" data-sid="' + esc(x.id) + '" aria-pressed="' + (x.applied ? 'true' : 'false') + '" title="' + (x.applied ? 'Show the route as filed' : 'Apply the SOP departure procedure') + '">' + (x.applied ? 'Undo' : '+SID') + '</button>' : '');
  const rmk = String(fp.remarks || '').trim();
  const plan = planDeparture(x);
  const clsLabel = {JET: 'JET', TPROP: 'T-PROP', PROP: 'PROP'}[plan.cls];
  const warnList = plan.flags.concat(plan.warns);
  const warn = warnList.length ? '<span class="r-warn">' + (plan.flags.length ? '' : 'CHECK: ') + esc(warnList[0]) + (warnList.length > 1 ? ' (+' + (warnList.length - 1) + ')' : '') + '</span> ' : '';
  const procDet = [
    ['Departure procedure', plan.proc ? plan.proc.text : '—'],
    ['Why', plan.proc ? plan.proc.why : (plan.flags.concat(plan.notes).join(' ') || '—')],
    ['Initial altitude', plan.proc ? (plan.proc.climbVia ? 'Climb via SID' : 'Maintain ' + A.initialAlt.toLocaleString()) : '—'],
    ['Exit / gate', plan.exit ? plan.exit + (plan.gate ? ' · ' + GATE[plan.gate] : ' · not a valid exit') : '—'],
    ['Common Amendment', plan.amended || 'None'],
    ['Exit restrictions', plan.warns.length ? plan.warns.join(' ') : (plan.gate ? 'None' : '—')],
    ['Filed SID', plan.filedSid || 'None'],
    ['Class / RNAV', clsLabel + ' · ' + (plan.rnav.known ? (plan.rnav.ok ? 'RNAV /' : 'Not RNAV /') + plan.rnav.suffix : 'RNAV assumed (no suffix)')]
  ];
  const notes = plan.flags.concat(plan.notes);
  const det = [
    ['Flight rules', fp.flight_rules === 'V' ? 'VFR' : fp.flight_rules === 'I' ? 'IFR' : (fp.flight_rules || '—')],
    ['Aircraft', fp.aircraft || '—'], ['ICAO type', fp.aircraft_short || '—'],
    ['Departure', fp.departure || '—'], ['Arrival', fp.arrival || '—'], ['Alternate', fp.alternate || '—'],
    ['Cruise altitude', fp.altitude || '—'], ['Cruise TAS', fp.cruise_tas ? fp.cruise_tas + ' kt' : '—'],
    ['En-route time', hhmm(fp.enroute_time)], ['Fuel on board', hhmm(fp.fuel_time)],
    ['Assigned squawk', sq], ['Flight plan revision', fp.revision_id ?? '—']
  ];
  if (x.kind === 'gnd') det.push(['Position', x.nm.toFixed(1) + ' nm from ' + A.id + ', ' + (x.gs | 0) + ' kt'], ['Squawking now', x.xpdr || '—']);
  // helicopters leave via the bridges (VFR pages), not the taxi table
  const HELO = /^(EC[0-9]{2}|AS[0-9]{2}|B06|B407|B412|B429|B505|R22|R44|R66|S76|S92|A109|A119|A139|A169|AW[0-9]{2,3}|H60|UH60|H135|H145|H160|EC75)$/;
  const tx = HELO.test(fp.aircraft_short || '') || !A.taxiFor ? null : A.taxiFor(x);
  const txWhere = tx ? tx.where : '';
  const txBand = tx ? '<div class="fs-taxi">' +
      '<span><span class="tx-k">Parked</span>' + esc(txWhere) + '</span>' +
      '<span><span class="tx-k">Side</span>' + esc(tx.sideLabel) + (tx.predicted ? ' <span class="tx-pred">(predicted from airline)</span>' : '') + '</span>' +
      '<span><span class="tx-k">Taxi</span>' + (tx.out ? 'RWY ' + esc(tx.rwy) + ' via ' + esc(tx.out) : (tx.key ? 'Not in SOP table (Depart ' + esc(tx.rwy) + ')' : 'No active configuration')) + '</span>' +
    '</div>' : '';
  if (tx) det.unshift(['Taxi (SOP preferred)', tx.out ? 'RUNWAY ' + tx.rwy + ', TAXI VIA ' + tx.out.toUpperCase() : '—'], ['Parked', txWhere + (tx.m !== undefined ? ' (' + tx.m + ' m)' : '')]);
  const key = x.id || x.callsign;
  fs.byKey[key] = x;
  const hs = '<button type="button" class="fs-clr" data-clr="' + esc(key) + '" aria-label="Clearance for ' + esc(x.callsign) + '" title="Read the clearance">' + HEADSET_SVG + '</button>' +
    '<a class="fs-prd" data-prd href="https://nyartcc.org/prd?from=' + encodeURIComponent(fp.departure || ICAO) + (fp.arrival ? '&to=' + encodeURIComponent(fp.arrival) : '') +
    '" target="_blank" rel="noopener" aria-label="ZNY PRD routes ' + esc((fp.departure || ICAO) + ' to ' + (fp.arrival || '')) + '" title="Open the ZNY PRD for ' + esc((fp.departure || ICAO) + ' → ' + (fp.arrival || '?')) + '">PRD</a>';
  return '<details class="fs' + (x.test ? ' test' : '') + '" data-q="' + esc((x.callsign + ' ' + type + ' ' + (fp.route || '') + ' ' + (fp.arrival || '')).toUpperCase()) + '">' +
    '<summary><div class="fs-grid">' +
      hs + '<div class="fs-c1 r1">' + esc(x.callsign) + '</div>' +
      '<div class="fs-c1 r2">' + esc(type) + '</div>' +
      '<div class="fs-c1 r3">' + tag + rules + '</div>' +
      '<div class="fs-c2 r1">' + esc(sq) + '</div>' +
      '<div class="fs-c2 r2"><button type="button" class="fs-cls" data-cls="' + esc(x.callsign) + '" title="Jet / turboprop / prop. Click to change.">' + clsLabel + '</button></div>' +
      '<div class="fs-c2 r3">' + esc(alt3(fp.altitude)) + '</div>' +
      '<div class="fs-cp"><span>' + esc(fp.departure || '—') + '&nbsp;&nbsp;' + esc(fp.arrival || '—') + '</span>' +
        (plan.gate ? '<span class="fs-gate" title="' + esc(GATE[plan.gate]) + ' gate (' + esc(plan.exit) + ')" aria-label="' + esc(GATE[plan.gate]) + ' gate">' + plan.gate + '</span>'
                   : (fp.route && fp.flight_rules !== 'V' ? '<span class="fs-gate none" title="No valid exit">?</span>' : '')) + '</div>' +
      '<div class="fs-rt">' + (fp.route ? ((!x.test || x.applied) ? routeHTML(plan.segs) : esc([fp.departure || ICAO, fp.route, fp.arrival || ''].join(' ').trim())) : esc((fp.departure || '') + ' NO ROUTE FILED ' + (fp.arrival || ''))) + '</div>' +
      '<div class="fs-rm" title="' + esc(warnList.concat(plan.notes, [rmk]).join(' · ')) + '">' + warn + esc(rmk || ' ') + '</div>' +
      txBand +
    '</div></summary>' +
    '<div class="fs-detail">' + procDet.map(d => '<div' + (d[0] === 'Why' || d[0] === 'Exit restrictions' ? ' class="wide"' : '') + (d[0] === 'Exit restrictions' && plan.warns.length ? ' style="color:#e10600;font-weight:700"' : '') + '><b>' + esc(d[0]) + '</b>' + esc(String(d[1])) + '</div>').join('') +
      (notes.length ? '<div class="wide"><b>Notes</b>' + esc(notes.join(' ')) + '</div>' : '') +
      '<div class="wide"><b>Filed route</b>' + esc(fp.route || '—') + '</div>' +
      det.map(d => '<div><b>' + esc(d[0]) + '</b>' + esc(String(d[1])) + '</div>').join('') +
      '<div class="wide"><b>Remarks</b>' + esc(rmk || '—') + '</div>' +
    '</div></details>';
}

function renderStrips(){
  const out = $('fs-out');
  fs.byKey = {};
  if (!fs.loaded && !fs.test.length){ out.innerHTML = '<p class="muted">No strips loaded yet. Press Load strips, or add a test strip.</p>'; return; }
  const pre = fs.prefiles.filter(p => p.flight_plan && p.flight_plan.departure === ICAO)
    .map(p => ({kind: 'pre', callsign: p.callsign, fp: p.flight_plan}));
  const gnd = [], other = [];
  fs.test.forEach(t => (t.kind === 'pre' ? pre : gnd).push(t));
  fs.pilots.forEach(p => {
    if (typeof p.latitude !== 'number') return;
    const nm = nmFromAirport(p.latitude, p.longitude);
    if (nm > A.groundNm || (p.groundspeed || 0) > 40) return;
    const x = {kind: 'gnd', callsign: p.callsign, fp: p.flight_plan || {}, nm, gs: p.groundspeed, xpdr: p.transponder, lat: p.latitude, lon: p.longitude};
    if (!p.flight_plan) other.push(x);                          // no flight plan filed yet
    else if (p.flight_plan.departure === ICAO) gnd.push(x);   // departures from this airport
    // anything else on the ground (arrivals, other departure airports) is left out
  });
  const byCs = (a, b) => a.callsign.localeCompare(b.callsign);
  const group = (title, list, empty) => '<div class="fs-group"><h3>' + esc(title) + ' · ' + list.length + '</h3>' +
    (list.length ? '<div class="fs-list">' + list.sort(byCs).map(stripHTML).join('') + '</div>' : '<p class="muted">' + esc(empty) + '</p>') + '</div>';
  out.innerHTML =
    group('On the ground, departing ' + A.id, gnd, fs.loaded ? 'No aircraft on the ground with a ' + ICAO + ' departure plan.' : 'Live strips not loaded yet.') +
    group('Prefiled out of ' + A.id, pre, fs.loaded ? 'No prefiles out of ' + ICAO + '.' : 'Live strips not loaded yet.') +
    (other.length ? group('On the ground, no flight plan yet', other, '') : '');
  applyFsFilter();
}
function applyFsFilter(){
  const q = $('fs-filter').value.trim().toUpperCase();
  document.querySelectorAll('#fs-out details.fs').forEach(d => { d.hidden = !!q && !d.dataset.q.includes(q); });
}
$('fs-filter').addEventListener('input', applyFsFilter);

// Test strips: kept in this browser only.
fs.test = store.get('teststrips', []);
if (!Array.isArray(fs.test)) fs.test = [];
const saveTests = () => store.set('teststrips', fs.test);
renderStrips();
const SAMPLE_FLIGHTS = A.samples.map(r => ({callsign:r[0], type:r[1], arr:r[2], alt:r[3], route:r[4], rmk:r[5], rules:r[6]}));
const randSquawk = () => Math.random() < .4 ? '' : (2 + Math.floor(Math.random() * 5)) + [0,0,0].map(() => Math.floor(Math.random() * 8)).join('');
function pickSample(){
  const used = new Set(fs.test.map(t => t.callsign));
  const pool = SAMPLE_FLIGHTS.filter(f => !used.has(f.callsign));
  const list = pool.length ? pool : SAMPLE_FLIGHTS;
  return list[Math.floor(Math.random() * list.length)];
}
function makeTest(f, kind, sq){
  return {id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), test: true, kind, callsign: f.callsign, nm: 0, gs: 0, xpdr: sq || '1200',
    fp: {flight_rules: f.rules, aircraft: f.type, aircraft_faa: f.type, aircraft_short: (f.type.split('/').find(s => s.length >= 3) || ''),
         departure: ICAO, arrival: f.arr, alternate: f.alt2 || '', cruise_tas: f.tas || '', altitude: f.alt, route: f.route, remarks: f.rmk,
         assigned_transponder: sq || '0000', enroute_time: '', fuel_time: '', revision_id: 'test'}};
}
$('fs-addtest').addEventListener('click', () => {
  const f = pickSample();
  fs.test.push(makeTest(f, Math.random() < .5 ? 'gnd' : 'pre', randSquawk()));
  saveTests(); renderStrips();
  fsStatus('Added test strip ' + f.callsign + ' (' + f.type + ' to ' + f.arr + ').');
});
$('fs-custom').addEventListener('click', () => {
  const d = $('pop-fstest');
  try { d.showModal(); } catch(e){ d.setAttribute('open', ''); }
  $('fst-cs').focus(); $('fst-cs').select();
});
$('fst-random').addEventListener('click', () => {
  const f = pickSample();
  $('fst-cs').value = f.callsign; $('fst-type').value = f.type; $('fst-sq').value = randSquawk(); $('fst-alt').value = f.alt;
  $('fst-dep').value = ICAO; $('fst-arr').value = f.arr; $('fst-route').value = f.route; $('fst-rmk').value = f.rmk;
  $('fst-rules').value = f.rules; $('fst-kind').value = Math.random() < .5 ? 'gnd' : 'pre';
});
$('fst-form').addEventListener('submit', e => {
  e.preventDefault();
  const v = id => $(id).value.trim().toUpperCase();
  const cs = v('fst-cs'); if (!cs) return;
  fs.test.push({
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    test: true, kind: $('fst-kind').value, callsign: cs, nm: 0, gs: 0, xpdr: v('fst-sq') || '1200',
    fp: {flight_rules: $('fst-rules').value, aircraft: v('fst-type'), aircraft_faa: v('fst-type'),
         aircraft_short: (v('fst-type').split('/').find(s => s.length >= 3) || ''),
         departure: v('fst-dep'), arrival: v('fst-arr'), alternate: v('fst-alt2'), cruise_tas: v('fst-tas'),
         altitude: v('fst-alt'), route: v('fst-route'), remarks: v('fst-rmk'),
         assigned_transponder: v('fst-sq') || '0000', enroute_time: '', fuel_time: '', revision_id: 'test'}
  });
  saveTests();
  $('pop-fstest').close();
  // bump the example callsign so the next one is different
  const m = cs.match(/^(.*?)(\d+)$/); if (m) $('fst-cs').value = m[1] + (+m[2] + 1);
  renderStrips();
});
$('fs-out').addEventListener('pointerdown', e => {
  const a = e.target.closest('[data-prd]'); if (a){ const d = a.closest('details'); if (d) d.dataset.wasOpen = d.open ? '1' : '0'; }
}, true);
$('fs-out').addEventListener('click', e => {
  const c = e.target.closest('[data-cls]');
  if (c){
    e.preventDefault(); e.stopPropagation();
    const cs = c.dataset.cls, cur = c.textContent.trim();
    const next = {JET: 'TPROP', 'T-PROP': 'PROP', PROP: 'JET'}[cur] || 'JET';
    clsStore[cs] = next; store.set('acclass', clsStore);
    renderStrips();
    return;
  }
  const sb = e.target.closest('[data-sid]');
  if (sb){
    e.preventDefault(); e.stopPropagation();   // don't open the strip
    const t = fs.test.find(t => t.id === sb.dataset.sid);
    if (t){ t.applied = !t.applied; saveTests(); renderStrips(); }
    return;
  }
  const b = e.target.closest('[data-del]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();   // don't open the strip
  fs.test = fs.test.filter(t => t.id !== b.dataset.del);
  saveTests();
  renderStrips();
});

async function loadStrips(){
  if (!DIRECT && !mcp){ fsStatus('Live strips need this page open in the Claude desktop app.', true); return; }
  if (state.busy){ fsStatus('Busy reading ATIS. Try again in a moment.'); return; }
  state.busy = true; $('fs-refresh').disabled = true;
  try {
    fsStatus('Reading the VATSIM data feed (about 2 MB)…');
    let raw = '';
    if (DIRECT) raw = await directText(FEED);
    else {
      await openUrl(FEED);
      for (let i = 0; i < 4; i++){
        raw = bodyOf(await readPage(4000000));
        if (raw.includes('"pilots"')) break;
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (!raw.includes('"pilots"')) throw {code: 'tool_error', message: 'feed not readable'};
    const p = extractArray(raw, 'pilots'), f = extractArray(raw, 'prefiles');
    fs.pilots = p.items; fs.prefiles = f.items; fs.loaded = true;
    fs.controllers = extractArray(raw, 'controllers').items;
    fs.ts = (raw.match(/"update_timestamp"\s*:\s*"([^"]+)"/) || [])[1] || '';
    fs.complete = p.complete && f.found && f.complete;
    renderStrips();
    const when = fs.ts ? fs.ts.slice(11, 19) + 'Z' : 'unknown time';
    fsStatus('VATSIM feed from ' + when + ' · ' + fs.pilots.length + ' pilots and ' + fs.prefiles.length + ' prefiles network-wide.' +
      (fs.complete ? '' : ' The feed came through cut off at ' + raw.length.toLocaleString() + ' characters, so some aircraft may be missing.'), !fs.complete);
  } catch(e){
    fsStatus(errMsg(e), true);
  } finally {
    state.busy = false; $('fs-refresh').disabled = false;
  }
}
$('fs-refresh').addEventListener('click', loadStrips);
let fsTimer = null;
$('fs-auto').addEventListener('change', e => {
  if (fsTimer){ clearInterval(fsTimer); fsTimer = null; }
  if (e.target.checked){ loadStrips(); fsTimer = setInterval(() => { if (!document.hidden && !$(A.stripsPage).hidden) loadStrips(); }, 30000); }
});

const DEP_FREQS = A.depFreqs;   // SOP › Departure Frequency, in order
function depFreqStatus(){
  const rows = DEP_FREQS.map(d => {
    const c = (fs.controllers || []).find(c => String(c.frequency) === d.freq && d.ok(c));
    return Object.assign({}, d, {online: !!c, by: c ? c.callsign : ''});
  });
  return {rows, pick: rows.find(r => r.online) || null, known: fs.loaded};
}
const sayAlt = n => n >= 18000 ? 'FLIGHT LEVEL ' + String(n / 100) : n.toLocaleString();
function buildClearance(x){
  const fp = x.fp || {}, plan = planDeparture(x), ctx = state.ctx;
  const cs = x.callsign, warn = [], parts = [];
  const sq = fp.assigned_transponder && fp.assigned_transponder !== '0000' ? fp.assigned_transponder : '';
  const df = depFreqStatus();
  const noFreqs = !DEP_FREQS.length;   // the airport's SOP gives no departure-frequency order
  const freqTxt = noFreqs ? 'DEPARTURE FREQUENCY (FREQUENCY)' : df.pick ? 'DEPARTURE FREQUENCY ' + df.pick.say : (df.known ? 'DEPARTURE IS OFFLINE' : 'DEPARTURE FREQUENCY (FREQUENCY)');
  if (noFreqs) warn.push('The SOP lists no departure frequency: get it from N90 and say it in place of (FREQUENCY).');
  else if (!df.known) warn.push('Who’s online is unknown: press Load strips to read the VATSIM controller list.');
  else if (!df.pick) warn.push('None of the SOP departure positions is online. Per the SOP, advise the pilot that Departure is offline.');
  if (!sq) warn.push('No squawk assigned yet: assign a code and read it in place of (CODE).');
  const sqTxt = 'SQUAWK ' + (sq || '(CODE)');
  if (A.apreq.includes(fp.arrival)) warn.push('Destination is a New York Metro airport: keep the aircraft on the ground until the APREQ is approved.');
  if (!ctx){ return {text: '', html: '<p class="clr-warn">No active ' + esc(A.id) + ' configuration. Load or paste the ' + esc(A.id) + ' ATIS, or use Test mode, so the page knows the departure runway.</p>', rows: [], warn, df}; }

  if (fp.flight_rules === 'V'){
    const svd = A.svdFor ? A.svdFor(ctx, plan.gate, plan.cls) : null;
    if (!svd) return {text: '', html: '<p class="clr-warn">The SOP gives no VFR departure clearance for this configuration. Issue VFR instructions per the 7110.65.</p>', rows: [], warn, df};
    const html = esc(cs) + ', ' + esc(A.vfrPrefix) + ' <span class="r-sid">' + esc(svd.via) + '</span>, MAINTAIN ' + esc(sayAlt(svd.alt)) + ', ' + esc(freqTxt) + ', ' + esc(sqTxt) + '.';
    if (svd.note) warn.unshift(svd.note);
    return {html, text: html.replace(/<[^>]+>/g, ''), warn, df, rows: [
      ['Departure instructions', svd.via + ' (SVD, departing ' + ctx.pair.dep + ')'], ['Altitude', 'Maintain ' + sayAlt(svd.alt)],
      ['Frequency', df.pick ? df.pick.name + ' ' + df.pick.say + ' (same as IFR departures)' : freqTxt], ['Squawk', sq || 'not assigned']]};
  }

  warn.push(...plan.flags, ...plan.warns);
  const p = plan.proc;
  let depHTML;
  if (!p) depHTML = '<span class="clr-warn">(DEPARTURE PROCEDURE)</span>';
  else depHTML = '<span class="r-sid">' + esc(A.depPhrase ? A.depPhrase(p) : p.text + ' DEPARTURE') + '</span>';
  // Radar vectors to the exit, through any SOP amendment, then as filed
  const amd = plan.amdTokens || [], rest = plan.rest || [];
  let vecHTML;
  if (amd.length){
    const path = amd.map(t => '<span class="r-amd">' + esc(t) + '</span>').concat(rest[0] ? [esc(rest[0])] : []);
    vecHTML = 'RADAR VECTORS ' + path[0] + (path.length > 1 ? ', ' + path.slice(1).join(' ') : '') + ', THEN AS FILED';
  } else vecHTML = 'RADAR VECTORS ' + (plan.exit ? esc(plan.exit) : '<span class="clr-warn">(EXIT GATE)</span>') + ', THEN AS FILED';
  const cruise = altFeet(fp.altitude);
  const init = cruise !== null && cruise < A.initialAlt ? cruise : A.initialAlt;
  let altTxt = !p ? 'MAINTAIN ' + sayAlt(A.initialAlt) : p.climbVia ? (init < A.initialAlt ? 'CLIMB VIA SID, EXCEPT MAINTAIN ' + sayAlt(init) : 'CLIMB VIA SID') : 'MAINTAIN ' + sayAlt(init);
  const expTxt = cruise === null ? 'EXPECT (FILED ALTITUDE) 10 MINUTES AFTER DEPARTURE' : (cruise > init ? 'EXPECT ' + sayAlt(cruise) + ' 10 MINUTES AFTER DEPARTURE' : '');
  if (cruise === null) warn.push('Filed altitude not readable: say the filed altitude in place of (FILED ALTITUDE).');
  const html = esc(cs) + ', CLEARED TO ' + esc(fp.arrival || '(CLEARANCE LIMIT)') + ' AIRPORT, ' + depHTML + ', ' + vecHTML + '. ' + esc(altTxt) + '. ' + (expTxt ? esc(expTxt) + '. ' : '') + esc(freqTxt) + '. ' + esc(sqTxt) + '.';
  if (p && /#/.test(p.text)) warn.push('# = say the current number from the chart: ' + (A.sidSpoken ? A.sidSpoken(p.base) : p.base.replace('#', '')) + ' (NUMBER) DEPARTURE.');
  if (plan.filedSid && p && plan.filedSid.replace(/\d$/, '#') !== p.base) warn.push('Pilot filed ' + plan.filedSid + '; the clearance amends it to the SOP procedure.');
  if (amd.length) warn.push('Route amended per the SOP (' + plan.amended + '). Make sure the pilot reads back the amended route.');
  return {html, text: html.replace(/<[^>]+>/g, ''), warn, df, rows: [
    ['Clearance limit', fp.arrival || '—'],
    ['Departure procedure', p ? p.text + ' — ' + p.why : 'None assigned'],
    ['Route', 'Radar vectors ' + (amd.length ? amd.concat(rest[0] ? [rest[0]] : []).join(' ') : plan.exit || '—') + ', then as filed'],
    ['Altitude', altTxt + (p ? ' (' + (A.altNote ? A.altNote(p) : 'SOP initial altitude ' + A.initialAlt.toLocaleString() + ', or cruise if lower') + ')' : '')],
    ['Expect', expTxt || 'Not needed: cleared to the filed altitude'],
    ['Frequency', df.pick ? df.pick.name + ' ' + df.pick.say + ' (' + df.pick.by + ' online)' : freqTxt],
    ['Squawk', sq || 'not assigned']]};
}
function openClearance(x){
  const c = buildClearance(x);
  $('pop-clr-h').textContent = 'Clearance · ' + x.callsign;
  const freqRows = c.df.rows.map(r => '<tr><td>' + esc(r.name) + '</td><td class="num">' + esc(r.say) + '</td><td>' +
      (!c.df.known ? '<span class="off">Unknown</span>' : r.online ? '<span class="on">Online · ' + esc(r.by) + '</span>' : '<span class="off">Offline</span>') + '</td></tr>').join('');
  $('clr-body').innerHTML =
    (c.html ? '<div class="clr-text" id="clr-text">' + c.html + '</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="clr-copy">Copy clearance</button></div>' : c.html) +
    (c.warn.length ? '<ul>' + c.warn.map(w => '<li class="clr-warn">' + esc(w) + '</li>').join('') + '</ul>' : '') +
    (c.rows.length ? '<div class="tw"><table><tbody>' + c.rows.map(r => '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
    (DEP_FREQS.length ? '<h3>Departure frequency (SOP order)</h3><div class="tw"><table><thead><tr><th>Position</th><th>Frequency</th><th>Status</th></tr></thead><tbody>' + freqRows + '</tbody></table></div>' +
    '<p class="note">The first online position takes departures. Confirm with the online controllers; the SOP list is a guide.' + (fs.ts ? ' Controller list from the VATSIM feed at ' + esc(fs.ts.slice(11, 19)) + 'Z.' : '') + '</p>' : '');
  const cp = $('clr-copy');
  if (cp) cp.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(c.text); cp.textContent = 'Copied'; }
    catch(e){ const r = document.createRange(); r.selectNodeContents($('clr-text')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); cp.textContent = 'Selected: press Ctrl/Cmd+C'; }
  });
  const d = $('pop-clr');
  try { d.showModal(); } catch(e){ d.setAttribute('open', ''); }
}
$('fs-out').addEventListener('click', e => {
  if (e.target.closest('[data-prd]')){ e.stopPropagation(); setTimeout(() => { const d = e.target.closest('details'); if (d) d.open = d.dataset.wasOpen === '1'; }, 0); return; }
  const b = e.target.closest('[data-clr]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const x = fs.byKey[b.dataset.clr];
  if (x) openClearance(x);
}, true);

/* ---------- controls ---------- */
$('refresh').addEventListener('click', refresh);
// ATIS source per airport card: a momentary override, never saved, so every load starts on Auto
document.querySelector('.strips').addEventListener('click', e => {
  const b = e.target.closest('button[data-src]'); if (!b) return;
  const ap = b.dataset.ap; if (!ap || b.dataset.src === atisSrc[ap]) return;
  atisSrc[ap] = b.dataset.src;
  renderCard(ap);
  if (state.busy){ const w = setInterval(() => { if (!state.busy){ clearInterval(w); refresh(); } }, 250); }
  else refresh();
});
let timer = null;
const autoEl = $('auto');
autoEl.checked = !!store.get('auto', true);
function setAuto(on){
  store.set('auto', on);
  if (timer){ clearInterval(timer); timer = null; }
  if (on) timer = setInterval(() => { if (!document.hidden) refresh(); }, 120000);
}
autoEl.addEventListener('change', () => { setAuto(autoEl.checked); if (autoEl.checked) refresh(); });

renderAll();

(async () => {
  if (DIRECT){
    setStatus('Ready. Refresh reads live ATIS directly from VATSIM, with real-world D-ATIS where VATSIM has none.');
    fsStatus('Strips load directly from the VATSIM data feed.');
    setAuto(autoEl.checked);
    refresh();
    return;
  }
  try { mcp = window.claude && window.claude.use ? await window.claude.use('mcp') : null; } catch(e){ mcp = null; }
  if (!mcp){ setStatus('Live ATIS works when this page is open in the Claude desktop app. Paste an ATIS into any strip to use the Playbook here.'); return; }
  setStatus('Ready. Refresh reads live ATIS through the desktop app\'s browser.');
  setAuto(autoEl.checked);
  refresh();
})();
}};
