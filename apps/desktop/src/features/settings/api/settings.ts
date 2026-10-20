import { settingKey, settingSchema } from "@fundedflow/domain";
import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { instant } from "../../shared/contracts";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation, writeOperation } from "../../shared/operations";
const model = settingSchema.extend({ key: settingKey, value: z.json(), updatedAt: instant });
export async function readSettings(signal?: AbortSignal) { return readOperation(() => repository.settings.list(), values => z.array(model).parse(values), signal); }
export async function readSetting(key: string, signal?: AbortSignal) {
  validateInput(settingKey, key);
  return readOperation(() => repository.settings.get(key), value => {
    if (value === null) return null;
    const parsed = model.parse(value);
    if (parsed.key !== key) throw new FeatureDataError("invalid-response");
    return parsed;
  }, signal);
}
export async function setSetting(key: string, value: unknown) {
  validateInput(settingKey, key);
  const parsed = validateInput(z.json(), value);
  if (new TextEncoder().encode(JSON.stringify(parsed)).length > 64 * 1024) throw new FeatureDataError("validation");
  return writeOperation(() => repository.settings.set(key, parsed), output => {
    const result = model.parse(output);
    if (result.key !== key) throw new FeatureDataError("uncertain-outcome");
    return result;
  });
}
export async function removeSetting(key: string) {
  validateInput(settingKey, key);
  return writeOperation(() => repository.settings.remove(key), () => undefined);
}
