import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

/**
 * One family throughout, including the numbers.
 *
 * Atkinson Hyperlegible Next is a legibility typeface, and legibility is the
 * actual brief here: a dispatcher scans a stop list on screen, a driver reads a
 * printed manifest in a van with the engine running. Its letterforms are drawn
 * so that characters people confuse — 1 l I, 0 O, 5 S — stay distinct, which
 * matters when the string is a house number.
 */
const hyperlegible = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hyperlegible",
  display: "swap",
  /*
   * next/font has no fallback metrics for this family, so it logs "Failed to
   * find font override values" on every build and skips the size-adjust
   * optimisation anyway. Turning it off removes a warning that suggests a
   * problem where there is none; the CSS stack in globals.css still provides a
   * real fallback face.
   */
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "RoutePlan",
  description:
    "Paste your delivery addresses, set a depot, and get routes you can hand to drivers. No account needed.",
};

export const viewport: Viewport = {
  themeColor: "#FBFAF7",
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
    <html lang="en" className={hyperlegible.variable}>
      <body>{children}</body>
    </html>
  );
}
