import { NextRequest, NextResponse } from "next/server";
import { writeFileSync } from "fs";
import { join } from "path";
import { listGscProperties, listGa4Properties } from "../../../lib/google";
import projects from "../../../data/projects.json";
import { requireRole } from "../../../lib/require-role";
import { logAuthAudit } from "../../../lib/auth-audit";

interface ClientMapping {
  // Post-GHL-pivot: projectId is the (string) Project.id from app/data/projects.json.
  // The existing google-properties.json file on disk still holds numeric ids
  // from before the migration; this route overwrites that file on next run.
  projectId: string;
  clientName: string;
  gscProperty?: string;
  ga4PropertyId?: string;
  ga4DisplayName?: string;
}

/**
 * POST /api/google/auto-map
 * Auto-discovers GSC and GA4 properties, then fuzzy-matches them to Basecamp clients.
 * Writes the mapping to app/data/google-properties.json.
 *
 * Auth: requireRole('admin') added in PR C as defence-in-depth.
 */
export async function POST(req: NextRequest) {
  const auth = requireRole(req, "admin", "/api/google/auto-map");
  if (!auth.ok) {
    logAuthAudit(auth.audit);
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.status },
    );
  }

  try {
    const [gscProperties, ga4Properties] = await Promise.all([
      listGscProperties(),
      listGa4Properties(),
    ]);

    const mappings: ClientMapping[] = [];

    for (const project of projects) {
      // Extract client name parts for matching
      // Project names like "J153 Sunset Heating" -> extract "Sunset Heating"
      const clientLabel = project.name.replace(/^J\d+\s+/, "").toLowerCase();
      const words = clientLabel.split(/\s+/).filter((w) => w.length > 2);

      const mapping: ClientMapping = {
        projectId: project.id,
        clientName: project.name,
      };

      // Try to match GSC property
      // GSC URLs look like "sc-domain:sunsethc.com" or "https://www.sunsetheating.com/"
      const gscMatch = findBestGscMatch(words, clientLabel, gscProperties);
      if (gscMatch) {
        mapping.gscProperty = gscMatch.siteUrl;
      }

      // Try to match GA4 property
      const ga4Match = findBestGa4Match(words, clientLabel, ga4Properties);
      if (ga4Match) {
        mapping.ga4PropertyId = ga4Match.name;
        mapping.ga4DisplayName = ga4Match.displayName;
      }

      mappings.push(mapping);
    }

    const filePath = join(process.cwd(), "app", "data", "google-properties.json");
    writeFileSync(filePath, JSON.stringify(mappings, null, 2));

    const matched = mappings.filter((m) => m.gscProperty || m.ga4PropertyId);
    const gscMatched = mappings.filter((m) => m.gscProperty).length;
    const ga4Matched = mappings.filter((m) => m.ga4PropertyId).length;

    return NextResponse.json({
      totalClients: projects.length,
      matched: matched.length,
      gscMatched,
      ga4Matched,
      unmatched: mappings
        .filter((m) => !m.gscProperty && !m.ga4PropertyId)
        .map((m) => m.clientName),
      mappings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function extractDomain(url: string): string {
  return url
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function findBestGscMatch(
  words: string[],
  clientLabel: string,
  properties: Array<{ siteUrl: string; permissionLevel: string }>
): { siteUrl: string } | null {
  let bestMatch: { siteUrl: string } | null = null;
  let bestScore = 0;

  for (const prop of properties) {
    const domain = extractDomain(prop.siteUrl);
    const score = computeMatchScore(words, clientLabel, domain);
    if (score > bestScore && score >= 2) {
      bestScore = score;
      bestMatch = prop;
    }
  }

  return bestMatch;
}

function findBestGa4Match(
  words: string[],
  clientLabel: string,
  properties: Array<{ name: string; displayName: string; propertyType: string }>
): { name: string; displayName: string } | null {
  let bestMatch: { name: string; displayName: string } | null = null;
  let bestScore = 0;

  for (const prop of properties) {
    const target = prop.displayName.toLowerCase();
    const score = computeMatchScore(words, clientLabel, target);
    if (score > bestScore && score >= 2) {
      bestScore = score;
      bestMatch = prop;
    }
  }

  return bestMatch;
}

function computeMatchScore(
  words: string[],
  clientLabel: string,
  target: string
): number {
  let score = 0;

  // Exact substring match of full client label
  if (target.includes(clientLabel.replace(/\s+/g, ""))) {
    score += 10;
  }

  // Word matches
  for (const word of words) {
    if (target.includes(word)) {
      score += word.length >= 5 ? 3 : 2;
    }
  }

  // Known abbreviation patterns
  const abbreviations: Record<string, string[]> = {
    "sunset heating": ["sunsethc", "sunset"],
    "fielding law": ["fieldinglaw", "fielding"],
    "mike morse": ["mikemorselaw", "mikemorse"],
    "robert gould": ["autoaccident"],
    "hill & moin": ["hillmoin"],
    "cellino law": ["cellino"],
    "johnson attorneys": ["jag-law", "johnsonattorneys"],
    "minton law": ["justinmintonlaw", "minton"],
    "harker injury": ["harkerinjury"],
    "wolf law": ["wolflaw", "wolf-law"],
    "reimer home": ["reimerhvac", "reimer"],
    "bassett services": ["bassettservices", "bassett"],
    "christian hvac": ["christianhvac"],
    "gene johnson": ["genejohnson", "belred"],
    "grover law": ["groverlawfirm", "grover"],
    "hauptman": ["hauptman-obrien", "hauptman"],
    "johnston law": ["johnstonlaw"],
    "snyder": ["snyderac", "snyder"],
    "edward a smith": ["autoaccident", "edwardasmith"],
    "precision today": ["precisiontoday"],
    "collins law": ["thecollinslaw", "collinslawfirm"],
    "kogan & disalvo": ["kogandisalvo"],
    "crash team": ["crashteam", "galvanlaw"],
    "henco plumbing": ["hencoplumbing", "henco"],
    "holt plumbing": ["holtplumbing", "holt"],
    "heritage home": ["heritagehome"],
    "amg law": ["amglaw"],
    "andrew pickett": ["andrewpickett", "pickettlaw"],
    "superior comfort": ["superiorcomfort"],
    "steele adams": ["steeleadams"],
    "fhv legal": ["fhvlegal"],
    "bruni & campisi": ["brunicampisi", "bruni"],
    "elevated comfort": ["goelevatedcomfort", "elevated"],
    "otter guys": ["otterguys", "calltheotterguys"],
    "one stop heating": ["onestop"],
    "garage door medics": ["gdmedics"],
    "champion plumbing": ["championplumbing", "callthechamps"],
    "cregger plumbing": ["creggerplumbing", "cregger"],
    "maverick electric": ["maverickelec", "gomaverick"],
    "ac plus": ["acplusheating"],
    "go arco": ["goarco"],
    "allen law": ["allenlaw"],
    "wilshire law": ["wilshirelawfirm", "wilshire"],
    "george sink": ["sinklaw", "georgesink"],
    "action garage": ["actiongaragedoor"],
    "integrity roofing": ["integrityroofing"],
    "asap commercial": ["asapdoors"],
    "exterior company": ["theexteriorcompany"],
    "ar roofing": ["arroofing"],
    "lifetime roofing": ["lifetimeroofing"],
    "gator garage": ["gatorgaragedoor"],
    "goody garage": ["goodygaragedoors", "goody"],
    "gaithersburg garage": ["gaithersburggaragedoor"],
  };

  for (const [key, aliases] of Object.entries(abbreviations)) {
    if (clientLabel.includes(key)) {
      for (const alias of aliases) {
        if (target.includes(alias)) {
          score += 10;
          break;
        }
      }
    }
  }

  return score;
}
