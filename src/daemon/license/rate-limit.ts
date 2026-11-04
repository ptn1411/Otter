/**
 * Rate limit bộ nhớ đơn giản cho các endpoint license (chống brute-force
 * license_key và spam heartbeat). Không dùng cho phân quyền — chỉ giới
 * hạn tần suất. Map lưu timestamp các lần gọi gần nhất theo key
 * (thường là "<route>:<ip>"); quá limit trong window thì từ chối.
 * Dùng chung cho cả daemon routes và license server.
 */
const hits = new Map<string, number[]>();

export function allowLicenseRequest(
  key: string,
  limit: number = 30,
  windowMs: number = 60_000,
  now: number = Date.now()
): boolean {
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  return true;
}

export function clearLicenseRateLimits(): void {
  hits.clear();
}
