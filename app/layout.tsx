import localFont from "next/font/local";
import type { Metadata } from "next";
import "./globals.css";

const nunito = localFont({
  src: "./fonts/NunitoSans.ttf", display: "swap", variable: "--font-nunito", weight: "200 900",
});

export const metadata: Metadata = {
  title: "Studio Nova — Twój asystent",
  description: "Studio Nova — asystent do wiadomości klientów, inspiracji i codziennej pracy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('studio-nova-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();` }} /></head>
      <body className={nunito.variable}>
        {children}
      </body>
    </html>
  );
}
