/** Brand logo rules, shared by the form (checked first for clear messages) and the server. */
export const LOGO_BUCKET = "brand-logos"
export const MAX_LOGO_BYTES = 2 * 1024 * 1024
export const LOGO_TYPES: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/svg+xml": ["svg"],
  "image/webp": ["webp"],
}
export const LOGO_ACCEPT = ".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"

export function logoExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

/** Problem with a chosen logo file, or null when it may be uploaded. */
export function logoFileProblem(file: { name: string; size: number; type: string }): string | null {
  if (!file.size) return "The selected file is empty"
  if (!LOGO_TYPES[file.type]?.includes(logoExtension(file.name))) return "Use a PNG, JPG, SVG or WebP image"
  if (file.size > MAX_LOGO_BYTES) return "The logo must be 2 MB or smaller"
  return null
}
