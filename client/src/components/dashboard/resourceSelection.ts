export interface PositionedResource {
  id: string;
  x: number;
  y: number;
}

export function moveResource(
  resource: PositionedResource,
  offset: { x: number; y: number },
) {
  return {
    id: resource.id,
    x: Math.round(resource.x + offset.x),
    y: Math.round(resource.y + offset.y),
  };
}
