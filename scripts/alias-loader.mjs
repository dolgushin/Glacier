import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

/**
 * Resolve the "@/..." alias for plain `node` runs (seed script, tests).
 * Next.js handles this through tsconfig paths, but Node does not read those.
 */
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = resolvePath(process.cwd(), "src", specifier.slice(2));
    for (const extension of CANDIDATES) {
      try {
        return await next(pathToFileURL(base + extension).href, context);
      } catch {
        // Try the next candidate extension.
      }
    }
  }
  return next(specifier, context);
}
