import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bubble-boom-arcade.bacbaqui2.chatgpt.site"),
  title: "BOOMnBOOM — 끝없는 공유 월드 폭탄 대전",
  description: "접속 즉시 하나의 끝없는 월드에서 함께 즐기는 실시간 폭탄 게임",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "BOOMnBOOM",
    description: "매칭 없이 바로 합류하는 끝없는 하나의 월드",
    images: ["/og-world.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "BOOMnBOOM",
    description: "매칭 없이 바로 합류하는 끝없는 하나의 월드",
    images: ["/og-world.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
