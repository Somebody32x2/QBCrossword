/**
 * Edge networks whose client-address header may be trusted.
 *
 * Behind a CDN plus a reverse proxy that does not trust the CDN's forwarded
 * headers, the only address left in `X-Forwarded-For` is the CDN edge, shared
 * by every visitor in a region. The CDN still sends the visitor's address in
 * its own header (Cloudflare: `CF-Connecting-IP`), but anyone reaching the
 * origin directly can forge it, so it is believed only when the edge address
 * itself falls inside the CDN's published ranges.
 */

import net from "node:net";

/** https://www.cloudflare.com/ips/ - fetched 2026-09-24. */
export const CLOUDFLARE_RANGES: readonly string[] = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

/** "cloudflare", a comma-separated CIDR list, or both. Null when nothing is trusted. */
export function edgeBlockList(spec: string): net.BlockList | null {
  const entries = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => (s.toLowerCase() === "cloudflare" ? CLOUDFLARE_RANGES : [s]));
  if (entries.length === 0) return null;
  const list = new net.BlockList();
  for (const cidr of entries) {
    const [addr = "", bits] = cidr.split("/");
    const family = net.isIP(addr);
    if (!family || !/^\d+$/.test(bits ?? "")) throw new Error(`CLIENT_IP_HEADER_FROM: not a CIDR: ${cidr}`);
    list.addSubnet(addr, Number(bits), family === 6 ? "ipv6" : "ipv4");
  }
  return list;
}

export function inEdge(list: net.BlockList, address: string): boolean {
  const family = net.isIP(address);
  return family !== 0 && list.check(address, family === 6 ? "ipv6" : "ipv4");
}
