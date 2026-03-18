"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface Props {
  rate: number; // 0-100
}

export default function CompletionGauge({ rate }: Props) {
  const data = [
    { name: "Completed", value: rate },
    { name: "Remaining", value: 100 - rate },
  ];

  const getColor = (r: number) => {
    if (r >= 75) return "#2D6A4F";
    if (r >= 50) return "#C8A882";
    return "#B08D57";
  };

  return (
    <div
      className="rounded-sm p-6"
      style={{ backgroundColor: "#111111" }}
    >
      <h3
        className="mb-4 text-sm font-semibold tracking-wide uppercase"
        style={{ color: "#f0ede8" }}
      >
        Completion Rate
      </h3>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="70%"
              startAngle={180}
              endAngle={0}
              innerRadius={70}
              outerRadius={95}
              paddingAngle={0}
              dataKey="value"
              stroke="none"
            >
              <Cell fill={getColor(rate)} />
              <Cell fill="#1a1a1a" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="relative -mt-16 flex flex-col items-center">
        <span className="text-3xl font-bold" style={{ color: getColor(rate) }}>
          {rate}%
        </span>
        <span className="text-xs" style={{ color: "#888888" }}>
          of all tasks completed
        </span>
      </div>
    </div>
  );
}
