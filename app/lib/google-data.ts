import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { GscSearchData, Ga4ReportData } from "./google";

export function loadGscData(projectId: string): GscSearchData | null {
  const filePath = join(process.cwd(), "app", "data", "clients", `${projectId}-gsc.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

export function loadGa4Data(projectId: string): Ga4ReportData | null {
  const filePath = join(process.cwd(), "app", "data", "clients", `${projectId}-ga4.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}
