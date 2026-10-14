import { cookies } from "next/headers";
import LogoutButton from "./logout-button";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HR Assistant",
  description: "Рабочее пространство рекрутера",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const hasSession = Boolean((await cookies()).get("hr_session")?.value);
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{hasSession && <LogoutButton />}{children}</body>
    </html>
  );
}
