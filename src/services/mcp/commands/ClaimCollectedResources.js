import { claimCollectedResources as claim } from "../../../research/collector.js";

// The research collector's Collect button (WarehouseCollectorSubWidget -> ClaimAllResourceCollectors) sends every
// CollectedResource item's id; FString CollectorsToClaim arrives as collectorsToClaim.
export function claimCollectedResources({ req, session, notifications }) {
  claim(session, req.body?.collectorsToClaim ?? req.body?.CollectorsToClaim ?? [], notifications);
}
