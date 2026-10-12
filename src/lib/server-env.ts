import "server-only"

export const serverEnv = {
  get serviceRoleKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? ""
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? ""
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY ?? ""
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? ""
  },
}

/** Thrown when an operation needs configuration that has not been provided. */
export class MissingConfigError extends Error {
  constructor(public readonly variables: string[], purpose: string) {
    super(`${purpose} is unavailable: set ${variables.join(", ")} in the server environment.`)
    this.name = "MissingConfigError"
  }
}
