import LegalPage from '@/components/LegalPage';

export const metadata = {
  title: 'Privacy Policy — Kevi',
  description: 'What personal data Kevi collects, why, how it is protected, and your rights under the GDPR.',
};

const EMAIL = 'hi@kevi.online';
const Mail = () => <a href={`mailto:${EMAIL}`}>{EMAIL}</a>;

const SUB_PROCESSORS = [
  ['Supabase',   'Database and storage',     'EU (Ireland)'],
  ['AssemblyAI', 'Speech-to-text',           'EU endpoint'],
  ['Anthropic',  'AI analysis and chat',     'United States'],
  ['Vercel',     'Hosting',                  'United States'],
  ['Resend',     'Account emails',           '—'],
  ['Stripe',     'Payment processing, if you subscribe', '—'],
];

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="11 November 2026">
      <h2>1. Who we are</h2>
      <p>
        Kevi is a private companion app for therapy and coaching, operated by Newlife app, based in the
        Netherlands. For any question about this policy or your personal data, contact us at <Mail />. This
        policy explains what personal data we collect, why, how we protect it, and the rights you have under
        the EU GDPR and Dutch data-protection law.
      </p>

      <h2>2. Who can use Kevi</h2>
      <p>
        Kevi is intended only for adults aged 18 or older. We do not knowingly collect data from anyone under
        18. If you believe a minor has created an account, contact us at <Mail /> and we will delete it.
      </p>

      <h2>3. Kevi is not a medical service</h2>
      <p>
        Kevi is a self-reflection and journaling tool. It is not a medical device, not a substitute for
        therapy, diagnosis, or treatment, and does not provide medical advice. If you are in crisis or need
        urgent help, contact a qualified professional or your local emergency services. Nothing in Kevi
        creates a therapist–patient or doctor–patient relationship.
      </p>

      <h2>4. What data we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your email address and an encrypted password.</li>
        <li>
          <strong>Content you create:</strong> audio recordings of sessions you record; transcripts generated,
          pasted, or uploaded; notes, diary entries, journal entries, and emotion logs; AI analyses, patterns,
          homework items, and chat conversations generated from your content; topics you save for future
          sessions.
        </li>
        <li><strong>Technical data:</strong> basic information needed to run the service securely.</li>
      </ul>
      <p>
        Because the content you create can reveal information about your mental and emotional health, it is
        treated as a special category of personal data under Article 9 GDPR and handled with extra care.
      </p>
      <p>We do not sell your data and do not use your content to show you advertising.</p>

      <h2>5. Why we use your data, and our legal basis</h2>
      <div className="legal-table">
        <table>
          <thead>
            <tr><th>What we do</th><th>Legal basis</th></tr>
          </thead>
          <tbody>
            <tr><td>Create and secure your account and let you sign in</td><td>Performance of a contract</td></tr>
            <tr><td>Store and show you your content</td><td>Performance of a contract</td></tr>
            <tr><td>Transcribe audio and generate AI analysis, patterns and chat replies at your request</td><td>Performance of a contract</td></tr>
            <tr><td>Process health-related content you create</td><td>Explicit consent (Art. 9(2)(a) GDPR)</td></tr>
            <tr><td>Take payment and manage subscriptions</td><td>Performance of a contract</td></tr>
            <tr><td>Keep the service secure and prevent abuse</td><td>Legitimate interests</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        You give explicit consent when you create or upload health-related content, and you can withdraw it at
        any time. Withdrawing consent does not affect processing that already took place.
      </p>

      <h2>6. How we protect your data</h2>
      <p>
        Your data is stored on servers in the European Union (Ireland). Access is restricted to your own
        account. Sensitive content fields are encrypted. Connections use HTTPS. No system is perfectly secure,
        but we take appropriate technical and organisational measures as GDPR requires.
      </p>

      <h2>7. Who processes your data on our behalf (sub-processors)</h2>
      <p>
        To run Kevi we use trusted providers, each processing your data only on our instructions under a
        data-processing agreement:
      </p>
      <div className="legal-table">
        <table>
          <thead>
            <tr><th>Provider</th><th>Purpose</th><th>Location</th></tr>
          </thead>
          <tbody>
            {SUB_PROCESSORS.map(([name, purpose, where]) => (
              <tr key={name}><td>{name}</td><td>{purpose}</td><td>{where}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Where a provider is outside the EU, transfers are protected by appropriate safeguards such as EU
        Standard Contractual Clauses. We may update this list; the current version lives on this page.
      </p>

      <h2>8. How long we keep your data</h2>
      <p>
        We keep your content for as long as your account exists. When you delete your account, your content is
        deleted. Some limited records we are legally required to keep (such as payment records) may be retained
        for the period the law requires, and backups cycle out on a rolling basis.
      </p>

      <h2>9. Your rights</h2>
      <p>Under the GDPR you can:</p>
      <ul>
        <li>access the data we hold about you;</li>
        <li>rectify wrong data;</li>
        <li>erase your data (delete your account at any time);</li>
        <li>restrict or object to certain processing;</li>
        <li>receive your data in a common format (portability);</li>
        <li>withdraw consent at any time where processing is based on consent;</li>
        <li>
          lodge a complaint with a supervisory authority. In the Netherlands this is the Autoriteit
          Persoonsgegevens (<a href="https://autoriteitpersoonsgegevens.nl" rel="noopener noreferrer" target="_blank">autoriteitpersoonsgegevens.nl</a>).
        </li>
      </ul>
      <p>
        To exercise any right, email <Mail />. We respond within the time limits set by law (normally one
        month).
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        We may update this policy as Kevi grows or as the law changes. When we make a material change we
        update the date above and, where appropriate, notify you in the app.
      </p>

      <h2>11. Contact</h2>
      <p>
        Newlife app — operator of Kevi.<br />
        Email: <Mail />
      </p>
    </LegalPage>
  );
}
