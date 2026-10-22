"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ImageUp, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BrandLogo } from "@/components/shared/brand-logo"
import { LOGO_ACCEPT, logoFileProblem } from "@/lib/brand-logo"
import { cn } from "@/lib/utils"

/** The logo the form will save: a new file, removal of the current logo, or no change. */
export interface LogoChoice {
  file: File | null
  removed: boolean
}

export function LogoField({ currentUrl, name, value, onChange }: { currentUrl?: string | null; name: string; value: LogoChoice; onChange: (v: LogoChoice) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = useMemo(() => (value.file ? URL.createObjectURL(value.file) : null), [value.file])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function choose(file: File | undefined) {
    if (!file) return
    const problem = logoFileProblem(file)
    setError(problem)
    if (!problem) onChange({ file, removed: false })
  }

  const shown = preview ?? (value.removed ? null : currentUrl)
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium">Brand logo <span className="font-normal text-muted-foreground">(optional)</span></span>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          choose(e.dataTransfer.files[0])
        }}
        className={cn(
          "flex flex-col items-center gap-4 rounded-lg border border-dashed p-4 transition-colors sm:flex-row",
          dragging ? "border-primary bg-primary/5" : "bg-muted/20",
          error && "border-destructive",
        )}
      >
        <BrandLogo src={shown} name={name || "Brand"} size="lg" className="bg-background" />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="truncate text-sm font-medium">{value.file ? value.file.name : shown ? "Current logo" : "Drag and drop a logo here"}</p>
          <p className="text-xs text-muted-foreground">PNG, JPG, SVG or WebP · max 2 MB</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
            {shown ? <ImageUp /> : <Upload />} {shown ? "Replace" : "Choose File"}
          </Button>
          {shown ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Remove logo"
              onClick={() => {
                setError(null)
                // Clearing a new selection falls back to the current logo; a second click removes that.
                onChange(value.file ? { file: null, removed: false } : { file: null, removed: !!currentUrl })
              }}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept={LOGO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Brand logo file"
          onChange={(e) => {
            choose(e.target.files?.[0])
            e.target.value = ""
          }}
        />
      </div>
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}
