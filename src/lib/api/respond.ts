export function errorResponse(err: unknown, status = 400) {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status });
}
