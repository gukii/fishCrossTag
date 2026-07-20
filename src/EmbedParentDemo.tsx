import { useEffect, useMemo, useRef, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "./components/ui/button";
import {
  EMBED_COMPLETE_MESSAGE,
  EMBED_ERROR_MESSAGE,
  EMBED_INIT_MESSAGE,
  EMBED_READY_MESSAGE,
  FishCrossLineEmbedOutgoingMessage,
} from "./embedProtocol";
import { FishCrossLineResultV1 } from "./workflow";

function defaultImageUrl() {
  return new URL(`${import.meta.env.BASE_URL}images/default-koi.jpg`, window.location.origin).toString();
}

function makeNonce() {
  return crypto.randomUUID();
}

export default function EmbedParentDemo() {
  const [nonce, setNonce] = useState(makeNonce);
  const [imageUrl, setImageUrl] = useState(defaultImageUrl);
  const [result, setResult] = useState<FishCrossLineResultV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const embedUrl = useMemo(() => {
    const params = new URLSearchParams({
      parentOrigin: window.location.origin,
      nonce,
    });
    return `${import.meta.env.BASE_URL}embed?${params.toString()}`;
  }, [nonce]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as FishCrossLineEmbedOutgoingMessage | undefined;
      if (!data || data.nonce !== nonce) return;
      if (data.type === EMBED_READY_MESSAGE && started) {
        sendImageToEmbed();
      }
      if (data.type === EMBED_COMPLETE_MESSAGE) {
        setResult(data.result);
        setError(null);
      }
      if (data.type === EMBED_ERROR_MESSAGE) {
        setError(data.error);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [nonce, started, imageUrl]);

  async function sendImageToEmbed() {
    setError(null);
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`Could not fetch image: ${response.status}`);
      const bytes = await response.arrayBuffer();
      const mimeType = response.headers.get("content-type") || "image/jpeg";
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: EMBED_INIT_MESSAGE,
          nonce,
          image: {
            id: `embed-demo-${Date.now()}`,
            name: "embed-demo-koi.jpg",
            mimeType,
            bytes,
          },
        },
        window.location.origin,
        [bytes],
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not send image to embed");
    }
  }

  function startEmbed() {
    setResult(null);
    setError(null);
    setStarted(true);
    setNonce(makeNonce());
  }

  function resetEmbed() {
    setStarted(false);
    setResult(null);
    setError(null);
    setNonce(makeNonce());
  }

  return (
    <main className="parent-demo-shell embed-parent-shell">
      <section className="parent-demo-panel">
        <div>
          <h1>Embedded editor demo</h1>
          <p>Send local image bytes into fishCrossLine with postMessage, then receive the compact KoiTag adapter result.</p>
        </div>
        <label>
          <span>Photo URL</span>
          <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
        </label>
        <div className="parent-demo-actions">
          <Button onClick={startEmbed}>
            <Play size={16} />
            Start embed
          </Button>
          <Button variant="secondary" onClick={resetEmbed}>
            <RotateCcw size={16} />
            Reset
          </Button>
        </div>
        {error && <p className="parent-demo-error">{error}</p>}
        {result && (
          <div className="parent-demo-result">
            <strong>Embed result</strong>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </section>

      <section className="parent-demo-frame-wrap">
        {started ? (
          <iframe ref={iframeRef} className="parent-demo-frame" src={embedUrl} title="FishCrossLine embedded editor" />
        ) : (
          <div className="parent-demo-empty">Start the embed to load the editor.</div>
        )}
      </section>
    </main>
  );
}

