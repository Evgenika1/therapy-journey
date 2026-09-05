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

export default nextConfig;
