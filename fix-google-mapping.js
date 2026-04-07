#!/usr/bin/env node
/**
 * Auto-match GA4 properties to projects by domain/name similarity, then
 * rewrite app/data/google-properties.json with corrections.
 *
 * Strategy:
 *  1. For each project, derive a set of candidate tokens from:
 *      - the GSC property URL (apex domain words)
 *      - the project name (after stripping the J### prefix)
 *  2. For each available GA4 property, derive tokens from its displayName.
 *  3. Score every (project, ga4) pair by token overlap. Best score wins
 *     unless the score is too low, in which case the project's GA4 mapping
 *     is set to null (so the dashboard shows no GA4 data, which is more
 *     honest than wrong data).
 *  4. Hand-coded overrides cover known edge cases the heuristic can't catch.
 *  5. Print a diff and write the new file.
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PROJECTS = path.join(ROOT, "app", "data", "projects.json");
const MAPPINGS = path.join(ROOT, "app", "data", "google-properties.json");
const DISCOVER = path.join(ROOT, "discover.json");

const STOPWORDS = new Set([
  "ga4", "the", "and", "for",
  "https", "http", "www", "com", "net", "org",
  "site", "mini",
  "remove", "deleted", "delete", "old", "removed", "ok",
]);

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/^j\d+\s+/, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function domainOf(url) {
  if (!url) return "";
  const h = url.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return h;
}

/**
 * Extract the "apex label" tokens from a domain.
 * sunsethc.com → ["sunsethc"]
 * billallenlaw.com → ["billallenlaw"]
 * justinmintonlaw.com → ["justinmintonlaw"]
 * (We rely on the full glued label as a fingerprint — substring matching
 * later catches "sinklaw" inside "Keyword Hero - SinkLaw.com - GA4".)
 */
function apexLabel(url) {
  const dom = domainOf(url);
  if (!dom) return null;
  const parts = dom.split(".");
  if (parts.length < 2) return parts[0] || null;
  return parts[parts.length - 2];
}

function score(projectApex, projectTokens, gaTokens, gaDisplayLower) {
  let s = 0;
  // Strongest signal: the project's full apex label appears verbatim
  // anywhere in the GA4 displayName (handles "sinklaw" → "SinkLaw.com").
  if (projectApex && projectApex.length >= 5 && gaDisplayLower.includes(projectApex)) s += 10;

  // Reverse check: any GA4 token of length ≥4 appears inside the project
  // apex (handles "holt" → "holtplumbingandheating", "fhv" → "fhvlegal").
  // We require at least 2 character overlap between the GA4 token and the
  // apex for short tokens to avoid false positives.
  if (projectApex) {
    for (const gt of gaTokens) {
      if (gt.length >= 4 && projectApex.includes(gt)) s += 8;
    }
  }

  const set = new Set(gaTokens);
  for (const t of projectTokens) {
    if (set.has(t)) s += 2;
    else if ([...set].some((g) => g.length >= 4 && (g.includes(t) || t.includes(g)))) s += 1;
  }
  return s;
}

// Hand-coded overrides where heuristics fail or where the right GA4 property
// genuinely doesn't exist in the discoverable list. `null` = unset (no GA4
// data shown — better than wrong data).
const OVERRIDES = {
  // Allen Law has its own GA4 — heuristic finds it but make explicit
  44235798: "properties/330084523", // J394 Allen Law → "Allen Law Firm, P.A."
  // J302 + J113 both legitimately track autoaccident.com (same site)
  35722805: "properties/392600107", // Edward A Smith → autoaccident
  16128131: "properties/392600107", // Robert Gould → autoaccident
  // Clients whose GA4 was never set up correctly — clear them rather than
  // showing another client's data. They'll show no GA4 in the dashboard.
  12208911: null, // Fielding Law (no fielding GA4 exists)
  22090947: null, // Cellino Law
  37472277: null, // Kogan & DiSalvo
  39903740: null, // AMG Law
  25949341: null, // Sunset Heating
  32178056: null, // Reimer Home Services
  32207577: null, // Bassett Services
  39614475: null, // Henco Plumbing
  35591831: null, // Gene Johnson SEO
  35427597: null, // Grover Law Firm
  37240467: null, // The Collins Law Firm
  39213770: null, // The Crash Team / Galvan
  39614458: null, // Heritage Home Service
  42624450: null, // The Otter Guys
  42475931: null, // One Stop Heating & Air
  43226719: null, // Garage Door Medics
  43486963: null, // Maverick Electric
  // 43710022 AC Plus → "AC Plus Heating & Air - GA4" — let the matcher pick this
  45555854: null, // Action Garage Door
  45615372: null, // Integrity Roofing
  46229887: null, // AR Roofing
  46229984: null, // Lifetime Roofing
  46282828: null, // Gator Garage Doors
  46272335: null, // Gaithersburg Garage Door
  46000874: null, // ASAP Commercial Doors
};

