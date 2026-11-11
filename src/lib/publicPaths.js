// Pages a signed-out visitor may open. Everything else sends them to /auth.
//
// The legal pages have to be here: they are linked from the sign-in screen,
// from app-store listings and from Stripe, all read by people who have no
// account yet.

export const PUBLIC_PATHS = ['/auth', '/privacy', '/terms'];

export function isPublicPath(pathname) {
  return PUBLIC_PATHS.includes(pathname);
}
