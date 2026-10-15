import type { Metadata } from "next";

import { SITE_NAME } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  // The page's public origin, which the Open Graph image link is resolved
  // against (that link is absolute). Upstream hard-coded its own demo's
  // origin; the Orun build sets NEXT_PUBLIC_SITE_URL to the environment's
  // Worker URL (component.yaml).
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: SITE_NAME,
  description:
    "Augment language model generations with vector based retrieval using the Vercel AI SDK",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
