import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mój chatbot",
  description: "Mój pierwszy chatbot na kursie LABA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body style={{ background: "#f5f7fb", color: "#172033", colorScheme: "light" }}>
        {children}
      </body>
    </html>
  );
}
