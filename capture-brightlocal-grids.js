#!/usr/bin/env node
/**
 * BrightLocal grid screenshot capture.
 *
 * Logs into BrightLocal once with credentials from env vars
 * (BRIGHTLOCAL_EMAIL / BRIGHTLOCAL_PASSWORD), iterates the locations listed
 * in app/data/brightlocal-locations.json, navigates to each location's Local
 * Search Grid view, and screenshots the grid map area to
 * public/grids/<locationId>.png.
 *
 * It then writes app/data/brightlocal-grid-index.json mapping locationId →
 * { capturedAt, file } so the dashboard knows which grids exist.
 *
 * Run with:
 *   BRIGHTLOCAL_EMAIL=... BRIGHTLOCAL_PASSWORD=... node capture-brightlocal-grids.js
 *
 * Optional flags:
 *   --only=<locationId>      capture only one location
 *   --client="<substring>"   only locations whose clientName contains this
 *   --limit=N                stop after N captures
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = __dirname;
const LOCATIONS_FILE = path.join(ROOT, "app", "data", "brightlocal-locations.json");
const GRIDS_DIR = path.join(ROOT, "public", "grids");
const INDEX_FILE = path.join(ROOT, "app", "data", "brightlocal-grid-index.json");

const LOGIN_URL = "https://tools.brightlocal.com/seo-tools/admin/login";
const LSG_URL = (id) =>
  `https://tools.brightlocal.com/seo-tools/admin/location-dashboard/location/${id}/lsg`;

function parseArgs() {
  const args = { only: null, client: null, limit: null };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--only=")) args.only = parseInt(a.slice(7), 10);
    else if (a.startsWith("--client=")) args.client = a.slice(9).toLowerCase();
    else if (a.startsWith("--limit=")) args.limit = parseInt(a.slice(8), 10);
  }
  return args;
}

function loadLocations() {
  return JSON.parse(fs.readFileSync(LOCATIONS_FILE, "utf-8"));
}

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function login(page) {
  const email = process.env.BRIGHTLOCAL_EMAIL;
  const password = process.env.BRIGHTLOCAL_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set BRIGHTLOCAL_EMAIL and BRIGHTLOCAL_PASSWORD env vars before running."
    );
  }
  console.log("Logging in to BrightLocal...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  // The login form is a React app — wait until the email input is mounted.
  // It's labelled "Email Address" but doesn't necessarily use type="email".
  await page.waitForFunction(
    () => !!document.querySelector('input[placeholder*="Email" i], input[name*="email" i], input[type="email"]'),
    { timeout: 20000 }
  );

  // Use evaluate to set values on the React-controlled inputs and dispatch
  // change/input events so React picks them up.
  await page.evaluate(
    ({ email, password }) => {
      const setReactValue = (el, value) => {
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const emailEl =
        document.querySelector('input[type="email"]') ||
        document.querySelector('input[placeholder*="Email" i]') ||
        document.querySelector('input[name*="email" i]');
      const pwEl =
        document.querySelector('input[type="password"]') ||
        document.querySelector('input[placeholder*="Password" i]') ||
        document.querySelector('input[name*="password" i]');
      if (emailEl) setReactValue(emailEl, email);
      if (pwEl) setReactValue(pwEl, password);
    },
    { email, password }
  );

  // Click the login button
  await page.click('button:has-text("Login")');

  // Wait for the URL to leave the login page
  await page.waitForFunction(
    () => !location.pathname.includes("/login"),
    { timeout: 30000 }
  );
  console.log("  → logged in:", page.url());
}

async function captureLocation(page, location) {
  const id = location.locationId;
  const url = LSG_URL(id);
  console.log(`[${id}] ${location.clientName} — ${location.locationName}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // The LSG dashboard auto-redirects to /lsg/view?keyword=...&runId=... when a
  // report exists. Give the SPA up to 25s to settle on the view URL.
  try {
    await page.waitForFunction(
      () => location.pathname.includes("/lsg/view") || !!document.querySelector(".gm-style"),
      { timeout: 25000 }
    );
  } catch {
    console.log(`  ! no grid view loaded for ${id}, skipping`);
    return null;
  }

  // Now wait for Google Maps to finish rendering
  try {
    await page.waitForSelector(".gm-style", { timeout: 15000 });
  } catch {
    console.log(`  ! map element didn't render for ${id}, skipping`);
    return null;
  }

  // Scroll the map into view so Google Maps actually loads its tiles
  // (headless Chrome lazy-loads tiles based on visibility).
  await page.evaluate(() => {
    const map = document.querySelector(".gm-style");
    if (map) map.scrollIntoView({ block: "center", behavior: "instant" });
  });

  // Wait for map tiles to settle
  await page.waitForTimeout(7000);

  // Screenshot the map element directly (not its parents) so we don't pick
  // up the surrounding header / competitor table.
  const target = await page.$(".gm-style");
  if (!target) {
    console.log(`  ! grid container not found for ${id}`);
    return null;
  }

  ensureDir(GRIDS_DIR);
  const outFile = path.join(GRIDS_DIR, `${id}.png`);
  try {
    await target.screenshot({ path: outFile });
    console.log(`  ✓ saved ${outFile}`);
    return { file: `/grids/${id}.png`, capturedAt: new Date().toISOString() };
  } catch (e) {
    console.log(`  ! screenshot failed: ${e.message}`);
    return null;
  }
}

(async () => {
  const args = parseArgs();
  const allLocations = loadLocations();

  // Pick one "main" location per client (first one in the file is the main)
  const seenClients = new Set();
  let targets = [];
  for (const loc of allLocations) {
    if (seenClients.has(loc.clientName)) continue;
    seenClients.add(loc.clientName);
    targets.push(loc);
  }
  if (args.only) targets = targets.filter((l) => l.locationId === args.only);
  if (args.client)
    targets = targets.filter((l) => l.clientName.toLowerCase().includes(args.client));
  if (args.limit) targets = targets.slice(0, args.limit);

  console.log(`Will capture ${targets.length} locations.`);

  const index = loadIndex();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();

  try {
    await login(page);
    for (const loc of targets) {
      const result = await captureLocation(page, loc);
      if (result) {
        index[String(loc.locationId)] = result;
        // Persist after each successful capture so a crash doesn't lose work
        fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
      }
    }
  } finally {
    await browser.close();
  }

  console.log("Done.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
