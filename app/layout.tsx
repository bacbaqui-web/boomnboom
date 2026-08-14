import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bubble-boom-arcade.bacbaqui2.chatgpt.site"),
  title: "BOOMnBOOM — 1초 틱 폭탄 대전",
  description: "매초 모든 플레이어와 AI가 동시에 움직이는 실시간 폭탄 수싸움",
  openGraph: { title: "BOOMnBOOM", description: "똑, 딱. 다음 한 수를 먼저 정하세요.", images: ["/og-tick.png"] },
  twitter: { card: "summary_large_image", title: "BOOMnBOOM", description: "똑, 딱. 다음 한 수를 먼저 정하세요.", images: ["/og-tick.png"] },
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
