"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface Props {
  completed: number;
  outstanding: number;
}

const COLORS = ["#2D6A4F", "#B08D57"];

export default function CompletionDonut({ completed, outstanding }: Props) {
  const data = [
    { name: "Completed", value: completed },
    { name: "Outstanding", value: outstanding },
  ];

  return (
    <div
      className="rounded-sm p-6"
      style={{ backgroundColor: "#111111" }}
    >
      <h3
        className="mb-4 text-sm font-semibold tracking-wide uppercase"
        style={{ color: "#f0ede8" }}
      >
        Task Completion
      </h3>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a1a1a",
                border: "1px solid #333333",
                borderRadius: 4,
                color: "#f0ede8",
                fontSize: 12,
              }}
              formatter={(value) => [String(value), undefined]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex justify-center gap-6">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: "#2D6A4F" }} />
          <span className="text-xs" style={{ color: "#888888" }}>
            Completed ({completed})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: "#B08D57" }} />
          <span className="text-xs" style={{ color: "#888888" }}>
            Outstanding ({outstanding})
          </span>
        </div>
      </div>
    </div>
  );
}
