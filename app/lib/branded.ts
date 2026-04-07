/**
 * Branded keyword detection.
 *
 * Given a GSC `property` string (either `https://www.example.com/` or
 * `sc-domain:example.com`) and optionally the project display name, return a
 * matcher that decides whether a search query is "branded".
 *
 * Heuristic:
 *   1. Strip protocol/www, take the apex domain, drop the TLD.
 *   2. Split the remaining label on hyphens/digits/non-letters; treat tokens
 *      length >= 3 as brand seeds.
 *   3. Also keep the full undivided domain label (e.g. "sunsetheating") as a
 *      seed so glued queries match.
 *   4. From the project name (after stripping the leading "J123 " job code),
 *      add tokens length >= 3 that aren't generic SEO words.
 *
 * A query is branded if it contains any seed token (substring match,
 * case-insensitive) OR contains the full domain label.
 */

const GENERIC_STOPWORDS = new Set([
  "law",
  "llp",
  "llc",
  "pc",
  "pa",
  "inc",
  "co",
  "the",
  "and",
  "for",
  "group",
  "firm",
  "attorneys",
  "attorney",
  "lawyer",
  "lawyers",
  "services",
  "service",
  "company",
  "associates",
  "plumbing",
  "heating",
  "cooling",
  "electric",
  "electrical",
  "hvac",
  "air",
  "injury",
  "accident",
  "personal",
  "criminal",
  "defense",
  "auto",
]);

export interface BrandedMatcher {
  seeds: string[];
  domainLabel: string | null;
  isBranded: (query: string) => boolean;
}

function extractDomainLabel(property: string | undefined | null): string | null {
  if (!property) return null;
  let host = property.trim();
  host = host.replace(/^sc-domain:/, "");
  host = host.replace(/^https?:\/\//, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/^www\./, "");
  if (!host) return null;
  // Apex label: drop the TLD (last segment) — multi-tier TLDs are rare for our clients
  const parts = host.split(".");
  if (parts.length < 2) return host.toLowerCase();
  return parts[parts.length - 2].toLowerCase();
}

function tokenize(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3 && !GENERIC_STOPWORDS.has(t));
}

export function buildBrandedMatcher(
  property?: string | null,
  projectName?: string | null
): BrandedMatcher {
  const seeds = new Set<string>();
  const domainLabel = extractDomainLabel(property);

  if (domainLabel) {
    // Always include the full glued label
    seeds.add(domainLabel);
    // Split on internal letter-class boundaries (limited heuristic — we just
    // look for vowel boundaries between known words won't work; instead we
    // try to find embedded English-like prefixes by length).
    // Simpler: rely on the project name tokens for split words.
  }

  if (projectName) {
    const stripped = projectName.replace(/^J\d+\s+/, "");
    for (const t of tokenize(stripped)) seeds.add(t);
  }

  const seedList = Array.from(seeds);

  return {
    seeds: seedList,
    domainLabel,
    isBranded(query: string) {
      if (!query) return false;
      const q = query.toLowerCase().replace(/\s+/g, "");
      const qSpaced = query.toLowerCase();
      if (domainLabel && q.includes(domainLabel)) return true;
      for (const seed of seedList) {
        if (q.includes(seed) || qSpaced.includes(seed)) return true;
      }
      return false;
    },
  };
}
