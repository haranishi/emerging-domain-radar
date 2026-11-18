/** A registrable .com has exactly one DNS label before the TLD (1–63 ASCII characters). */
export function isRegistrableCom(domain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.com$/.test(domain);
}
