import LegalPage from '@/components/LegalPage';

export const metadata = {
  title: 'Terms of Service — Kevi',
  description: 'The terms for using Kevi.',
};

// Placeholder until the Terms of Service text is ready. It exists so the
// links from the sidebar and the sign-in screen land on a page, not a 404.
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        Our Terms of Service are being finalised and will be published on this page shortly.
      </p>
      <p>
        Until then, how we handle your personal data is described in our{' '}
        <a href="/privacy">Privacy Policy</a>. For any question, email{' '}
        <a href="mailto:hi@kevi.online">hi@kevi.online</a>.
      </p>
    </LegalPage>
  );
}
