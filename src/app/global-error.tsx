"use client"

import "./globals.css"

// Last-resort error screen, used when the root layout itself fails (for example when the
// database is unreachable while loading platform settings). It replaces the root layout, so it
// renders its own <html> and <body> and cannot use the app's providers or theme.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background px-4 font-sans text-foreground antialiased">
        <title>Something went wrong · LinkOps</title>
        <div className="max-w-sm space-y-4 text-center">
          <h1 className="text-lg font-semibold tracking-tight">LinkOps is temporarily unavailable</h1>
          <p className="text-sm text-muted-foreground">
            Please try again in a moment.{error.digest ? ` Reference: ${error.digest}` : ""}
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
            {/* A full page load on purpose: client navigation may depend on what just failed. */}
            <a href="/login" className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
              Back to sign in
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
