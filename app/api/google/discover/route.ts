import { NextResponse } from "next/server";
import { listGscProperties, listGa4Properties } from "../../../lib/google";

/**
 * GET /api/google/discover
 * Lists all GSC and GA4 properties accessible to tempclixsyreports@gmail.com.
 * Used to build the client-to-property mapping.
 */
export async function GET() {
  const result: {
    gsc: { count: number; properties: unknown[]; error?: string };
    ga4: { count: number; properties: unknown[]; error?: string };
  } = {
    gsc: { count: 0, properties: [] },
    ga4: { count: 0, properties: [] },
  };

  try {
    const gscProperties = await listGscProperties();
    result.gsc = { count: gscProperties.length, properties: gscProperties };
  } catch (error) {
    result.gsc.error = error instanceof Error ? error.message : String(error);
  }

  try {
    const ga4Properties = await listGa4Properties();
    result.ga4 = { count: ga4Properties.length, properties: ga4Properties };
  } catch (error) {
    result.ga4.error = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json(result);
}
