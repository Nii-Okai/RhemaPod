import type { Metadata } from "next";
import { Figtree, Newsreader, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/* Fonts self-hosted and preloaded by next/font (README "Assets" → Fonts).
   Weights are exactly what the design uses — nothing extra shipped. */
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-figtree",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-newsreader",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "RhemaPod Admin",
  description:
    "Internal portal for church staff to draft, review and publish sermons.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${newsreader.variable} ${ibmPlexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
