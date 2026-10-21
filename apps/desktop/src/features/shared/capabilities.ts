import { z } from "zod";

export const capabilitySchema = z.object({
  feature: z.enum(["insights-aggregates"]),
  available: z.literal(false), reason: z.literal("backend-not-implemented"), message: z.string(),
});
export type UnsupportedFeature = z.infer<typeof capabilitySchema>["feature"];
const descriptions: Record<UnsupportedFeature, string> = {
  "insights-aggregates": "Insights aggregates require defined calculations and a supported read operation (Build 23). Persisted snapshots are available separately.",
};
export function getCapability(feature: UnsupportedFeature) {
  return capabilitySchema.parse({ feature, available: false, reason: "backend-not-implemented", message: descriptions[feature] });
}
