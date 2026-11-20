import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // /progress was folded into the dashboard. Kept as a redirect rather than a
  // 404 so bookmarks and any link already out in the world still land somewhere.
  // Deliberately temporary (307): a permanent redirect is cached by the browser
  // for good, which would be awkward if the screen ever comes back.
  async redirects() {
    return [
      { source: '/progress', destination: '/', permanent: false },
      // Topics moved onto the dashboard; the countdown and the date did not
      // survive the move, so there is no page left to send anyone to.
      { source: '/next-session', destination: '/', permanent: false },
    ];
  },
};

// Source maps go to Sentry only when SENTRY_AUTH_TOKEN is set (Vercel builds),
// so stack traces point at real code; they are not served to browsers.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sentryUrl: 'https://de.sentry.io/',
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
});
