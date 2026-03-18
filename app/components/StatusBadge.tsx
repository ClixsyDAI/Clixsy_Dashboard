"use client";

export default function StatusBadge({ completed }: { completed: boolean }) {
  return (
    <span
      className="inline-block rounded-sm px-2 py-0.5 text-xs font-medium"
      style={{
        color: completed ? "#2d6a4f" : "#b08d57",
        backgroundColor: completed
          ? "rgba(45, 106, 79, 0.15)"
          : "rgba(176, 141, 87, 0.15)",
      }}
    >
      {completed ? "Done" : "Open"}
    </span>
  );
}
