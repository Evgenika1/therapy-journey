// Shown instead of the app on phone-width screens. The web app is laid out for
// a desktop — a 200px sidebar and multi-column pages — and a phone gets a
// promise of the native app rather than a squeezed version of it.
//
// Rendered on the server and switched by CSS (see `.mobile-gate` in
// globals.css), not by reading the window: a JS check would paint the app
// first and swap it out after hydration, so a phone would flash the desktop
// layout on every load.
//
// The store badges are deliberately not links — there is nothing to link to
// yet. When the app ships, turn each into an <a> pointing at its listing.

const STORES = ['App Store', 'Google Play'];

export default function MobileGate() {
  return (
    <main className="mobile-gate">
      <div className="mobile-gate-inner">
        <span className="mobile-gate-logo">miru</span>

        <h1 className="mobile-gate-title">
          miru is coming <em>to your phone</em>
        </h1>

        <p className="mobile-gate-text">
          The phone app is on its way. Until it arrives, open miru on a computer —
          your sessions, notes and homework are all there.
        </p>

        <ul className="mobile-gate-stores" aria-label="Coming soon to">
          {STORES.map(store => (
            <li key={store} className="mobile-gate-store">
              <span className="mobile-gate-soon">Coming soon</span>
              <span className="mobile-gate-store-name">{store}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
