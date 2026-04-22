import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

// Site URL can be overridden at build time via NEXT_PUBLIC_SITE_URL.
// Left unset, canonical/OG URLs use a relative metadataBase so the docs work on
// any host (localhost, App Runner, CloudFront).
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: { template: '%s | ONE IDP Docs', default: 'ONE IDP Docs' },
  description:
    'Documentation for ONE IDP — evaluate, compare, and deploy AWS intelligent document processing pipelines.',
  icons: {
    icon: { url: '/favicon.svg', type: 'image/svg+xml' },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'ONE IDP Docs',
    title: 'ONE IDP Docs',
    description:
      'Evaluate, compare, and deploy AWS intelligent document processing pipelines.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ONE IDP Docs',
    description: 'AWS IDP evaluation platform — docs.',
  },
  robots: { index: true, follow: true },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
