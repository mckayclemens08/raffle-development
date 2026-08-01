import "server-only";
import { isBlockedCountry } from "./compliance";

/// Server-side geolocation, resolved through an ordered chain of sources.
///
/// The point of the chain is that the licensed database is queried *locally*
/// from a file we hold, not through a vendor API call sitting in the hot path
/// of every player session. Providers (MaxMind GeoIP2, IP2Location) sell the
/// database as a downloadable file precisely for this; we refresh it on a
/// schedule instead of depending on their uptime per request.
///
/// Order, most to least trustworthy:
///   1. Local licensed database  — ours, offline, no per-request dependency
///   2. CDN / proxy header       — free, present in most hosting, coarse
///   3. Dev override             — local only, so both paths can be exercised
///
/// STILL NOT A CONTROL. Any IP-based method is defeated by a VPN in one click.
/// A licensed operator pairs this with VPN/proxy/hosting-range detection and
/// cross-checks against the country on the identity document. Treat a result
/// here as a deterrent and a signal, never as proof of where someone is.

export type GeoSource = "local-database" | "proxy-header" | "dev-override" | "unknown";

export interface GeoResult {
  country: string | null;
  region: string | null;
  blocked: boolean;
  /// False means we could not place the request at all — the caller must treat
  /// that as "unknown", never as "permitted".
  determined: boolean;
  source: GeoSource;
}

/// Resolves against a locally held provider database, when one is installed.
///
/// Kept behind a dynamic import so the app runs perfectly well without the
/// database file or the reader package — this is the seam a licensed operator
/// fills in, and its absence degrades to the header path rather than crashing.
interface GeoRecord {
  country?: { iso_code?: string };
  subdivisions?: { iso_code?: string }[];
}

interface MaxmindLike {
  open: (path: string) => Promise<{ get: (ip: string) => GeoRecord | null }>;
}

async function fromLocalDatabase(ip: string | null): Promise<GeoResult | null> {
  const dbPath = process.env.GEOIP_DATABASE_PATH;
  if (!dbPath || !ip) return null;

  try {
    // Optional dependency, resolved through a variable specifier so the build
    // doesn't require it to be installed — it only appears once a database is
    // licensed, and until then this whole source is skipped.
    const specifier = "maxmind";
    const maxmind: MaxmindLike | null = await import(specifier).catch(() => null);
    if (!maxmind) return null;

    const lookup = await maxmind.open(dbPath);

    const record = lookup.get(ip);
    const country = record?.country?.iso_code ?? null;
    if (!country) return null;

    return {
      country,
      region: record?.subdivisions?.[0]?.iso_code ?? null,
      blocked: isBlockedCountry(country),
      determined: true,
      source: "local-database",
    };
  } catch {
    // A missing or corrupt database must not take the route down; fall through
    // to the header source and let the caller see a lower-confidence answer.
    return null;
  }
}

function fromProxyHeaders(headers: Headers): GeoResult | null {
  const country =
    headers.get("x-vercel-ip-country") ?? // Vercel
    headers.get("cf-ipcountry") ?? // Cloudflare
    headers.get("x-appengine-country") ?? // Google Cloud
    headers.get("x-geo-country"); // generic / our own proxy

  if (!country) return null;

  return {
    country,
    region: headers.get("x-vercel-ip-country-region") ?? headers.get("x-geo-region"),
    blocked: isBlockedCountry(country),
    determined: true,
    source: "proxy-header",
  };
}

function fromDevOverride(): GeoResult | null {
  const country = process.env.COMPLIANCE_DEV_COUNTRY;
  if (!country) return null;

  return {
    country,
    region: null,
    blocked: isBlockedCountry(country),
    determined: true,
    source: "dev-override",
  };
}

/// Best-effort client IP. Behind a proxy the socket address is the proxy's, so
/// the forwarded header is the only usable value — which is also why it must
/// never be trusted from an untrusted edge.
function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip");
}

export async function resolveGeo(headers: Headers): Promise<GeoResult> {
  const ip = clientIp(headers);

  const resolved =
    (await fromLocalDatabase(ip)) ?? fromProxyHeaders(headers) ?? fromDevOverride();

  return (
    resolved ?? {
      country: null,
      region: null,
      blocked: false,
      determined: false,
      source: "unknown",
    }
  );
}
