import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mgo · 鲸鱼娘的云麦当劳",
  description: "推开云麦当劳的门，和正在认真摸鱼的鲸鱼娘聊聊，点一份刚刚好的快乐。DeepSeek × 麦当劳 MCP 开源点餐 Galgame。",
  icons: { icon: "/icon.svg" },
  openGraph: { title: "Mgo · 鲸鱼娘的云麦当劳", description: "今天想吃点什么，客人？一场从柜台开始的云端点餐。", locale: "zh_CN", type: "website" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7efdf" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
