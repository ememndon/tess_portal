"use client";

import * as React from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ScoreRing } from "@/components/score-ring";
import { STAGES, type StageKey } from "@/lib/stages";
import { cn } from "@/lib/utils";

export type BoardJob = {
  id: string;
  title: string;
  companyName: string;
  location: string | null;
  salaryRaw: string | null;
  stage: string;
  matchScore: number | null;
};

function JobCard({ job, dragging }: { job: BoardJob; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[10px] border border-line bg-surface p-2.5",
        dragging && "border-jade-line",
      )}
    >
      <div className="flex items-start gap-2">
        {job.matchScore !== null ? <ScoreRing score={job.matchScore} size={30} /> : null}
        <div className="min-w-0 flex-1">
          <Link
            href={`/pipeline/${job.id}`}
            className="block truncate text-[12.5px] font-semibold text-fg hover:text-jade"
          >
            {job.title}
          </Link>
          <div className="mt-0.5 truncate text-[11px] text-muted">
            {[job.companyName, job.location, job.salaryRaw].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
    </div>
  );
}

function DraggableCard({ job }: { job: BoardJob }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: job.id,
    data: { job },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn("cursor-grab touch-none", isDragging && "opacity-40")}
    >
      <JobCard job={job} />
    </div>
  );
}

function Column({ stage, jobs }: { stage: (typeof STAGES)[number]; jobs: BoardJob[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  return (
    <div className="flex w-[236px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span
          aria-hidden
          className="h-[7px] w-[7px] rounded-pill"
          style={{ background: stage.color }}
        />
        <span className="text-[11px] font-semibold text-muted">{stage.label}</span>
        <span className="ml-auto font-mono text-[10px] text-faint">{jobs.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[120px] flex-1 flex-col gap-2 rounded-[12px] border border-line bg-bg p-2",
          isOver && "border-jade-line",
        )}
      >
        {jobs.map((job) => (
          <DraggableCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}

export function PipelineBoard({ initialJobs }: { initialJobs: BoardJob[] }) {
  const [jobs, setJobs] = React.useState(initialJobs);
  const [active, setActive] = React.useState<BoardJob | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragStart(event: DragStartEvent) {
    setActive((event.active.data.current as { job: BoardJob } | undefined)?.job ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setActive(null);
    const jobId = String(event.active.id);
    const target = event.over?.id ? (String(event.over.id) as StageKey) : null;
    if (!target) return;
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.stage === target) return;
    const previous = jobs;
    setJobs((cur) => cur.map((j) => (j.id === jobId ? { ...j, stage: target } : j)));
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: target }),
    }).catch(() => null);
    if (!res || !res.ok) setJobs(previous);
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-1 gap-gap overflow-x-auto pb-2">
        {STAGES.map((stage) => (
          <Column key={stage.key} stage={stage} jobs={jobs.filter((j) => j.stage === stage.key)} />
        ))}
      </div>
      <DragOverlay>{active ? <JobCard job={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
