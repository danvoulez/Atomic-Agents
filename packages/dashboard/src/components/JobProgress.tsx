import { ActiveJob } from "@/types";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export default function JobProgress({ job }: { job: ActiveJob }) {
  const started = job.startedAt ? new Date(job.startedAt).getTime() : Date.now();
  const duration = formatDuration(Date.now() - started);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-slate-800 rounded-lg">
      <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
      <div className="flex-1 text-sm text-slate-300">
        <div>{job.currentAction || "Processing..."}</div>
        <div className="text-xs text-slate-500">
          Job #{job.id.slice(0, 8)} • Step {job.stepsUsed ?? 0}/{job.stepCap ?? "?"} • {job.status}
        </div>
      </div>
      <div className="text-xs text-slate-500">{duration}</div>
    </div>
  );
}
