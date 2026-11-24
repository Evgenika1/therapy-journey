import Link from 'next/link';
import { PLANS, PLAN_ORDER, FREE_TRIAL_MINUTES } from '@/lib/plans';

// The page a visitor without an account sees at kevi.online (AuthProvider
// sends a signed-out "/" here). Public and server-rendered: it is what an ad
// lands on, often on a phone, so it is readable there too (globals.css,
// .landing-shell). The product pictures are drawn in HTML with made-up data,
// not screenshots of anyone's sessions.

export const metadata = {
  title: 'Kevi — remember every therapy session',
  description: `Record your online therapy sessions, get a transcript and a gentle summary of what came up, and bring it into the next one. ${FREE_TRIAL_MINUTES} free minutes, no card.`,
};

const START = '/auth?mode=signup';

const FAQ = [
  ['Is Kevi a replacement for therapy?',
   'No. Kevi is a journal for the therapy you already have. It helps you remember and reflect between sessions; it does not diagnose, treat or give medical advice. If you are in crisis, contact a local crisis line or emergency services.'],
  ['Do I need my therapist’s permission to record?',
   'Please ask first. Most therapists are glad you want to remember the session, and asking keeps the trust between you. In some places their consent is also required by law, and it is your responsibility to have it.'],
  ['Which sessions can Kevi record?',
   'Online sessions on Zoom, Google Meet, Teams and others. Kevi records through your microphone: use your speakers and both voices are there, whichever app the call is in. With headphones, open the call in your browser and Kevi records its tab together with your microphone.'],
  ['Which languages does it understand?',
   'Kevi detects the language of the session by itself. English, Russian, Dutch, German, Spanish, French and many more work.'],
  ['Who can see my sessions?',
   'Only you. Your data is stored in the EU, encrypted, never sold and never used for advertising. You can download everything or delete your account at any time.'],
  ['What happens after the free minutes?',
   `You get ${FREE_TRIAL_MINUTES} free minutes once, with no card. After that you choose a plan, or simply stop — nothing is charged unless you subscribe. Plans can be cancelled at any time.`],
];

function AnalysisCard() {
  return (
    <div className="lp-card lp-mock" aria-hidden="true">
      <div className="lp-mock-label">Session · 14 Nov · 52 min</div>
      <div className="lp-mock-h">Key theme</div>
      <p className="lp-mock-p">Criticism stays with you long after the moment, while praise slips away — at work and with your mother.</p>
      <div className="lp-mock-h">Breakthroughs</div>
      <ul className="lp-mock-ul">
        <li>You noticed you had forgotten two colleagues praising your report.</li>
        <li>Saying it out loud already felt lighter.</li>
      </ul>
      <div className="lp-mock-h">Emotions</div>
      <div className="lp-chips"><span>tiredness</span><span>self-doubt</span><span>relief</span></div>
    </div>
  );
}

function PatternsCard() {
  return (
    <div className="lp-card lp-mock" aria-hidden="true">
      <div className="lp-mock-label">Patterns · last 6 sessions</div>
      {[['Replaying criticism', 5], ['Need to be perfect at work', 4], ['Guilt after saying no', 3]].map(([t, n]) => (
        <div key={t} className="lp-bar-row">
          <span>{t}</span>
          <span className="lp-bar"><span style={{ width: `${(n / 6) * 100}%` }} /></span>
          <span className="lp-bar-n">{n}/6</span>
        </div>
      ))}
      <p className="lp-mock-p lp-mock-muted">Trigger seen most often: feedback given in front of others.</p>
    </div>
  );
}

