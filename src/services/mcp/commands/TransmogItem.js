import { transmogItem as transform } from "../../../transmog/transmog.js";

export function transmogItem({ req, session, notifications }) {
  transform(session, req.body?.transmogKeyTemplateId, req.body?.sacrificeItemIds, notifications);
}
