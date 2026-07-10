import { useEffect, useState } from "react";
import App from "./App";
import { apiFetch } from "./apiClient";
import { broadcastSessionComplete } from "./sessionEvents";
import { TaggerCompletePayload, TaggerSession as TaggerSessionData } from "./workflow";

type LoadedImage = {
  id: string;
  name: string;
  src: string;
  width: number;
  height: number;
};

function sessionIdFromPath() {
  const path = window.location.pathname.replace(/^\/fishCrossTag/, "");
  return path.split("/").filter(Boolean)[1] ?? "";
}

function sessionParams() {
  return new URLSearchParams(window.location.search);
}

function probeImage(session: TaggerSessionData) {
  return new Promise<LoadedImage>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () =>
      resolve({
        id: session.image.id,
        name: session.image.name ?? session.image.id,
        src: session.image.url,
        width: session.image.width ?? image.naturalWidth,
        height: session.image.height ?? image.naturalHeight,
      });
    image.onerror = () => reject(new Error("Could not load session image"));
    image.src = session.image.url;
  });
}

export default function TaggerSession() {
  const sessionId = sessionIdFromPath();
  const [session, setSession] = useState<TaggerSessionData | null>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "complete" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const nextSession = await apiFetch<TaggerSessionData>(`/api/sessions/${sessionId}`);
        const nextImage = await probeImage(nextSession);
        if (cancelled) return;
        setSession(nextSession);
        setImage(nextImage);
        setStatus("ready");
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load tagger session");
        setStatus("error");
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function completeSession(payload: TaggerCompletePayload) {
    await apiFetch(`/api/sessions/${sessionId}/complete`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    broadcastSessionComplete(sessionId, payload);
    const message = {
      type: "fishcross-tagger:complete",
      sessionId,
      payload,
    };
    const parentOrigin = sessionParams().get("parentOrigin") || "*";
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, parentOrigin);
    }
    if (window.opener) {
      window.opener.postMessage(message, parentOrigin);
    }
    setStatus("complete");
    if (window.opener && sessionParams().get("closeOnComplete") !== "false") {
      window.setTimeout(() => window.close(), 120);
    }
  }

  if (status === "loading") {
    return <main className="session-state">Loading tagger session...</main>;
  }

  if (status === "error" || !session || !image) {
    return <main className="session-state error">{error ?? "Session failed to load."}</main>;
  }

  if (status === "complete") {
    return (
      <main className="session-state">
        <h1>Tagging complete</h1>
        <p>The result was saved to the tagger session.</p>
        {session.returnUrl && <a href={session.returnUrl}>Return</a>}
      </main>
    );
  }

  return <App initialImage={image} sessionId={session.id} sessionMode metadata={session.metadata} onSessionComplete={completeSession} />;
}
