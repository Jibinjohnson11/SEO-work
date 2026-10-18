import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production"
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : ""
  } catch {
    return ""
  }
})()

// Content Security Policy. Scripts and styles may only come from this app ('unsafe-inline' is
// needed for the inline scripts Next.js and next-themes emit without nonces). Images allow any
// HTTPS source because the logo and avatars are admin-provided URLs. Data requests go to this
// app (and Supabase, in case a browser client is ever used); no other origin can be contacted.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseOrigin.replace(/^http/, "ws")}` : ""}${isDev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Browsers ignore HSTS on plain-HTTP responses, so this is harmless for local development.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The staging loader (scripts/staging-env.mjs) builds into .next-staging so a staging build can
  // never be mistaken for, or overwrite, the production build in .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Every page is per-user and authenticated, so rendering stays fully dynamic.
  cacheComponents: false,
  serverExternalPackages: ["exceljs", "jspdf", "jspdf-autotable"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
