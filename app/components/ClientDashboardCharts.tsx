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
  /** Replaces the donut's old position; donut + gauge get shrunk into the right column. */
  topWinsSlot?: React.ReactNode;
  /** Inserted between Row 1 (wins + donut/gauge) and Row 2 (Tasks by Category). */
  afterRow1?: React.ReactNode;
}

export default function ClientDashboardCharts({
  completedCount,
  outstandingCount,
  completionRate,
  categoryData,
  commentData,
  timelineData,
  topWinsSlot,
  afterRow1,
}: Props) {
  return (
    <div className="mt-8 space-y-6">
      {/* Row 1: TOP WINS (left) + Donut & Gauge half-width each (right) */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {topWinsSlot ?? (
          <CompletionDonut
            completed={completedCount}
            outstanding={outstandingCount}
          />
        )}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <CompletionDonut
            completed={completedCount}
            outstanding={outstandingCount}
          />
          <CompletionGauge rate={completionRate} />
        </div>
      </div>

      {afterRow1}

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