// GSC overrides for wrong GSC mappings I found during the audit
const GSC_OVERRIDES = {
  // Gaithersburg Garage Door's GSC was pointing at gator's domain
  46272335: null, // unset until correct GSC property is identified
};

function main() {
  const projects = JSON.parse(fs.readFileSync(PROJECTS, "utf-8"));
  const mappings = JSON.parse(fs.readFileSync(MAPPINGS, "utf-8"));
  const discover = JSON.parse(fs.readFileSync(DISCOVER, "utf-8"));
  const ga4Props = discover.ga4.properties; // {name, displayName, propertyType}

  // Pre-tokenize GA4
  const ga4WithTokens = ga4Props.map((p) => ({
    name: p.name,
    displayName: p.displayName,
    displayLower: (p.displayName || "").toLowerCase(),
    tokens: tokenize(p.displayName),
  }));

  const newMappings = [];
  const changes = [];

  for (const m of mappings) {
    const project = projects.find((p) => p.id === m.projectId);
    const projectName = project?.name || m.clientName || "";
    const gscDomain = domainOf(m.gscProperty);
    const projectApex = apexLabel(m.gscProperty);
    const projectTokens = [
      ...tokenize(projectName),
      ...tokenize(gscDomain.replace(/\./g, " ")),
    ];

    let bestGa4 = null;
    let bestScore = 0;
    for (const g of ga4WithTokens) {
      const sc = score(projectApex, projectTokens, g.tokens, g.displayLower);
      if (sc > bestScore) {
        bestScore = sc;
        bestGa4 = g;
      }
    }

    // Apply overrides
    let chosenGa4 = null;
    let chosenName = "";
    if (Object.prototype.hasOwnProperty.call(OVERRIDES, m.projectId)) {
      chosenGa4 = OVERRIDES[m.projectId];
      const o = chosenGa4 ? ga4WithTokens.find((g) => g.name === chosenGa4) : null;
      chosenName = o?.displayName || "";
    } else if (bestScore >= 10 && bestGa4) {
      // Strong match: apex label appears in GA4 displayName
      chosenGa4 = bestGa4.name;
      chosenName = bestGa4.displayName;
    } else if (bestScore >= 4 && bestGa4) {
      chosenGa4 = bestGa4.name;
      chosenName = bestGa4.displayName;
    } else {
      chosenGa4 = null;
      chosenName = "";
    }

    let chosenGsc = m.gscProperty || null;
    if (Object.prototype.hasOwnProperty.call(GSC_OVERRIDES, m.projectId)) {
      chosenGsc = GSC_OVERRIDES[m.projectId];
    }

    const newRow = {
      projectId: m.projectId,
      clientName: m.clientName,
    };
    if (chosenGsc) newRow.gscProperty = chosenGsc;
    if (chosenGa4) {
      newRow.ga4PropertyId = chosenGa4;
      newRow.ga4DisplayName = chosenName;
    }

    if (m.ga4PropertyId !== chosenGa4 || (m.gscProperty || null) !== chosenGsc) {
      changes.push({
        id: m.projectId,
        name: projectName,
        oldGa4: m.ga4PropertyId || "(none)",
        oldGa4Name: m.ga4DisplayName || "",
        newGa4: chosenGa4 || "(unset)",
        newGa4Name: chosenName,
        oldGsc: m.gscProperty || "(none)",
        newGsc: chosenGsc || "(unset)",
      });
    }

    newMappings.push(newRow);
  }

  // Print diff
  console.log(`\n${changes.length} mappings changed:\n`);
  for (const c of changes) {
    console.log(`${c.id} | ${c.name}`);
    if (c.oldGa4 !== c.newGa4) {
      console.log(`  GA4: ${c.oldGa4} (${c.oldGa4Name})`);
      console.log(`    →  ${c.newGa4} (${c.newGa4Name})`);
    }
    if (c.oldGsc !== c.newGsc) {
      console.log(`  GSC: ${c.oldGsc}`);
      console.log(`    →  ${c.newGsc}`);
    }
  }

  // Write
  fs.writeFileSync(MAPPINGS, JSON.stringify(newMappings, null, 2));
  console.log(`\nWrote ${MAPPINGS}`);
}

main();
