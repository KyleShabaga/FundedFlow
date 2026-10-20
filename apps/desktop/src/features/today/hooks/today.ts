import { getCapability } from "../../shared/capabilities";
/** No fabricated live summary. Stored snapshots are available through useLatestSnapshot, explicitly not live. */
export const useTodayCapability = () => getCapability("today-summary");
export const useReviewCapability = () => getCapability("structured-reviews");
