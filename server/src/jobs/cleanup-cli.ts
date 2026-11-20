import { getPostgresMaintenanceClient } from '../db'
import { cleanupExitCode, runCleanupJob } from './cleanup'

const main = async () => {
  const sql = getPostgresMaintenanceClient()
  if (!sql) {
    console.error('Cleanup job failed: no postgres client (DATABASE_URL unset or dev mode)')
    return 1
  }
  try {
    const summary = await runCleanupJob({ sql })
    // Counts are deliberately redacted: no URLs, provider identifiers, or DB details.
    console.log(JSON.stringify(summary))
    return cleanupExitCode(summary)
  } catch (error) {
    // Name and driver code only: messages can carry hostnames or SQL.
    const name = error instanceof Error ? error.name : typeof error
    const code = (error as { code?: unknown } | null)?.code
    console.error(`Cleanup job failed: ${name}${typeof code === 'string' ? ` (${code})` : ''}`)
    return 1
  } finally {
    await sql.end({ timeout: 5 })
  }
}

process.exitCode = await main()
