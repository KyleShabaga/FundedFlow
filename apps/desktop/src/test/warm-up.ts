// TEST ONLY. Mounts a file's page once before its tests, so one-time costs (first-render JIT, first Intl
// formatters, the design system's first layout) are paid in a beforeAll hook rather than by whichever test runs
// first. In a full run a file's first test took 3–10x the file's median, and first tests were many of the
// CPU-contention timeouts. The whole-app equivalent for journeys is warmUpApp in harness.tsx.
import type { RenderResult } from "@testing-library/react";

/** Mounts with `mount`, waits for `ready`, then unmounts. Call from beforeAll with the file's own render helper. */
export async function warmUp(mount: () => RenderResult, ready: () => Promise<unknown>) {
  const view = mount();
  try {
    await ready();
  } finally {
    view.unmount();
  }
}
