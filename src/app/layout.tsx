import type { Metadata } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { Providers } from "@/components/providers"
import { isSupabaseConfigured } from "@/lib/env"
import { getAllSettings, SETTINGS_DEFAULTS } from "@/server/queries"
import "./globals.css"

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] })
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "LinkOps", template: "%s · LinkOps" },
  description: "SEO campaign management, backlink approvals and reporting",
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const general = isSupabaseConfigured() ? (await getAllSettings()).general : SETTINGS_DEFAULTS.general
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers defaultTheme={general.theme}>{children}</Providers>
      </body>
    </html>
  )
}
