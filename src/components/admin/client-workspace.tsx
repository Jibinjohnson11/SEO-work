"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { SwitchField } from "@/components/shared/form"
import { ConfirmAction } from "@/components/shared/confirm-action"
import { useAction } from "@/hooks/use-action"
import { removeMember, savePortalSettings, setMemberPermissions } from "@/server/admin/clients"
import type { PortalSettings } from "@/lib/types"

const LABELS: Record<keyof PortalSettings, [string, string]> = {
  show_campaign_progress: ["Campaign progress", "Monthly submitted / approved / published counts"],
  show_target_counts: ["Monthly targets", "Show backlink targets next to progress"],
  show_published_backlinks: ["Published backlinks", "List of live placements and their verification status"],
  show_reports: ["Reports", "Published report snapshots"],
  allow_report_download: ["Report downloads", "Allow PDF / Excel / CSV download (also needs per-user permission)"],
  show_domain_metrics: ["Domain metrics", "DR / DA values on proposals (third-party estimates)"],
  show_intern_names: ["Team member names", "Show which intern prepared a submission"],
}

export function PortalSettingsForm({ clientId, settings }: { clientId: string; settings: PortalSettings }) {
  const [value, setValue] = useState(settings)
  const { pending, execute } = useAction()
  const dirty = JSON.stringify(value) !== JSON.stringify(settings)
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2">
        {(Object.keys(LABELS) as (keyof PortalSettings)[]).map((k) => (
          <SwitchField key={k} label={LABELS[k][0]} description={LABELS[k][1]} checked={value[k]} onCheckedChange={(c) => setValue({ ...value, [k]: c })} />
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty || pending} onClick={() => execute(() => savePortalSettings(clientId, value))}>
          {pending ? "Saving…" : "Save visibility"}
        </Button>
      </div>
    </div>
  )
}

export function MemberControls({ memberId, canApprove, canDownload, name }: { memberId: string; canApprove: boolean; canDownload: boolean; name: string }) {
  const { pending, execute } = useAction()
  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={canApprove} disabled={pending} onCheckedChange={(c) => execute(() => setMemberPermissions(memberId, { can_approve: Boolean(c), can_download_reports: canDownload }))} />
        Approve
      </label>
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={canDownload} disabled={pending} onCheckedChange={(c) => execute(() => setMemberPermissions(memberId, { can_approve: canApprove, can_download_reports: Boolean(c) }))} />
        Download
      </label>
      <ConfirmAction title={`Remove ${name} from this workspace?`} description="They will lose access to this brand's portal. Their past decisions stay in the history." destructive confirmLabel="Remove" onConfirm={() => removeMember(memberId)} variant="ghost">
        Remove
      </ConfirmAction>
    </div>
  )
}
