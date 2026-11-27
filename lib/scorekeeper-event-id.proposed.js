// Supports the disposable bigint fixture and the actual Hub UUID schema.
// Only server-authoritative event resolvers call this; no browser event IDs.
export const validHubEventId=id=>Number.isSafeInteger(id)&&id>0||typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
