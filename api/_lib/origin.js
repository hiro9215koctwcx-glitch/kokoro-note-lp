export function appOrigin(req) {
  const strict = process.env.APP_URL?.replace(/\/$/, "");
  if (strict) return strict;
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || process.env.VERCEL_URL || "";
  const proto =
    req.headers?.["x-forwarded-proto"] ||
    (host.includes("localhost") ? "http" : "https");
  if (!host) return "http://localhost:3000";
  const h = `${proto}://${host}`;
  return h.replace(/\/$/, "");
}
