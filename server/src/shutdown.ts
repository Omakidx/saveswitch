/** Installs one idempotent graceful shutdown hook for ECS task termination. */
export const installGracefulShutdown = ({
  close,
  exit = (code: number) => process.exit(code),
  signals = ['SIGTERM', 'SIGINT'] as const,
}: {
  close: () => void | Promise<void>
  exit?: (code: number) => never | void
  signals?: readonly NodeJS.Signals[]
}) => {
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    try {
      await close()
      exit(0)
    } catch {
      exit(1)
    }
  }
  for (const signal of signals) process.once(signal, shutdown)
  return shutdown
}
