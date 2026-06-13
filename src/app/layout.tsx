import type { Metadata } from "next";
import "./globals.css";
import { DM_Sans, DM_Mono } from "next/font/google";

const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600"] });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-data" });
import { Providers } from "@/components/Providers";
import { TopNav } from "@/components/TopNav";

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
        <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: 'rgba(255,255,255,0.88)' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
        <Providers>
          <TopNav />
          {children}
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
