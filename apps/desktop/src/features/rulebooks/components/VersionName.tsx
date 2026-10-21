import { Badge } from "../../../design-system";
import { useRulebookVersion } from "../../references/hooks/references";
import { versionState } from "../view-models/versions";

/** A version's rulebook name, number and state, read by id. */
export function VersionName({ id }: { id: string }) {
  const v = useRulebookVersion(id);
  if (!v.data) return <span className="ds-faint">{v.error ? "Unreadable version" : "…"}</span>;
  return <span>{v.data.rulebook.displayName} · v{v.data.version.versionNumber} <Badge tone={versionState(v.data).tone}>{versionState(v.data).label}</Badge></span>;
}
