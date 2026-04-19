"use client";

import { getEmployeeColor } from "../lib/team-assignments";

interface TeamBadgesProps {
  members: string[];
  /** "compact" = tiny pills for grid cards; "full" = larger for detail pages */
  variant?: "compact" | "full";
}

export default function TeamBadges({
  members,
  variant = "compact",
}: TeamBadgesProps) {
  if (members.length === 0) return null;

  const isCompact = variant === "compact";

  return (
    <div
      className="flex flex-wrap items-center"
      style={{ gap: isCompact ? "3px" : "6px" }}
    >
      {members.map((name) => {
        const color = getEmployeeColor(name);
        return (
          <span
            key={name}
            title={name}
            className="inline-flex items-center font-medium leading-none"
            style={{
              fontSize: isCompact ? "9px" : "11px",
              padding: isCompact ? "2px 5px" : "3px 8px",
              borderRadius: "3px",
              backgroundColor: `${color}22`,
              color: color,
              border: `1px solid ${color}44`,
              letterSpacing: "0.02em",
            }}
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}
