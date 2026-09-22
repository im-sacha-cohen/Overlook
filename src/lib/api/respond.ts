export function errorResponse(err: unknown, status = 400) {
  return Response.json({ error: errorMessage(err) }, { status });
}

// Network failures (e.g. pg's ECONNREFUSED) can come as an AggregateError with an empty
// message; dig out something the user can read.
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.message) return err.message;
  if (err instanceof AggregateError && err.errors.length > 0) return errorMessage(err.errors[0]);
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : err.name;
}
