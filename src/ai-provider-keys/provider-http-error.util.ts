import { isAxiosError } from 'axios';

/** Best-effort HTTP status for provider SDK / transport errors. */
export function httpStatusFromError(err: unknown): number | undefined {
  if (isAxiosError(err)) {
    const s = err.response?.status;
    return typeof s === 'number' ? s : undefined;
  }
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const status = o.status;
    if (typeof status === 'number') return status;
    const response = o.response;
    if (response && typeof response === 'object') {
      const rs = (response as Record<string, unknown>).status;
      if (typeof rs === 'number') return rs;
    }
  }
  // Google's SDK embeds the status in the message:
  // `[503 Service Unavailable] This model is currently experiencing high demand.`
  if (err instanceof Error) {
    const m = err.message.match(/\[(\d{3})\b/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 400 && n <= 599) return n;
    }
  }
  return undefined;
}
