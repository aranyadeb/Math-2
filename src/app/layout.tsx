import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./jsxgraph.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Textbook Graphs",
  description: "Ask your maths textbook to show you the mathematics.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Textbook Graphs", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
