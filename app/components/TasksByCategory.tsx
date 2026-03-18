"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface CategoryData {
  name: string;
  completed: number;
  outstanding: number;
}

interface Props {
  data: CategoryData[];
}

export default function TasksByCategory({ data }: Props) {
  return (
    <div
      className="rounded-sm p-6"
      style={{ backgroundColor: "#111111" }}
    >
      <h3
        className="mb-4 text-sm font-semibold tracking-wide uppercase"
        style={{ color: "#f0ede8" }}
      >
        Tasks by Category
      </h3>
      <div style={{ width: "100%", height: Math.max(280, data.length * 36) }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 20, bottom: 0, left: 10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#333333"
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fill: "#888888", fontSize: 11 }}
              axisLine={{ stroke: "#333333" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={160}
              tick={{ fill: "#888888", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a1a1a",
                border: "1px solid #333333",
                borderRadius: 4,
                color: "#f0ede8",
                fontSize: 12,
              }}
            />
            <Bar
              dataKey="completed"
              name="Completed"
              fill="#2D6A4F"
              stackId="stack"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="outstanding"
              name="Outstanding"
              fill="#B08D57"
              stackId="stack"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex justify-center gap-6">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: "#2D6A4F" }} />
          <span className="text-xs" style={{ color: "#888888" }}>Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: "#B08D57" }} />
          <span className="text-xs" style={{ color: "#888888" }}>Outstanding</span>
        </div>
      </div>
    </div>
  );
}
