#!/usr/bin/env node
/**
 * Local sync script — fetches all client todo data from Basecamp and saves to app/data/clients/.
 * Run: node sync-local.js
 * Then: git add -A && git commit -m "Sync data" && git push
 * Vercel auto-redeploys with fresh data.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ACCOUNT_ID = "4226914";
const TOKENS_FILE = path.join(__dirname, "basecamp_tokens.json");
const PROJECTS_FILE = path.join(__dirname, "app", "data", "projects.json");
const CLIENTS_DIR = path.join(__dirname, "app", "data", "clients");
const USER_AGENT = "Client Workbook Dashboard (johan@clixsy.com)";

let accessToken = "";

function loadTokens() {
  // Try tokens file first, then env vars
  if (fs.existsSync(TOKENS_FILE)) {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
    accessToken = tokens.access_token;
    return;
  }
  accessToken = process.env.BASECAMP_ACCESS_TOKEN || "";
  if (!accessToken) {
    console.error("No access token found. Run OAuth flow first or set BASECAMP_ACCESS_TOKEN.");
    process.exit(1);
  }
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    };
    https.get(url, opts, (res) => {
      if (res.statusCode === 429) {
        const retry = parseInt(res.headers["retry-after"] || "5", 10);
        console.log(`  Rate limited, waiting ${retry}s...`);
        setTimeout(() => fetchJSON(url).then(resolve).catch(reject), retry * 1000);
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          const linkHeader = res.headers.link || "";
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          resolve({ json, next: nextMatch ? nextMatch[1] : null });
        } catch (e) {
          reject(e);
        }
      });
      res.on("error", reject);
    });
  });
}

async function fetchAllPages(url) {
  let all = [];
  let pageUrl = url;
  while (pageUrl) {
    const { json, next } = await fetchJSON(pageUrl);
    if (Array.isArray(json)) all = all.concat(json);
    pageUrl = next;
  }
  return all;
}

async function syncProject(projectId, todosetId, projectName) {
  const BASE = `https://3.basecampapi.com/${ACCOUNT_ID}/buckets/${projectId}`;

  // Get todo lists
  let todolists;
  try {
    todolists = await fetchAllPages(`${BASE}/todosets/${todosetId}/todolists.json`);
  } catch (e) {
    console.log(`  Error fetching todolists: ${e.message}`);
    return null;
  }

  let allTodos = [];
  for (const list of todolists) {
    const ratio = list.completed_ratio || "0/0";
    const [, total] = ratio.split("/").map(Number);
    if (total === 0) continue;

    // Fetch active todos
    try {
      const active = await fetchAllPages(`${BASE}/todolists/${list.id}/todos.json`);
      for (const t of active) {
        allTodos.push(formatTodo(t, list.title));
      }
    } catch (e) { /* skip */ }

    // Fetch completed todos
    try {
      const completed = await fetchAllPages(`${BASE}/todolists/${list.id}/todos.json?completed=true`);
      for (const t of completed) {
        allTodos.push(formatTodo(t, list.title));
      }
    } catch (e) { /* skip */ }
  }

  return allTodos;
}

function formatTodo(t, listTitle) {
  return {
    id: t.id,
    title: t.title || "",
    list_title: listTitle || "",
    completed: !!t.completed,
    due_on: t.due_on || null,
    created_at: t.created_at || "",
    updated_at: t.updated_at || "",
    completed_on: t.completion?.created_at || null,
    comments_count: t.comments_count || 0,
    assignees: (t.assignees || []).map((a) => a.name).join(", "),
    app_url: t.app_url || "",
    description: (t.description || "").substring(0, 500),
    visible_to_clients: !!t.visible_to_clients,
  };
}

async function main() {
  loadTokens();
  console.log("Basecamp sync starting...\n");

  // Ensure clients directory exists
  if (!fs.existsSync(CLIENTS_DIR)) {
    fs.mkdirSync(CLIENTS_DIR, { recursive: true });
  }

  // Load projects
  const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
  console.log(`Found ${projects.length} projects to sync.\n`);

  let successful = 0;
  let failed = 0;
  let totalTodos = 0;

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    process.stdout.write(`[${i + 1}/${projects.length}] ${p.name}... `);

    try {
      const todos = await syncProject(p.id, p.todoset_id, p.name);
      if (todos && todos.length > 0) {
        const outPath = path.join(CLIENTS_DIR, `${p.id}.json`);
        fs.writeFileSync(outPath, JSON.stringify(todos, null, 2));
        console.log(`${todos.length} todos`);
        totalTodos += todos.length;
        successful++;
      } else {
        console.log("0 todos (skipped)");
      }
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== Sync Complete ===`);
  console.log(`Successful: ${successful}/${projects.length}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total todos: ${totalTodos}`);
  console.log(`\nNow run: git add -A && git commit -m "Sync all client data" && git push`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
