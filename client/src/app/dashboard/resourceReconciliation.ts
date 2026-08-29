export interface ResourceWithId {
  id: string;
}

/**
 * Applies resources created after a list request began onto that request's
 * result. The create response is authoritative for those ids, and the result
 * contains every id only once.
 */
export function reconcileFetchedResources<Resource extends ResourceWithId>(
  fetchedResources: Resource[],
  createdSinceRequest: Resource[],
): Resource[] {
  const createdById = new Map(createdSinceRequest.map((resource) => [resource.id, resource]));
  const fetchedIds = new Set<string>();
  const reconciled: Resource[] = [];

  for (const resource of fetchedResources) {
    if (fetchedIds.has(resource.id)) continue;
    fetchedIds.add(resource.id);
    reconciled.push(createdById.get(resource.id) ?? resource);
  }

  for (const resource of createdSinceRequest) {
    if (!fetchedIds.has(resource.id)) {
      reconciled.push(createdById.get(resource.id) ?? resource);
      fetchedIds.add(resource.id);
    }
  }

  return reconciled;
}
