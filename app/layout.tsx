import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farmhouse AI Video Generator",
  description: "Create cozy farmhouse-inspired videos from text prompts.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
