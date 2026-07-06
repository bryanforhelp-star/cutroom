import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "cutroom",
  description: "personal editor for talking-head ugc",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
