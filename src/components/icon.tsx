import type { CSSProperties } from "react";
export type IconName = "settings" | "sound" | "muted" | "history" | "clipboard" | "send" | "close" | "chevron" | "sparkles" | "whale" | "check" | "external" | "reset" | "heart" | "key";
const paths: Record<Exclude<IconName, "whale">, React.ReactNode> = {
  settings: <><path d="m9.8 3-.6 2-2 .9-1.9-.5-2 3.3 1.4 1.5v2.5l-1.4 1.5 2 3.3 1.9-.5 2 .9.6 2h3.9l.6-2 2-.9 1.9.5 2-3.3-1.4-1.5v-2.5l1.4-1.5-2-3.3-1.9.5-2-.9-.6-2Z"/><circle cx="11.8" cy="11.8" r="3"/></>,
  sound: <><path d="m11 5-5 4H3v6h3l5 4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  muted: <><path d="m11 5-5 4H3v6h3l5 4Z"/><path d="m16 9 5 6m0-6-5 6"/></>,
  history: <><path d="M4 5v5h5M4.5 9a8 8 0 1 1-.5 6"/><path d="M12 7v5l3 2"/></>,
  clipboard: <><rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="2" width="6" height="5" rx="1"/><path d="M9 11h6m-6 4h6"/></>,
  send: <><path d="m4 4 17 8-17 8 3-8Z"/><path d="M7 12h14"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  chevron: <path d="m8 5 7 7-7 7"/>,
  sparkles: <><path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6Z"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  external: <><path d="M14 3h7v7m0-7L10 14"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
  reset: <><path d="M4 4v6h6"/><path d="M4.8 9a8 8 0 1 1-.2 6"/></>,
  heart: <path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-4 4 0 9 8 15 8-6 12-11 8-15Z"/>,
  key: <><circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-5-5 3-3m0 6 3-3"/></>,
};
export function Icon({ name, size = 20, style, className }: { name: IconName; size?: number; style?: CSSProperties; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={name === "whale" ? "currentColor" : "none"} stroke={name === "whale" ? "none" : "currentColor"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style} className={className}>{name === "whale" ? <><path d="M3 12c.3 6 5.2 9 11 7.3 5-1.4 7-5.3 6-9.3 1.4-.5 2.5-1.4 3-3.3-2.8-.3-4.3.5-5.2 2-3.3-3.8-9.7-3.8-12.5 1-.4-2.3-1.8-3.5-4.2-3.5 0 3.3.5 4.8 1.9 5.8Z"/><circle cx="11" cy="11.5" r=".9" fill="#f9f5eb"/><path d="M10 4c-.5-2 1-3 3-2" fill="none" stroke="currentColor" strokeWidth="1.5"/></> : paths[name]}</svg>;
}
