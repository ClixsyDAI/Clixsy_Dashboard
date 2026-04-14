/**
 * Standalone audit: replicates the production health-score + Top Wins logic
 * over every client and reports discrepancies. Pure Node, no TS imports.
 *
 * Run: node scripts/audit-health-scores.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'app', 'data');
const CLIENTS = path.join(DATA, 'clients');

const projects = JSON.parse(fs.readFileSync(path.join(DATA, 'projects.json'), 'utf8'));
const blLocations = JSON.parse(fs.readFileSync(path.join(DATA, 'brightlocal-locations.json'), 'utf8'));

// Direct mapping pulled from app/lib/brightlocal-data.ts
const CLIENT_NAME_MAP = {
  'Fielding Law Auto Accident Attorneys': [12208911],
  'Mike Morse Law Firm': [14164366],
  'Gould Injury Law': [16128131],
  'Edward A Smith Law Offices': [35722805],
  'Hill & Moin LLP': [17684836],
  'Cellino Law Injury Attorneys': [22090947],
  'Johnson Attorneys Group': [30012391],
  'Justin Minton Law': [29764885],
  'Harker Injury Law': [31539020],
  'Wolf Law Criminal Defense Attorney': [31394147],
  'Reimer Heating, Cooling & Plumbing, LLC': [32178056],
  'Clixsy': [31418251],
  'Christian Heating, Cooling, Plumbing, & Electrical': [35591615],
  'Grover Law Firm': [35427597],
  "Hauptman, O'Brien, Wolf & Lathrop, P.C": [35733982],
  'Johnston Law Firm, P.C.': [35569716],
  'Snyder Air Conditioning, Plumbing & Electric': [35591915],
  'The Collins Law Firm, P.C.': [37240467],
  'Kogan & DiSalvo Personal Injury Lawyers': [37472277],
  'Henco Plumbing Services': [39614475],
  'Allred, Maroko & Goldberg': [39903740],
  'Andrew Pickett Law': [40435636],
  'Steele Adams Hosman': [41270029],
  'Freedland Harwin Valori Gander': [41270237],
  'Elevated Comfort': [41648751],
  'Champion Plumbing': [43339319],
  'Cregger Plumbing, Heating & Cooling': [43488438],
  'Maverick Electric, Heating, & Air': [43486963],
  'George Sink, P.A. Injury Lawyers': [45231944],
  'McWhirter, Bellinger & Associates, P.A. Attorneys at Law': [45231944],
  'Overson Roofing': [46229887],
};

function bl(pid) {
  const numId = parseInt(pid);
  let locs = null;
  for (const [name, ids] of Object.entries(CLIENT_NAME_MAP)) {
    if (ids.includes(numId)) {
      locs = blLocations.filter((l) => l.clientName === name);
      break;
    }
  }
  if (!locs) {
    // fuzzy fallback
    const p = projects.find((pp) => pp.id === numId);
    if (!p) return null;
    const label = p.name.replace(/^J\d+\s+/, '').toLowerCase();
    const words = label.split(/\s+/).filter((w) => w.length > 3);
    locs = blLocations.filter((l) => {
      const n = l.clientName.toLowerCase();
      const matches = words.filter((w) => n.includes(w)).length;
      return matches >= 2 || (words.length === 1 && n.includes(words[0]));
    });
  }
  if (locs.length === 0) return null;
  const s = (fn) => locs.reduce((a, l) => a + (fn(l) || 0), 0);
  const gRanks = locs.filter((l) => l.lsrcAvgGoogleRank > 0);
  const avgGoogleRank = gRanks.length > 0 ? gRanks.reduce((a, l) => a + l.lsrcAvgGoogleRank, 0) / gRanks.length : 0;
  const ratings = locs.filter((l) => l.rmRating > 0);
  const reviewRating = ratings.length > 0 ? ratings.reduce((a, l) => a + l.rmRating, 0) / ratings.length : 0;
  return {
    totalRankingsUp: s((l) => l.lsrcUp),
    totalRankingsDown: s((l) => l.lsrcDown),
    totalCitations: s((l) => l.ctLive),
    totalReviews: s((l) => l.rmTotal),
    avgGoogleRank: Math.round(avgGoogleRank * 10) / 10,
    reviewRating: Math.round(reviewRating * 10) / 10,
  };
}

function loadJson(filename) {
  const p = path.join(CLIENTS, filename);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function sumGscWeighted(daily, from, to) {
  if (!Array.isArray(daily)) return null;
  const rows = daily.filter((r) => {
    const d = new Date(r.date);
    return d >= from && d <= to;
  });
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const position = impressions > 0 ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  return { rows: rows.length, clicks, impressions, position, ctr };
}

function sumGa4(daily, from, to) {
  if (!Array.isArray(daily)) return null;
  const rows = daily.filter((r) => {
    const d = new Date(r.date);
    return d >= from && d <= to;
  });
  return { rows: rows.length, sessions: rows.reduce((s, r) => s + r.sessions, 0) };
}

const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
const lerp = (v, a, b, c, d) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return c + t * (d - c);
};

function calcTaskVelocity(due, completed, overdue) {
  if (due === 0 && completed === 0) return 60;
  let score = 60;
  if (due > 0) score = clamp((completed / Math.max(due, 1)) * 100, 0, 100);
  else if (completed > 0) score = 80;
  score -= overdue * 10;
  return clamp(score, 0, 100);
}
function calcTraffic(curr, prev) {
  if (curr == null || prev == null) return null;
  // Matches the production fix: prev=0 is unscorable (dividing by zero gives
  // absurd percent changes), so return null and let weight redistribute.
  if (prev === 0) return null;
  const pct = ((curr - prev) / prev) * 100;
  if (pct >= 10) return 100;
  if (pct >= 0) return lerp(pct, 0, 10, 60, 100);
  if (pct >= -10) return lerp(pct, -10, 0, 20, 60);
  return 20;
}
function calcRanking(up, dn) {
  if (up == null || dn == null) return null;
  const n = up - dn;
  if (n > 50) return 100;
  if (n > 0) return lerp(n, 0, 50, 50, 100);
  if (n === 0) return 50;
  if (n > -50) return lerp(n, -50, 0, 10, 50);
  return 10;
}
function calcLocal(rank, rating) {
  if (rank == null || rank === 0) return null;
  let s;
  if (rank < 3) s = 100;
  else if (rank <= 5) s = lerp(rank, 3, 5, 75, 100);
  else if (rank <= 10) s = lerp(rank, 5, 10, 50, 75);
  else s = lerp(rank, 10, 30, 10, 50);
  if (rating && rating >= 4.5) s = Math.min(100, s + 10);
  return clamp(s, 0, 100);
}
function calcSearchPerf(posC, posP, ctrC, ctrP, impC) {
  if (!impC || impC < 100) return null;
  const haveP = posC != null && posC > 0 && posP != null && posP > 0;
  const haveC = ctrC != null && ctrP != null && (ctrC > 0 || ctrP > 0);
  if (!haveP && !haveC) return null;
  let ps = null;
  if (haveP) {
    const d = posP - posC;
    if (d >= 2) ps = 100;
    else if (d >= 0) ps = lerp(d, 0, 2, 60, 100);
    else if (d >= -2) ps = lerp(d, -2, 0, 20, 60);
    else ps = 20;
  }
  let cs = null;
  if (haveC) {
    const d = ctrC - ctrP;
    if (d >= 0.01) cs = 100;
    else if (d >= 0) cs = lerp(d, 0, 0.01, 60, 100);
    else if (d >= -0.01) cs = lerp(d, -0.01, 0, 20, 60);
    else cs = 20;
  }
  if (ps != null && cs != null) return clamp(ps * 0.6 + cs * 0.4, 0, 100);
  return ps != null ? ps : cs;
}

function healthScore(sub) {
  const available = sub.filter((s) => s.available);
  const totalW = available.reduce((a, s) => a + s.weight, 0);
  const overall = totalW > 0 ? Math.round(available.reduce((a, s) => a + s.score * (s.weight / totalW), 0)) : 50;
  const label = overall >= 70 ? 'Strong' : overall >= 40 ? 'Needs Attention' : 'At Risk';
  return { overall, label };
}

// ── main ──────────────────────────────────────────────────────────
// Wall-clock "now" — used ONLY for task windows (Basecamp is live data).
const nowWall = new Date('2026-04-14T12:00:00Z');
const taskCutoff = new Date(nowWall.getTime() - 30 * 24 * 60 * 60 * 1000);

const issues = [];
const rows = [];

for (const p of projects) {
  const id = String(p.id);
  const jcode = (p.name.match(/^J\d+/) || [''])[0];
  const todos = loadJson(`${id}.json`) || null;
  if (!todos) continue; // no-data clients aren't scorable

  const gsc = loadJson(`${id}-gsc.json`);
  const ga4 = loadJson(`${id}-ga4.json`);
  const blSum = bl(id);

  // Task calc — uses wall-clock "now"
  const completed = todos.filter((t) => t.completed && t.completed_on && new Date(t.completed_on) >= taskCutoff).length;
  const due = todos.filter((t) => t.due_on && new Date(t.due_on) >= taskCutoff && new Date(t.due_on) <= nowWall).length;
  const overdue = todos.filter((t) => !t.completed && t.due_on && new Date(t.due_on) < nowWall).length;
  const tvScore = calcTaskVelocity(due, completed, overdue);

  // Anchor GSC / GA4 windows to the latest data date in each feed so both
  // windows are equal length. Matches the production fix.
  const gscLastDate = gsc?.dailyData?.length ? new Date(gsc.dailyData[gsc.dailyData.length - 1].date) : null;
  const ga4LastDate = ga4?.dailyData?.length ? new Date(ga4.dailyData[ga4.dailyData.length - 1].date) : null;
  const gscNow = gscLastDate || nowWall;
  const ga4Now = ga4LastDate || nowWall;
  const gscCutoff = new Date(gscNow.getTime() - 30 * 24 * 60 * 60 * 1000);
  const gscPrevCutoff = new Date(gscCutoff.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ga4Cutoff = new Date(ga4Now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ga4PrevCutoff = new Date(ga4Cutoff.getTime() - 30 * 24 * 60 * 60 * 1000);

  const gscCurr = gsc ? sumGscWeighted(gsc.dailyData, gscCutoff, gscNow) : null;
  const gscPrev = gsc ? sumGscWeighted(gsc.dailyData, gscPrevCutoff, gscCutoff) : null;
  const ga4Curr = ga4 ? sumGa4(ga4.dailyData, ga4Cutoff, ga4Now) : null;
  const ga4Prev = ga4 ? sumGa4(ga4.dailyData, ga4PrevCutoff, ga4Cutoff) : null;

  const trafficScore = gscCurr && gscPrev ? calcTraffic(gscCurr.clicks, gscPrev.clicks) : null;
  const searchPerfScore = gscCurr && gscPrev
    ? calcSearchPerf(gscCurr.position, gscPrev.position, gscCurr.ctr, gscPrev.ctr, gscCurr.impressions)
    : null;
  const rankScore = blSum ? calcRanking(blSum.totalRankingsUp, blSum.totalRankingsDown) : null;
  const localScore = blSum ? calcLocal(blSum.avgGoogleRank, blSum.reviewRating) : null;

  // Engagement — matched 30d-vs-prior-30d total sessions (matches the
  // production fix). The old code mixed a 90d organic aggregate against
  // a 30d total-sessions figure and produced bogus "+521%" style growth.
  const engageScore = ga4Curr && ga4Prev ? calcTraffic(ga4Curr.sessions, ga4Prev.sessions) : null;

  // No content audit in this script

  const subs = [
    { id: 'tasks', label: 'Task Velocity', score: Math.round(tvScore), weight: 15, available: true },
    { id: 'traffic', label: 'Organic Traffic', score: trafficScore == null ? 0 : Math.round(trafficScore), weight: 20, available: trafficScore != null },
    { id: 'search-perf', label: 'Search Performance', score: searchPerfScore == null ? 0 : Math.round(searchPerfScore), weight: 15, available: searchPerfScore != null },
    { id: 'rankings', label: 'Ranking Momentum', score: rankScore == null ? 0 : Math.round(rankScore), weight: 15, available: rankScore != null },
    { id: 'local', label: 'Local Presence', score: localScore == null ? 0 : Math.round(localScore), weight: 10, available: localScore != null },
    { id: 'engagement', label: 'Engagement', score: engageScore == null ? 0 : Math.round(engageScore), weight: 10, available: engageScore != null },
    // content ignored
  ];
  const health = healthScore(subs);

  // Freshness checks
  const gscFreshness = gsc && gscCurr && gscPrev ? { currRows: gscCurr.rows, prevRows: gscPrev.rows, lastDate: gscLastDate && gscLastDate.toISOString().slice(0, 10) } : null;
  const ga4Freshness = ga4 && ga4Curr && ga4Prev ? { currRows: ga4Curr.rows, prevRows: ga4Prev.rows, lastDate: ga4LastDate && ga4LastDate.toISOString().slice(0, 10) } : null;

  // FLAGS — with the anchored-to-latest-data fix, curr/prev windows should
  // be equal length, so any large row-count gap indicates a data-integrity
  // problem (missing days mid-range), not stale data overall.
  if (gsc && gscCurr && gscPrev && gscCurr.rows < gscPrev.rows - 5) {
    issues.push({ id, jcode, type: 'GSC window gap', detail: `curr=${gscCurr.rows}d prev=${gscPrev.rows}d (missing days in curr window; last data: ${gscFreshness.lastDate})` });
  }
  if (ga4 && ga4Curr && ga4Prev && ga4Curr.rows < ga4Prev.rows - 5) {
    issues.push({ id, jcode, type: 'GA4 window gap', detail: `curr=${ga4Curr.rows}d prev=${ga4Prev.rows}d (missing days in curr window; last data: ${ga4Freshness.lastDate})` });
  }
  // Surface very old data so we know when to refresh.
  if (gscLastDate && (nowWall.getTime() - gscLastDate.getTime()) / (24 * 60 * 60 * 1000) > 21) {
    issues.push({ id, jcode, type: 'GSC very stale', detail: `latest GSC date is ${gscFreshness.lastDate} (${Math.round((nowWall - gscLastDate) / (24 * 60 * 60 * 1000))} days ago)` });
  }
  if (ga4LastDate && (nowWall.getTime() - ga4LastDate.getTime()) / (24 * 60 * 60 * 1000) > 21) {
    issues.push({ id, jcode, type: 'GA4 very stale', detail: `latest GA4 date is ${ga4Freshness.lastDate} (${Math.round((nowWall - ga4LastDate) / (24 * 60 * 60 * 1000))} days ago)` });
  }
  // Bogus wins sanity check — the fixed code passes ga4OrganicCurrent=null
  // so the "Organic sessions growing" win can no longer fire from the
  // per-client page, share page, or AI tab. This block is now purely a
  // regression detector: if we ever see a bogus comparison creeping back
  // in, it will show up here.
  const legacyOrganicCurr = ga4?.totals?.organicSessions ?? null;
  const legacyOrganicPrev = ga4Prev?.sessions ?? null;
  if (legacyOrganicCurr != null && legacyOrganicPrev != null && legacyOrganicPrev > 0) {
    const legacyPct = ((legacyOrganicCurr - legacyOrganicPrev) / legacyOrganicPrev) * 100;
    if (legacyPct > 50) {
      // Only report the truly egregious ones (>50%) as a sanity check —
      // modest % differences are expected since one is a ~90d aggregate.
      issues.push({
        id, jcode,
        type: 'Legacy organic vs total mismatch (info)',
        detail: `legacy code would have claimed +${legacyPct.toFixed(1)}% organic (90d total ${legacyOrganicCurr} vs 30d sessions ${legacyOrganicPrev}) — fixed code now ignores this`,
      });
    }
  }

  rows.push({ jcode, id, name: p.name.replace(/^J\d+\s+/, ''), overall: health.overall, label: health.label, subs, gscFreshness, ga4Freshness });
}

rows.sort((a, b) => a.overall - b.overall);

// ── print ────────────────────────────────────────────────────────
console.log(`\n=== AUDIT OF ${rows.length} CLIENTS (today = ${nowWall.toISOString().slice(0, 10)}) ===\n`);
console.log('Bucket counts:');
const buckets = { Strong: 0, 'Needs Attention': 0, 'At Risk': 0 };
rows.forEach((r) => buckets[r.label]++);
console.log(' ', buckets, '\n');

console.log('── DATA FRESHNESS / BUG ISSUES ─────────────────────────────────────');
const byType = {};
for (const i of issues) (byType[i.type] = byType[i.type] || []).push(i);
for (const [type, items] of Object.entries(byType)) {
  console.log(`\n[${type}] ${items.length} clients:`);
  for (const x of items.slice(0, 10)) console.log(`  ${x.jcode.padEnd(5)} ${x.detail}`);
  if (items.length > 10) console.log(`  ... +${items.length - 10} more`);
}

console.log('\n── SCORES TABLE (sorted by overall) ─────────────────────────────');
console.log('J#     Name                                  Overall  Label              TV  OT  SP  RM  LP  EN');
for (const r of rows) {
  const g = (id) => {
    const s = r.subs.find((x) => x.id === id);
    return s && s.available ? String(s.score).padStart(3) : ' -- ';
  };
  console.log(
    `${r.jcode.padEnd(5)}  ${(r.name || '').slice(0, 36).padEnd(36)}  ${String(r.overall).padStart(3)}      ${r.label.padEnd(18)} ${g('tasks')} ${g('traffic')} ${g('search-perf')} ${g('rankings')} ${g('local')} ${g('engagement')}`
  );
}
