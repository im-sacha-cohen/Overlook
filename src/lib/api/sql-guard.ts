const READ_ONLY_PREFIXES = ["select", "with", "explain", "show", "pragma", "describe"];

export function isReadOnlyStatement(sql: string): boolean {
  const trimmed = sql.trim().toLowerCase();
  return READ_ONLY_PREFIXES.some((p) => trimmed.startsWith(p));
}
