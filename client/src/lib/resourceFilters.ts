import type { Category } from "@/components/dashboard/CategorySwitch";

export interface FilterableResource {
  type: "link" | "image" | "text" | "pdf" | "file";
}

/**
 * Category filter shared by the owner dashboard and the public profile so the
 * same category always shows the same resources ("video" is the Files tab).
 */
export function filterResourcesByCategory<Resource extends FilterableResource>(
  resources: Resource[],
  category: Category,
): Resource[] {
  switch (category) {
    case "target": return resources;
    case "video": return resources.filter((resource) => resource.type === "file");
    case "image": return resources.filter((resource) => resource.type === "image");
    case "document": return resources.filter((resource) => resource.type === "pdf" || resource.type === "text");
    case "link": return resources.filter((resource) => resource.type === "link");
    default: return resources;
  }
}

const CATEGORIES = new Set<string>(["target", "video", "image", "link", "document"]);

export function parseCategory(value: unknown, fallback: Category = "target"): Category {
  return typeof value === "string" && CATEGORIES.has(value) ? value as Category : fallback;
}
