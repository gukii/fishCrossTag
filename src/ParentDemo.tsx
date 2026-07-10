import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Play, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "./components/ui/button";
import { apiBaseUrl, apiFetch } from "./apiClient";
import { TaggerCompletePayload, TaggerSession } from "./workflow";

function defaultImageUrl() {
  return new URL(`${import.meta.env.BASE_URL}images/default-koi.jpg`, window.location.origin).toString();
}

export default function ParentDemo() {
  const [imageUrl, setImageUrl] = useState(defaultImageUrl);
  const [session, setSession] = useState<TaggerSession | null>(null);
  const [result, setResult] = useState<TaggerCompletePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const taggerUrl = useMemo(() => (session ? `${import.meta.env.BASE_URL}s/${session.id}` : ""), [session]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "fishcross-tagger:complete") return;
      setResult(event.data.payload as TaggerCompletePayload);
      setPolling(false);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!session || result) return;
    setPolling(true);
    const events = new EventSource(`${apiBaseUrl()}/api/sessions/${session.id}/events`);
    events.addEventListener("session.completed", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { result: TaggerCompletePayload };
      setResult(data.result);
      setPolling(false);
      events.close();
    });
    events.addEventListener("session.timeout", () => {
      events.close();
    });
    events.onerror = () => {
      events.close();
    };
    const interval = window.setInterval(() => {
      refreshSession({ quiet: true });
    }, 5000);
    return () => {
      events.close();
      window.clearInterval(interval);
      setPolling(false);
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
          options: {
            allowOneSidedFin: true,
            returnThumbnails: false,
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
            <a className="parent-demo-open" href={taggerUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              New tab
            </a>
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
            <strong>Completed result</strong>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </section>

      <section className="parent-demo-frame-wrap">
        {session ? (
          <iframe className="parent-demo-frame" src={taggerUrl} title="FishCross tagger session" />
        ) : (
          <div className="parent-demo-empty">Create a session to load the tagger here.</div>
        )}
      </section>
    </main>
  );
}
