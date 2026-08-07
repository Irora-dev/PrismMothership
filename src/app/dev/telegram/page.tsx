import { notFound } from "next/navigation";
import { TelegramSim } from "./sim";

// /dev/telegram — the Telegram-flow playground. Drives the REAL bot handlers
// (real drafts, real votes, real cards) through a fake group-chat UI, so the
// whole creation flow can be felt end-to-end without touching Telegram.
// Dev-only, same gate as /setup: production serves a 404.
export default function TelegramSimPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TelegramSim />;
}
