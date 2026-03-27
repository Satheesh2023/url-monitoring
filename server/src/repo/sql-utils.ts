export function placeholders(n: number): string {
  if (n <= 0) return "";
  return Array(n).fill("?").join(", ");
}
