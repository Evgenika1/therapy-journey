import Link from 'next/link';
import LegalPage from '@/components/LegalPage';

export const metadata = {
  title: 'Terms of Service — Kevi',
  description: 'The agreement between you and Newlife app, the operator of Kevi.',
};

const EMAIL = 'hi@kevi.online';
const Mail = () => <a href={`mailto:${EMAIL}`}>{EMAIL}</a>;

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="11 November 2026">
      <p>
        Welcome to Kevi. These Terms of Service are an agreement between you and Newlife app, the operator of
        Kevi, based in the Netherlands. By creating an account or using Kevi, you agree to these Terms. If you
        do not agree, please do not use Kevi.
      </p>

      <h2>1. What Kevi is</h2>
      <p>
        Kevi is a private companion app for therapy and coaching. It lets you record or upload sessions,
        generate transcripts and AI reflections, track emotions, keep journals, and prepare for future
        sessions.
      </p>
      <p>
        Kevi is not therapy and not a medical service. It does not diagnose, treat, or provide medical or
        psychological advice, and using it does not create a therapist–patient or doctor–patient relationship.
        Kevi is a tool to support your own reflection — it is not a substitute for a qualified professional.
      </p>
      <p>
        If you are in crisis, in danger, or need urgent help, contact a qualified professional or your local
        emergency services immediately. Kevi is not designed for emergencies.
      </p>

      <h2>2. Who can use Kevi</h2>
      <p>
        You must be at least 18 years old to use Kevi. By using Kevi you confirm that you are 18 or older.
      </p>

      <h2>3. Your account</h2>
      <p>
        You are responsible for keeping your login details secure and for activity on your account. Provide
        accurate information when you register. Tell us at <Mail /> if you believe your account has been
        accessed without your permission.
      </p>

      <h2>4. Your content</h2>
      <p>
        You own your content. The recordings, transcripts, notes, and other material you create remain yours.
        You grant us only the limited permission needed to operate the service for you — to store your
        content, process it (including sending it to our transcription and AI providers) to generate the
        features you ask for, and show it back to you, as described in our <Link href="/privacy">Privacy
        Policy</Link>.
      </p>
      <p>
        <strong>Recording others:</strong> if you record a session that includes another person, you are
        responsible for having any consent the law requires where you and they are located. Recording people
        without a lawful basis may be illegal. Kevi is not responsible for recordings you make.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use Kevi for anything unlawful, or to harm or harass others;</li>
        <li>upload content you have no right to upload;</li>
        <li>attempt to break, overload, reverse-engineer, or gain unauthorised access to the service;</li>
        <li>use Kevi to provide medical or psychological services to other people.</li>
      </ul>
      <p>We may suspend or close accounts that break these Terms.</p>

      <h2>6. AI-generated content</h2>
      <p>
        Kevi uses AI to produce transcripts, analyses, patterns, and chat replies. AI can be inaccurate or
        incomplete. Do not rely on AI output as fact or as professional advice. You are responsible for how you
        use what Kevi generates.
      </p>

      <h2>7. Subscriptions and payment</h2>
      <p>
        Kevi may offer paid subscription plans. The price, billing period, and what each plan includes are
        shown before you subscribe. Payment is handled by our payment provider; by subscribing you also accept
        their terms.
      </p>
      <p>
        Subscriptions renew automatically each billing period unless you cancel before renewal. You can cancel
        at any time, effective at the end of the current period. Except where the law requires otherwise,
        payments already made are non-refundable. We may change prices or plans and will give reasonable notice
        of changes that affect you.
      </p>

      <h2>8. Availability</h2>
      <p>
        We work to keep Kevi available and reliable, but we provide it &ldquo;as is&rdquo; and cannot promise
        it will always be uninterrupted or error-free. We may change, suspend, or discontinue features.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Kevi and Newlife app are not liable for any indirect or
        consequential loss, or for any decision you make based on content Kevi generates. Nothing in these
        Terms limits liability that cannot be limited by law. Because Kevi is not a medical service, we are not
        responsible for health decisions — always consult a qualified professional.
      </p>

      <h2>10. Ending your use</h2>
      <p>
        You can stop using Kevi and delete your account at any time. We may suspend or end your access if you
        break these Terms or if we must do so for legal or security reasons.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>
        We may update these Terms as Kevi grows or as the law changes. When we make a material change we update
        the date and, where appropriate, notify you in the app. Continuing to use Kevi after a change means you
        accept the updated Terms.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These Terms are governed by the law of the Netherlands, and disputes are subject to the competent Dutch
        courts, unless mandatory law in your country of residence gives you other rights.
      </p>

      <h2>13. Contact</h2>
      <p>
        Newlife app — operator of Kevi.<br />
        Email: <Mail />
      </p>
    </LegalPage>
  );
}
