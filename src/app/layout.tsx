import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Geist, with its mono companion for code.
 *
 * This replaces Atkinson Hyperlegible Next, which was chosen for a legibility
 * brief — a driver reading a printed manifest in a van. Geist is a cleaner fit
 * for the marketing pages and keeps proper tabular figures, which is the part
 * the stop list actually depends on. If the manifest ever proves hard to read
 * in the field, that trade is the first thing to revisit.
 */
const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RoutePlan",
  description:
    "Paste your delivery addresses, set a depot, and get routes you can hand to drivers. No account needed.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  // The map fills the screen; letting it zoom the page under a pinch would
  // fight the map's own gesture handling.
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
