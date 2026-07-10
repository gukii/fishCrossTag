import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Play, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "./components/ui/button";
import { apiBaseUrl, apiFetch, setApiBaseUrlOverride } from "./apiClient";
import { subscribeToSessionComplete } from "./sessionEvents";
import { TaggerCompletePayload, TaggerSession } from "./workflow";

function defaultImageUrl() {
  return new URL(`${import.meta.env.BASE_URL}images/default-koi.jpg`, window.location.origin).toString();
}

export default function ParentDemo() {
  const [imageUrl, setImageUrl] = useState(defaultImageUrl);
  const [apiBase, setApiBase] = useState(apiBaseUrl);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [session, setSession] = useState<TaggerSession | null>(null);
  const [result, setResult] = useState<TaggerCompletePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const taggerUrl = useMemo(() => {
    if (!session) return "";
    const params = new URLSearchParams({
      apiBase,
      closeOnComplete: "true",
      parentOrigin: window.location.origin,
    });
    return `${import.meta.env.BASE_URL}s/${session.id}?${params.toString()}`;
  }, [apiBase, session]);

  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
  }, [session?.id]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "fishcross-tagger:complete") return;
      setResult(event.data.payload as TaggerCompletePayload);
      setPolling(false);
    }
    const unsubscribe = subscribeToSessionComplete((event) => {
      if (event.sessionId !== sessionIdRef.current) return;
      setResult(event.payload);
      setPolling(false);
    });
    window.addEventListener("message", handleMessage);
    return () => {
      unsubscribe();
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  useEffect(() => {
    if (!session || result) return;
    setPolling(true);
    let stopped = false;
    let events: EventSource | null = null;
    let reconnectTimer: number | undefined;

    function reconnect() {
      events?.close();
      if (stopped) return;
      reconnectTimer = window.setTimeout(connect, 250);
    }

    function connect() {
      if (stopped || !session) return;
      events = new EventSource(`${apiBaseUrl()}/api/sessions/${session.id}/events`);
      events.addEventListener("session.completed", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as { result: TaggerCompletePayload };
        stopped = true;
        setResult(data.result);
        setPolling(false);
        events?.close();
      });
      events.addEventListener("session.timeout", reconnect);
      events.onerror = reconnect;
    }

    connect();
    const interval = window.setInterval(() => {
      refreshSession({ quiet: true });
    }, 5000);
    return () => {
      stopped = true;
      events?.close();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.clearInterval(interval);
      setPolling(false);
    };
  }, [session?.id, result]);

  useEffect(() => {
    if (!session || result) return;
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        refreshSession({ quiet: true });
      }
    }
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [session?.id, result]);

  async function refreshSession(options: { quiet?: boolean } = {}) {
    if (!session) return;
    if (!options.quiet) setError(null);
    try {
      const nextSession = await apiFetch<TaggerSession>(`/api/sessions/${session.id}`);
      setSession(nextSession);
      if (nextSession.result) {
        setResult(nextSession.result);
        setPolling(false);
      }
    } catch (refreshError) {
      if (!options.quiet) {
        setError(refreshError instanceof Error ? refreshError.message : "Could not refresh session");
      }
    }
  }

  async function createSession() {
    setError(null);
    setResult(null);
    try {
      setApiBaseUrlOverride(apiBase);
      const response = await apiFetch<{ session: TaggerSession; taggerUrl: string }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          image: {
            id: `demo_${Date.now()}`,
            url: imageUrl,
            name: "demo-koi.jpg",
          },
          metadata: {
            source: "parent-demo",
            queueId: "needs-first-pass",
          },
          webhookUrl: webhookUrl.trim() || undefined,
          options: {
            allowOneSidedFin: true,
            returnThumbnails: true,
          },
        }),
      });
      setSession(response.session);
      setPolling(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create session");
    }
  }

  return (
    <main className="parent-demo-shell">
      <section className="parent-demo-panel">
        <div>
          <h1>Parent app session demo</h1>
          <p>Create a tagger session from a photo URL, embed the standalone tagger, then receive the completed result.</p>
        </div>
        <label>
          <span>Photo URL</span>
          <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
        </label>
        <label>
          <span>API URL</span>
          <input
            value={apiBase}
            placeholder="https://your-railway-app.up.railway.app"
            onChange={(event) => {
              setApiBase(event.target.value);
              setApiBaseUrlOverride(event.target.value);
            }}
          />
        </label>
        <label>
          <span>Webhook URL</span>
          <input
            value={webhookUrl}
            placeholder="https://your-parent-app.example/webhooks/fishcross"
            onChange={(event) => setWebhookUrl(event.target.value)}
          />
        </label>
        <div className="parent-demo-actions">
          <Button onClick={createSession}>
            <Play size={16} />
            Create session
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setSession(null);
              setResult(null);
              setError(null);
              setPolling(false);
            }}
          >
            <RotateCcw size={16} />
            Reset
          </Button>
          {session && (
            <Button variant="secondary" onClick={() => refreshSession()}>
              <RefreshCw size={16} />
              Refresh
            </Button>
          )}
          {taggerUrl && (
            <button className="parent-demo-open" type="button" onClick={() => window.open(taggerUrl, "_blank")}>
              <ExternalLink size={16} />
              New tab
            </button>
          )}
        </div>
        {error && <p className="parent-demo-error">{error}</p>}
        {session && (
          <div className="parent-demo-meta">
            <strong>Session</strong>
            <code>{session.id}</code>
            <span>{result ? "Completed" : polling ? "Waiting for completion..." : "Open"}</span>
          </div>
        )}
        {result && (
          <div className="parent-demo-result">
            <strong>Tagged fish</strong>
            <div className="parent-demo-thumbs">
              {result.annotations.map((annotation, index) =>
                annotation.preview ? (
                  <figure key={annotation.fishId}>
                    <img src={annotation.preview.dataUrl} alt={`Tagged fish ${index + 1}`} />
                    <figcaption>{index + 1}</figcaption>
                  </figure>
                ) : null,
              )}
            </div>
            <strong>Completed JSON</strong>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </section>

      <section className="parent-demo-frame-wrap">
        {session && !result ? (
          <iframe className="parent-demo-frame" src={taggerUrl} title="FishCross tagger session" />
        ) : (
          <div className="parent-demo-empty">{result ? "Tagger closed. Result received." : "Create a session to load the tagger here."}</div>
        )}
      </section>
    </main>
  );
}
