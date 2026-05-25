import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Critter Stop AR Management",
  description: "Accounts Receivable Management",
  manifest: "/manifest.json",
  themeColor: "#2C2C2A",
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
        <meta name="theme-color" content="#2C2C2A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CS AR" />
      </head>
      <body>{children}</body>
    </html>
  );
}
