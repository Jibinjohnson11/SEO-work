import { RoleLayout } from "@/components/app-shell/role-layout"

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RoleLayout role="client">{children}</RoleLayout>
}
