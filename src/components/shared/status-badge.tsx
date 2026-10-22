import { cn } from "@/lib/utils"
import {
  CAMPAIGN_STATUS,
  LIVE_STATUS,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SUBMISSION_STATUS,
  TASK_STATUS,
  type Tone,
} from "@/lib/workflow"
import type { CampaignStatus, LiveStatus, Priority, SubmissionStatus, TaskStatus } from "@/lib/types"

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground ring-border",
  info: "bg-accent text-accent-foreground ring-primary/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
  success: "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-400/20",
  danger: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20",
  muted: "bg-muted text-muted-foreground ring-border",
}

const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-primary",
  warning: "bg-amber-500",
  success: "bg-green-600",
  danger: "bg-red-600",
  muted: "bg-border",
}

export function ToneBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT_CLASS[tone])} />
      {children}
    </span>
  )
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const s = SUBMISSION_STATUS[status]
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status]
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
}

export function CampaignStatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  const s = CAMPAIGN_STATUS[status]
  return (
    <ToneBadge tone={s.tone} className={className}>
      {s.label}
    </ToneBadge>
  )
}

export function LiveStatusBadge({ status }: { status: LiveStatus }) {
  const s = LIVE_STATUS[status]
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <ToneBadge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</ToneBadge>
}

export function ActiveBadge({ active, on = "Active", off = "Inactive" }: { active: boolean; on?: string; off?: string }) {
  return <ToneBadge tone={active ? "success" : "muted"}>{active ? on : off}</ToneBadge>
}
