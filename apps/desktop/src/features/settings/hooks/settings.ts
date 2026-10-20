import * as api from "../api/settings";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";
export const useSettings = () => useFeatureQuery({ key: keys.settings, read: api.readSettings });
export const useSetting = (key: string | null) => useFeatureQuery({ key: keys.setting(key), enabled: key !== null, read: signal => api.readSetting(key!, signal) });
export const useSetSetting = (key: string) => useFeatureMutation({ scope: JSON.stringify(["setting", key]), run: (value: unknown) => api.setSetting(key, value), invalidate: () => [keys.settings] });
export const useRemoveSetting = (key: string) => useFeatureMutation({ scope: JSON.stringify(["setting", key]), run: (_: void) => api.removeSetting(key), invalidate: () => [keys.settings] });
