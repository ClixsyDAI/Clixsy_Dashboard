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

interface CommentData {
  name: string;
  comments: number;
}

interface Props {
  data: CommentData[];
}

export default function CommentActivityChart({ data }: Props) {
  return (
    <div
      className="rounded-sm p-6"
      style={{ backgroundColor: "#111111" }}
    >
      <h3
        className="mb-4 text-sm font-semibold tracking-wide uppercase"
        style={{ color: "#f0ede8" }}
      >
        Top 10 Most Commented Tasks
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
              width={200}
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
              dataKey="comments"
              name="Comments"
              fill="#C8A882"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
