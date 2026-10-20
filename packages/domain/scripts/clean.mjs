// Removes dist/ so a build never ships output from deleted sources.
import { rmSync } from "node:fs";

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
