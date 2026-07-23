// Root layout for the whole Next.js App Router site. Every page (in this
// demo, just app/page.tsx) is rendered inside this <html>/<body> shell, and
// it pulls in the single global stylesheet (globals.css) that all the
// components below rely on for their CSS variables (colors, panel style,
// etc). The `metadata` export controls the page's <title> and meta
// description used for browser tabs / link previews.
import "./globals.css";

export const metadata = {
  title: "Guarded Agent Commerce",
  description: "Terminal 3 x Circle demo -- an AI agent's real USDC spend, enforced by a TEE-sealed policy",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
