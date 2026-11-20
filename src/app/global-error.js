'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Last-resort screen when the root layout itself fails. Reports the error and
// offers a reload; deliberately plain because nothing from the app may work.
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 480, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
        <p>The error has been reported.</p>
        <button type="button" onClick={() => reset()} style={{ padding: '8px 16px', marginTop: 8 }}>
          Try again
        </button>
      </body>
    </html>
  );
}
