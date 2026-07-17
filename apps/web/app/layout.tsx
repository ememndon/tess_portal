import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: [
    { path: "../fonts/manrope-latin-ext.woff2", weight: "200 800" },
    { path: "../fonts/manrope-latin.woff2", weight: "200 800" },
  ],
  variable: "--font-disp",
  display: "swap",
});

const inter = localFont({
  src: [
    { path: "../fonts/inter-latin-ext.woff2", weight: "100 900" },
    { path: "../fonts/inter-latin.woff2", weight: "100 900" },
  ],
  variable: "--font-body",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [
    { path: "../fonts/jetbrains-mono-latin-ext.woff2", weight: "100 800" },
    { path: "../fonts/jetbrains-mono-latin.woff2", weight: "100 800" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Tess Portal",
    template: "%s · Tess Portal",
  },
  description: "Your job search, run with Tess.",
  robots: { index: false, follow: false },
};

const themeInit = `(function(){try{if(localStorage.getItem("tessportal-theme")==="light"){document.documentElement.setAttribute("data-theme","light")}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // the strict CSP nonce, minted per request in proxy.ts, so the inline
  // theme-init script is allowed without weakening the policy
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${manrope.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
