import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AR Management — Critter Stop",
  description: "Accounts Receivable Management",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body>{children}</body>
    </html>
  );
}
