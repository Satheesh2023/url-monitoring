/** mysql2 / Aurora errors — used instead of Prisma error class names. */
export function isDbDriverError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const o = err as Record<string, unknown>;
  return (
    typeof o.code === "string" ||
    typeof o.errno === "number" ||
    typeof o.sqlState === "string"
  );
}