function HomeworkCard() {
  return (
    <div className="lp-card lp-mock" aria-hidden="true">
      <div className="lp-mock-label">Between sessions</div>
      <div className="lp-check"><span className="lp-box lp-box-on">✓</span>When criticism sticks, write down one thing that went well that day.</div>
      <div className="lp-check"><span className="lp-box" />After visiting Mum, notice whether one comment colours the whole visit.</div>
      <div className="lp-mock-h">For your next session</div>
      <p className="lp-mock-p">Why does praise feel harder to believe than criticism?</p>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <div className="landing-shell">
      <header className="lp-header">
        <span className="lp-logo">kevi</span>
        <nav className="lp-header-nav">
          <a href="#pricing">Pricing</a>
          <Link href="/auth">Sign in</Link>
          <Link href={START} className="lp-btn lp-btn-small">Start free</Link>
        </nav>
      </header>

      <main className="landing">
        <section className="lp-hero">
          <div className="lp-hero-text">
          <h1>Remember every session.<br /><em>Grow between them.</em></h1>
          <p className="lp-lead">
            Kevi records your online therapy session, turns it into a transcript, and gives you a gentle
            summary of what came up — the themes, the breakthroughs, the patterns across weeks — so
            you walk into the next session knowing where you left off.
          </p>
          <div className="lp-cta-row">
            <Link href={START} className="lp-btn">Start free — {FREE_TRIAL_MINUTES} minutes, no card</Link>
          </div>
          <p className="lp-phone-note">Kevi runs on your computer for now — open kevi.online there to start.</p>
          </div>
          <div className="lp-hero-pic"><AnalysisCard /></div>
        </section>

        <section className="lp-section">
          <h2>How it works</h2>
          <ol className="lp-steps">
            <li><strong>Record the call.</strong> Press Record in Kevi when your Zoom or Meet session starts. Both voices are captured.</li>
            <li><strong>Read what came up.</strong> A transcript and a calm summary: topics, key theme, emotions, breakthroughs.</li>
            <li><strong>Carry it forward.</strong> Small practices for the week, and notes to bring to your next session.</li>
          </ol>
        </section>

        <section className="lp-section lp-features">
          <div className="lp-feature">
            <h3>See the patterns</h3>
            <p>One session is a moment. Six are a story. Kevi shows the themes and triggers that keep coming back.</p>
            <PatternsCard />
          </div>
          <div className="lp-feature">
            <h3>Between sessions</h3>
            <p>The work doesn’t stop when the call ends. Keep the practices you agreed on, and jot down what to raise next time.</p>
            <HomeworkCard />
          </div>
        </section>

        <section className="lp-section lp-privacy">
          <h2>Private by design</h2>
          <ul>
            <li>Stored in the EU and encrypted.</li>
            <li>Never sold, never used for advertising.</li>
            <li>Download all your data, or delete your account, in one click.</li>
            <li>Made to be used openly, with your therapist’s knowledge.</li>
          </ul>
        </section>

        <section className="lp-section" id="pricing">
          <h2>Pricing</h2>
          <p className="lp-muted">Start with {FREE_TRIAL_MINUTES} free minutes. Then pick a plan — cancel any time.</p>
          <div className="lp-plans">
            {PLAN_ORDER.map(id => {
              const p = PLANS[id];
              return (
                <div key={id} className="lp-card lp-plan">
                  <div className="lp-plan-name">{p.name}</div>
                  <div className="lp-plan-price">€{p.priceEur}<span>/month</span></div>
                  <div className="lp-plan-sessions">{p.sessions} sessions a month</div>
                </div>
              );
            })}
          </div>
          <p className="lp-muted lp-small">Prices include VAT where applicable. A session is about an hour, with its summary.</p>
        </section>

        <section className="lp-section">
          <h2>Questions</h2>
          <div className="lp-faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-final">
          <h2>Your next session starts where the last one ended.</h2>
          <Link href={START} className="lp-btn">Start free</Link>
          <p className="lp-phone-note">Open kevi.online on your computer to start.</p>
        </section>
      </main>

      <footer className="legal-footer">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <a href="mailto:hi@kevi.online">hi@kevi.online</a>
      </footer>
    </div>
  );
}
