import type { Metadata } from 'next';
import Link from 'next/link';
import localFont from 'next/font/local';
import SiteNav from '@/components/SiteNav';
import './globals.css';

const geistSans = localFont({
  src: './fonts/geist-latin.woff2',
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = localFont({
  src: './fonts/geist-mono-latin.woff2',
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Irishman Narrative Trace Explorer',
  description:
    'Recruiter-facing demo comparing a Knowledge Graph, Narrative Context Graph, and baseline retrieval on The Irishman screenplay.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <div className="site-background" aria-hidden="true">
          <div className="site-orb site-orb-a" />
          <div className="site-orb site-orb-b" />
          <div className="site-grid-glow" />
        </div>
        <div className="site-frame">
          <a href="#main-content" className="skip-link">
            Skip to content
          </a>
          <header className="site-header">
            <div className="site-header-inner">
              <Link href="/" className="site-brand" aria-label="Irishman Narrative Trace Explorer Home">
                <span className="site-brand-mark" aria-hidden="true" />
                <span className="site-brand-copy">
                  <span className="site-brand-title">Irishman Context Graphs</span>
                  <span className="site-brand-subtitle">KG + Narrative Context Graph Explorer</span>
                </span>
              </Link>
              <SiteNav />
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
