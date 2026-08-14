import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bubble-boom-arcade.bacbaqui2.chatgpt.site"),
  title: "Bubble Boom! — 설치 없이 바로 즐기는 폭탄 미로 게임",
  description: "폭탄을 놓고 블록을 터뜨리며 라이벌을 이겨보세요. PC와 모바일에서 바로 플레이!",
  openGraph: { title: "BUBBLE BOOM!", description: "끝없이 펼쳐지는 랜덤 온라인 대전", images: ["/og-endless.png"] },
  twitter: { card: "summary_large_image", title: "BUBBLE BOOM!", description: "끝없이 펼쳐지는 랜덤 온라인 대전", images: ["/og-endless.png"] },
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
