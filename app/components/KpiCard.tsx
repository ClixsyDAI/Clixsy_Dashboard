"use client";

export default function KpiCard({
  value,
  label,
  accent = false,
}: {
  value: number | string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-sm px-4 py-6"
      style={{ backgroundColor: "#111111" }}
    >
      <span
        className="text-4xl font-bold"
        style={{ color: accent ? "#c8a882" : "#ffffff" }}
      >
        {value}
      </span>
      <span
        className="mt-2 text-[10px] tracking-widest uppercase"
        style={{ color: "#888888" }}
      >
        {label}
      </span>
    </div>
  );
}
