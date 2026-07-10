import { TaggerCompletePayload } from "./workflow";

const CHANNEL_NAME = "fishcross-tagger-sessions";
const STORAGE_KEY = "fishcross-tagger-complete";

export type SessionCompleteEvent = {
  type: "fishcross-tagger:complete";
  sessionId: string;
  payload: TaggerCompletePayload;
  sentAt: string;
};

export function broadcastSessionComplete(sessionId: string, payload: TaggerCompletePayload) {
  const event: SessionCompleteEvent = {
    type: "fishcross-tagger:complete",
    sessionId,
    payload,
    sentAt: new Date().toISOString(),
  };

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(event);
    channel.close();
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
}

export function subscribeToSessionComplete(onComplete: (event: SessionCompleteEvent) => void) {
  const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
  const handleChannelMessage = (event: MessageEvent) => {
    if (event.data?.type === "fishcross-tagger:complete") {
      onComplete(event.data as SessionCompleteEvent);
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    const parsed = JSON.parse(event.newValue) as SessionCompleteEvent;
    if (parsed.type === "fishcross-tagger:complete") {
      onComplete(parsed);
    }
  };

  channel?.addEventListener("message", handleChannelMessage);
  window.addEventListener("storage", handleStorage);

  return () => {
    channel?.removeEventListener("message", handleChannelMessage);
    channel?.close();
    window.removeEventListener("storage", handleStorage);
  };
}
