"use client";

import { useState } from "react";
import Link from "next/link";

interface ProjectMeta {
  id: number;
  name: string;
  description: string;
  todoset_id: number;
  hasData: boolean;
}

export default function ClientGrid({
  projects,
}: {
  projects: ProjectMeta[];
}) {
  const [search, setSearch] = useState("");

  const filtered = projects.filter((p) => {
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  });

  return (
    <>
      {/* Search bar */}
      <div className="mt-8 mb-6">
        <input
          type="text"
          placeholder="Search clients by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-sm border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[#C8A882]"
          style={{
            backgroundColor: "#111111",
            borderColor: "#333333",
            color: "#f0ede8",
          }}
        />
        {search && (
          <p className="mt-2 text-xs" style={{ color: "#888888" }}>
            Showing {filtered.length} of {projects.length} clients
          </p>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((project) => (
          <Link
            key={project.id}
            href={`/client/${project.id}`}
            className="group block rounded-sm border transition-all hover:border-[#C8A882]"
            style={{
              backgroundColor: "#111111",
              borderColor: "#1a1a1a",
            }}
          >
            <div className="p-5">
              {/* Job number badge */}
              <div className="mb-3 flex items-center justify-between">
                <span
                  className="rounded-sm px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
                  style={{
                    backgroundColor: project.hasData
                      ? "rgba(45, 106, 79, 0.15)"
                      : "rgba(136, 136, 136, 0.1)",
                    color: project.hasData ? "#2d6a4f" : "#555555",
                  }}
                >
                  {project.name.split(" ")[0]}
                </span>
                {project.hasData && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "#2d6a4f" }}
                    title="Data loaded"
                  />
                )}
              </div>

              {/* Client name */}
              <h3
                className="text-sm font-semibold leading-tight transition-colors group-hover:text-[#C8A882]"
                style={{ color: "#f0ede8" }}
              >
                {project.name.replace(/^J\d+\s*/, "")}
              </h3>

              {/* Description */}
              <p
                className="mt-1.5 text-xs leading-relaxed"
                style={{ color: "#888888" }}
              >
                {project.description}
              </p>

              {/* Status indicator */}
              <div className="mt-4">
                {project.hasData ? (
                  <span
                    className="text-[10px] font-medium tracking-wide uppercase"
                    style={{ color: "#C8A882" }}
                  >
                    View Dashboard &rarr;
                  </span>
                ) : (
                  <span
                    className="text-[10px] tracking-wide uppercase"
                    style={{ color: "#555555" }}
                  >
                    No data yet
                  </span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-sm" style={{ color: "#888888" }}>
            No clients match your search.
          </p>
        </div>
      )}
    </>
  );
}
