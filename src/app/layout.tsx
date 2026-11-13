import type { Metadata } from "next";
import "./globals.css";
import { DM_Sans, DM_Mono } from "next/font/google";

// fallback + adjustFontFallback guard the build against transient Google Fonts fetch failures
// (which otherwise crash the whole Vercel build with "Cannot read properties of null").
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", fallback: ["system-ui", "-apple-system", "Segoe UI", "Arial", "sans-serif"], adjustFontFallback: false });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-data", display: "swap", fallback: ["ui-monospace", "Menlo", "Consolas", "monospace"], adjustFontFallback: false });
import { Providers } from "@/components/Providers";
import { TopNav } from "@/components/TopNav";
import LightOverlay from "@/components/LightOverlay";
import ShellWrapper from "@/components/ShellWrapper";

export const metadata: Metadata = {
  title: "Critter Stop — The Hub",
  description: "Wildlife Operations Platform",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/favicon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/favicon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="The Hub" />
      </head>
        <body className={`${dmSans.className} ${dmMono.variable}`} style={{ margin: 0, minHeight: '100vh', backgroundImage: 'url(/bg.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundAttachment: 'fixed' }}>
        <LightOverlay />
        <div style={{ position: 'relative', zIndex: 1 }}>
        <Providers>
          <TopNav />
          <ShellWrapper>{children}</ShellWrapper>
        </Providers>
        <script dangerouslySetInnerHTML={{__html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js');
            });
          }
        `}} />
          </div>
      </body>
    </html>
  );
}
