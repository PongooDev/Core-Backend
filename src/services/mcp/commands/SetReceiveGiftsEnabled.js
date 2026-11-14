// SetReceiveGiftsEnabled {bReceiveGifts} (UFortMcpProfileAccount's, from 3.5 UFortMcpProfileCommonCore's): the gift
// setting, the stat allowed_to_receive_gifts, common_core's on 3.5 (profiles/common.js). From 6.31 a receiver who
// turned it off is sent no gifts (store/gifting.js).
export function setReceiveGiftsEnabled({ req, session }) {
  const enabled = req.body?.bReceiveGifts;
  if (typeof enabled !== "boolean") return;
  const tracker = session.profile("profile0");
  if (tracker.profile.stats.attributes.allowed_to_receive_gifts !== enabled) tracker.setStat("allowed_to_receive_gifts", enabled);
}
