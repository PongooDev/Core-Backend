export function getBuild(req) {
  const match = /CL-(\d+)/.exec(req.get("user-agent") ?? "");
  return match ? match[1] : "unknown";
}
