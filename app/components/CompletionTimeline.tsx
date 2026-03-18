"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface TimelineData {
  month: string;
  completed: number;
}

interface Props {
  data: TimelineData[];
}

export default function CompletionTimeline({ data }: Props) {
  return (
    <div
      className="rounded-sm p-6"
      style={{ backgroundColor: "#111111" }}
    >
      <h3
        className="mb-4 text-sm font-semibold tracking-wide uppercase"
        style={{ color: "#f0ede8" }}
      >
        Task Completions Over Time
      </h3>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="completedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#C8A882" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#C8A882" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333333" />
            <XAxis
              dataKey="month"
              tick={{ fill: "#888888", fontSize: 11 }}
              axisLine={{ stroke: "#333333" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#888888", fontSize: 11 }}
              axisLine={{ stroke: "#333333" }}
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
            <Area
              type="monotone"
              dataKey="completed"
              name="Completed"
              stroke="#C8A882"
              strokeWidth={2}
              fill="url(#completedGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
