// OpenNext adapter config for Cloudflare Workers. Every LinkOps page is per-user and dynamic,
// so no incremental (ISR) cache is configured.
import { defineCloudflareConfig } from "@opennextjs/cloudflare"

export default defineCloudflareConfig({})
