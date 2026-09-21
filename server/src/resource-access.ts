/** Pure policy for the three intentional ways to read a resource. */
export type ResourceReadContext = {
  resourcePageId: string
  pageUserId: string | null
  pageVisibility: 'public' | 'private'
  userVisibility: 'public' | 'private' | null
  pageSessionId: string | null
  rootSessionId: string | null
  rootPathCode: string | null
  rootExpired: boolean
}

export const canReadResource = ({
  resource,
  authenticatedUserId,
  xoomsharePathCode,
}: {
  resource: ResourceReadContext
  authenticatedUserId: string | null
  xoomsharePathCode: string | null
}) => {
  if (resource.pageUserId !== null && resource.pageUserId === authenticatedUserId) return true
  if (
    resource.pageUserId !== null &&
    resource.pageSessionId === null &&
    resource.pageVisibility === 'public' &&
    resource.userVisibility === 'public'
  ) return true
  return Boolean(
    xoomsharePathCode &&
    resource.rootPathCode === xoomsharePathCode &&
    resource.pageSessionId !== null &&
    resource.rootSessionId !== null &&
    resource.pageSessionId === resource.rootSessionId &&
    !resource.rootExpired,
  )
}
