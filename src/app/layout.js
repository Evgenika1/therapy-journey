import './globals.css';
import { ThemeProvider } from '@/lib/ThemeContext';
import { AuthProvider } from '@/components/AuthProvider';

export const metadata = {
  title: 'Miru — Therapy Journal',
  description: 'Your private therapy companion',
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
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
