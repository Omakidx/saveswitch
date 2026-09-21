import { getPostgresMaintenanceClient } from '../db'
import { cleanupExitCode, runCleanupJob } from './cleanup'

const main = async () => {
  const sql = getPostgresMaintenanceClient()
  if (!sql) return 1
  try {
    const summary = await runCleanupJob({ sql })
    // Counts are deliberately redacted: no URLs, provider identifiers, or DB details.
    console.log(JSON.stringify(summary))
    return cleanupExitCode(summary)
  } catch {
    console.error('Cleanup job failed')
    return 1
  } finally {
    await sql.end({ timeout: 5 })
  }
}

process.exitCode = await main()
