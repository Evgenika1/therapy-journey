import { NextResponse } from 'next/server';
import { DEV_VERSION } from '@/lib/appVersion';

// Which build is deployed right now. A tab compares this with the value it saw
// when it loaded, so it can tell the user their page is out of date — see
// src/lib/appVersion.js for why that matters.
//
// No auth: it says nothing but a commit sha, and every open tab asks for it.
export const dynamic = 'force-dynamic';

export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return NextResponse.json(
    { version: typeof sha === 'string' && sha ? sha.slice(0, 7) : DEV_VERSION },
    // Must not be cached: a cached answer is exactly the stale value we are
    // trying to detect.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
