export type ReadinessExecutor = { execute(query: unknown): Promise<unknown> }

/** Database readiness is deliberately a single bounded query with no details. */
export const checkDatabaseReadiness = async (
  executor: ReadinessExecutor,
  query: unknown,
  timeoutMs = 1_500,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: (Promise<unknown> & { cancel?: () => void }) | undefined
  try {
    pending = executor.execute(query) as Promise<unknown> & { cancel?: () => void }
    await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // postgres-js cancellation is best-effort. The connection-level
          // statement timeout is the authoritative server-side upper bound.
          pending?.cancel?.()
          reject(new Error('readiness deadline exceeded'))
        }, timeoutMs)
      }),
    ])
    return true
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}
