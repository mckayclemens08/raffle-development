import { NextResponse } from "next/server";
import { resolveGeo } from "@/lib/geo";

/// Geolocates the request server-side. All the sourcing logic and its caveats
/// live in lib/geo so the verification route resolves location exactly the same
/// way — two implementations would eventually disagree, and disagreeing about
/// jurisdiction is a compliance failure, not a bug.
///
/// Runs on the server on purpose: a client-side check (navigator.geolocation or
/// a browser IP lookup) is editable by the user and worthless for compliance.
export async function GET(request: Request) {
  const geo = await resolveGeo(request.headers);
  return NextResponse.json(geo);
}
