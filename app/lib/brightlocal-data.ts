import { readFileSync, existsSync } from "fs";
import { join } from "path";
import projects from "../data/projects.json";

export interface CitationReport {
  reportId: number;
  reportName: string;
  locationId: number;
  city: string;
  address: string;
  postcode: string;
  liveCitations: number;
  citationsChange: number;
  totalSources: number;
  lastRun: string;
  schedule: string;
}

export interface BrightLocalLocation {
  locationId: number;
  locationName: string;
  ref: string;
  clientName: string;
  city: string;
  postcode: string;
  country: string;
  lsrcUp: number;
  lsrcDown: number;
  lsrcNew: number;
  lsrcAvgGoogleRank: number;
  lsrcAvgGoogleRankChange: number;
  lsgAllKeywordAvg: number;
  lsgAllKeywordAvgChange: number;
  ctScore: number;
  ctLive: number;
  ctLiveChange: number;
  rmRating: number;
  rmTotal: number;
  gmbCalls: number;
  gmbTotal: number;
}

let cachedLocations: BrightLocalLocation[] | null = null;

function loadAllLocations(): BrightLocalLocation[] {
  if (cachedLocations) return cachedLocations;
  const filePath = join(process.cwd(), "app", "data", "brightlocal-locations.json");
  if (!existsSync(filePath)) return [];
  cachedLocations = JSON.parse(readFileSync(filePath, "utf-8"));
  return cachedLocations!;
}

// Map BrightLocal client names to Basecamp project IDs
// This uses fuzzy matching on client names from BrightLocal and project names from Basecamp
const CLIENT_NAME_MAP: Record<string, number[]> = {
  "Fielding Law Auto Accident Attorneys": [12208911],
  "Mike Morse Law Firm": [14164366],
  "Gould Injury Law": [16128131],
  "Edward A Smith Law Offices": [35722805],
  "Hill & Moin LLP": [17684836],
  "Cellino Law Injury Attorneys": [22090947],
  "Johnson Attorneys Group": [30012391],
  "Justin Minton Law": [29764885],
  "Harker Injury Law": [31539020],
  "Wolf Law Criminal Defense Attorney": [31394147],
  "Reimer Heating, Cooling & Plumbing, LLC": [32178056],
  "Clixsy": [31418251],
  "Christian Heating, Cooling, Plumbing, & Electrical": [35591615],
  "Grover Law Firm": [35427597],
  "Hauptman, O'Brien, Wolf & Lathrop, P.C": [35733982],
  "Johnston Law Firm, P.C.": [35569716],
  "Snyder Air Conditioning, Plumbing & Electric": [35591915],
  "The Collins Law Firm, P.C.": [37240467],
  "Kogan & DiSalvo Personal Injury Lawyers": [37472277],
  "Henco Plumbing Services": [39614475],
  "Allred, Maroko & Goldberg": [39903740],
  "Andrew Pickett Law": [40435636],
  "Steele Adams Hosman": [41270029],
  "Freedland Harwin Valori Gander": [41270237],
  "Elevated Comfort": [41648751],
  "Champion Plumbing": [43339319],
  "Cregger Plumbing, Heating & Cooling": [43488438],
  "Maverick Electric, Heating, & Air": [43486963],
  "George Sink, P.A. Injury Lawyers": [45231944],
  "McWhirter, Bellinger & Associates, P.A. Attorneys at Law": [45231944], // shares with Sink
  "Overson Roofing": [46229887],
};

/** Get BrightLocal locations for a specific Basecamp project ID */
export function getLocationsForProject(projectId: string): BrightLocalLocation[] {
  const allLocations = loadAllLocations();
  const numId = parseInt(projectId);

  // First try direct mapping
  for (const [clientName, projectIds] of Object.entries(CLIENT_NAME_MAP)) {
    if (projectIds.includes(numId)) {
      return allLocations.filter((loc) => loc.clientName === clientName);
    }
  }

  // Fallback: fuzzy match project name to BrightLocal client name
  const project = projects.find((p) => p.id === numId);
  if (!project) return [];

  const projectLabel = project.name.replace(/^J\d+\s+/, "").toLowerCase();
  const words = projectLabel.split(/\s+/).filter((w) => w.length > 3);

  const matches = allLocations.filter((loc) => {
    const blName = loc.clientName.toLowerCase();
    const matchCount = words.filter((w) => blName.includes(w)).length;
    return matchCount >= 2 || (words.length === 1 && blName.includes(words[0]));
  });

  return matches;
}

/** Get a summary of BrightLocal data for a project */
export function getBrightLocalSummary(projectId: string) {
  const locations = getLocationsForProject(projectId);
  if (locations.length === 0) return null;

  const totalRankingsUp = locations.reduce((s, l) => s + (l.lsrcUp || 0), 0);
  const totalRankingsDown = locations.reduce((s, l) => s + (l.lsrcDown || 0), 0);
  const totalCitations = locations.reduce((s, l) => s + (l.ctLive || 0), 0);
  const totalGmbCalls = locations.reduce((s, l) => s + (l.gmbCalls || 0), 0);
  const totalGmbInteractions = locations.reduce((s, l) => s + (l.gmbTotal || 0), 0);

  const avgGoogleRanks = locations.filter((l) => l.lsrcAvgGoogleRank > 0);
  const avgGoogleRank = avgGoogleRanks.length > 0
    ? avgGoogleRanks.reduce((s, l) => s + l.lsrcAvgGoogleRank, 0) / avgGoogleRanks.length
    : 0;

  const lsgAvgs = locations.filter((l) => l.lsgAllKeywordAvg > 0);
  const avgLsgRank = lsgAvgs.length > 0
    ? lsgAvgs.reduce((s, l) => s + l.lsgAllKeywordAvg, 0) / lsgAvgs.length
    : 0;

  const avgRating = locations.filter((l) => l.rmRating > 0);
  const reviewRating = avgRating.length > 0
    ? avgRating.reduce((s, l) => s + l.rmRating, 0) / avgRating.length
    : 0;

  const totalReviews = locations.reduce((s, l) => s + (l.rmTotal || 0), 0);

  // Load citation reports matched by locationId
  const citations = getCitationsForLocations(locations.map((l) => l.locationId));

  return {
    locationCount: locations.length,
    locations,
    totalRankingsUp,
    totalRankingsDown,
    totalCitations,
    totalGmbCalls,
    totalGmbInteractions,
    avgGoogleRank: Math.round(avgGoogleRank * 10) / 10,
    avgLsgRank: Math.round(avgLsgRank * 10) / 10,
    reviewRating: Math.round(reviewRating * 10) / 10,
    totalReviews,
    citations,
  };
}

let cachedCitations: CitationReport[] | null = null;

function loadAllCitations(): CitationReport[] {
  if (cachedCitations) return cachedCitations;
  const filePath = join(process.cwd(), "app", "data", "brightlocal-citations.json");
  if (!existsSync(filePath)) return [];
  cachedCitations = JSON.parse(readFileSync(filePath, "utf-8"));
  return cachedCitations!;
}

function getCitationsForLocations(locationIds: number[]): CitationReport[] {
  const allCitations = loadAllCitations();
  const idSet = new Set(locationIds);
  return allCitations.filter((c) => idSet.has(c.locationId));
}
