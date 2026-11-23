import './globals.css';
import { ThemeProvider } from '@/lib/ThemeContext';
import { AuthProvider } from '@/components/AuthProvider';
import MobileGate from '@/components/MobileGate';

export const metadata = {
  // Absolute URLs for the share image and links, wherever the build runs.
  metadataBase: new URL('https://www.kevi.online'),
  title: 'Kevi — Session Journal',
  description: 'Remember every therapy session: transcripts and gentle summaries of your online sessions.',
  openGraph: {
    title: 'Kevi — remember every therapy session',
    description: 'Transcripts and gentle summaries of your online therapy sessions. 30 free minutes, no card.',
    type: 'website',
    siteName: 'Kevi',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Fraunces:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Shippori+Mincho:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0 }}>
        <div className="app-shell">
          <ThemeProvider>
            <AuthProvider>
              {children}
            </AuthProvider>
          </ThemeProvider>
        </div>
        <MobileGate />
      </body>
    </html>
  );
}
