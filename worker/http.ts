export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public current?: unknown) {
    super(message);
  }
}

export const json = (body: unknown, status = 200): Response => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export function mutationBoundary(request: Request): Response | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return json({ error: { code: 'FORBIDDEN', message: 'A same-origin request is required.' } }, 403);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: { code: 'INVALID_REQUEST', message: 'A JSON body is required.' } }, 400);
  }
  return null;
}
