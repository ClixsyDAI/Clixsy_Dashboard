"use client";

import CompletionDonut from "./CompletionDonut";
import TasksByCategory from "./TasksByCategory";
import CommentActivityChart from "./CommentActivityChart";
import CompletionGauge from "./CompletionGauge";
import CompletionTimeline from "./CompletionTimeline";

interface CategoryData {
  name: string;
  completed: number;
  outstanding: number;
}

interface CommentData {
  name: string;
  comments: number;
}

interface TimelineData {
  month: string;
  completed: number;
}

interface Props {
  completedCount: number;
  outstandingCount: number;
  completionRate: number;
  categoryData: CategoryData[];
  commentData: CommentData[];
  timelineData: TimelineData[];
}

export default function ClientDashboardCharts({
  completedCount,
  outstandingCount,
  completionRate,
  categoryData,
  commentData,
  timelineData,
}: Props) {
  return (
    <div className="mt-8 space-y-6">
      {/* Row 1: Donut + Gauge */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CompletionDonut
          completed={completedCount}
          outstanding={outstandingCount}
        />
        <CompletionGauge rate={completionRate} />
      </div>

      {/* Row 2: Tasks by Category */}
      <TasksByCategory data={categoryData} />

      {/* Row 3: Comment Activity + Timeline */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CommentActivityChart data={commentData} />
        <CompletionTimeline data={timelineData} />
      </div>
    </div>
  );
}
