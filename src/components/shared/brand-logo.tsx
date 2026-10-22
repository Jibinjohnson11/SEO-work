import { Building2 } from "lucide-react"
import { cn } from "@/lib/utils"

const SIZES = { sm: "size-8", md: "size-10", lg: "size-14" } as const

/** A brand's logo, or a neutral placeholder icon when it has none. */
export function BrandLogo({ src, name, size = "md", className }: { src?: string | null; name: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40", SIZES[size], className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL
        <img src={src} alt={`${name} logo`} className="size-full object-contain p-0.5" />
      ) : (
        <Building2 className="size-1/2 text-muted-foreground" aria-hidden />
      )}
    </span>
  )
}
