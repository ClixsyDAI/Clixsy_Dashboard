import data from "../data/team-assignments.json";

export interface TeamAssignmentData {
  employees: string[];
  assignments: Record<string, string[]>;
}

/** Return the full assignments dataset (employees list + all mappings). */
export function getTeamAssignments(): TeamAssignmentData {
  return data as TeamAssignmentData;
}

/** Return the array of employee names assigned to a given project. */
export function getClientTeam(projectId: string | number): string[] {
  return (data.assignments as Record<string, string[]>)[String(projectId)] || [];
}

/** Deterministic color for each employee, tuned for the dark CLIXSY theme. */
const EMPLOYEE_COLORS: Record<string, string> = {
  Dorin:  "#5b9bd5",
  Ovidiu: "#e06666",
  Andrei: "#6aa84f",
  Alina:  "#d5a53b",
  Mubeen: "#9673d9",
  Naas:   "#45b5b5",
  Johan:  "#d96ba5",
  Mvelo:  "#8cc152",
  Joel:   "#e08c4a",
  Sadie:  "#6b7fd9",
  Thys:   "#c4c44a",
};

export function getEmployeeColor(name: string): string {
  return EMPLOYEE_COLORS[name] || "#888888";
}

export function getEmployeeInitials(name: string): string {
  return name.charAt(0).toUpperCase();
}
