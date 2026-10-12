"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useAction } from "@/hooks/use-action"
import type { ActionResult } from "@/lib/actions"

/** A button that asks for confirmation (and optionally a reason) before running a server action. */
export function ConfirmAction({
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  reason,
  onConfirm,
  success,
  children,
  variant = "outline",
  size = "sm",
  className,
  disabled,
}: {
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  reason?: { label: string; required?: boolean; placeholder?: string }
  onConfirm: (reason: string) => Promise<ActionResult<unknown>>
  success?: string
  children: React.ReactNode
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const { pending, execute } = useAction()
  const blocked = Boolean(reason?.required && !text.trim())

  return (
    <>
      <Button variant={variant} size={size} className={className} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          {reason ? (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-reason" className="text-xs">
                {reason.label}
                {reason.required ? <span className="text-destructive"> *</span> : null}
              </Label>
              <Textarea
                id="confirm-reason"
                value={text}
                placeholder={reason.placeholder}
                onChange={(e) => setText(e.target.value)}
                rows={3}
              />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={pending || blocked}
              onClick={async () => {
                const r = await execute(() => onConfirm(text.trim()), { success })
                if (r.ok) {
                  setOpen(false)
                  setText("")
                }
              }}
            >
              {pending ? "Working…" : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
