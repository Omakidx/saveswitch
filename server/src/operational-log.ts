/**
 * Emits only a stable event and coarse error kind. Never pass an Error object,
 * message, SQL, parameters, provider response, or user content to the logger.
 */
export const logOperationalFailure = (event: string, failure: unknown) => {
  const kind = failure instanceof TypeError
    ? 'type-error'
    : failure instanceof Error
      ? 'error'
      : 'non-error'
  console.error(event, { kind })
}
