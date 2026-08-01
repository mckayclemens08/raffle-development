import { NextResponse } from "next/server";
import { isBlockedCountry } from "@/lib/compliance";

/// Geolocates the request by IP, server-side.
///
/// LIMITATIONS — read before relying on this:
///  * IP geolocation is trivially defeated by a VPN, proxy, or Tor. On its own
///    it is a deterrent, not a control. A licensed operator pairs it with a
///    commercial database (MaxMind GeoIP2 / IP2Location) *plus* VPN/proxy/hosting
///    detection, and cross-checks against the country on the KYC document and
///    the payment instrument.
///  * The headers below are set by the CDN/proxy in front of the app. Locally
///    there is no such proxy, hence the dev override.
///  * This runs server-side on purpose. A client-side check (navigator.geolocation
///    or a browser IP lookup) can be edited by the user and is worthless for
///    compliance.
export async function GET(request: Request) {
  const headers = request.headers;

  const country =
    headers.get("x-vercel-ip-country") ?? // Vercel
    headers.get("cf-ipcountry") ?? // Cloudflare
    headers.get("x-appengine-country") ?? // Google Cloud
    headers.get("x-geo-country") ?? // generic / custom proxy
    null;

  // Local development has no geo-aware proxy in front of it, so allow an
  // explicit override to exercise both the allowed and blocked paths.
  const devOverride = process.env.COMPLIANCE_DEV_COUNTRY;
  const resolved = country ?? devOverride ?? null;

  const region = headers.get("x-vercel-ip-country-region") ?? headers.get("x-geo-region") ?? null;

  return NextResponse.json({
    country: resolved,
    region,
    blocked: resolved ? isBlockedCountry(resolved) : false,
    // Made explicit so the UI can say "we couldn't determine your location"
    // rather than silently treating unknown as permitted.
    determined: Boolean(resolved),
    source: country ? "proxy-header" : devOverride ? "dev-override" : "unknown",
  });
}
