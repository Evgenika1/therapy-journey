import Link from 'next/link';

// Shell for the legal pages. Public (see publicPaths.js), so it stands on its
// own rather than inside AppLayout: a visitor without an account has no
// sidebar to show. Colours are the theme tokens, so the page follows the
// time-of-day palette like the rest of the app; typography is in globals.css
// under .legal.
export default function LegalPage({ title, updated, children }) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <Link href="/" className="legal-logo" aria-label="Kevi — home">kevi</Link>
      </header>
      <article className="legal">
        <h1>{title}</h1>
        {updated && <p className="legal-updated">Last updated: {updated}</p>}
        {children}
      </article>
      <footer className="legal-footer">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <a href="mailto:hi@kevi.online">hi@kevi.online</a>
      </footer>
    </div>
  );
}
