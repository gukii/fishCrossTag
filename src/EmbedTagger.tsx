import { useEffect, useMemo, useRef, useState } from "react";
import App from "./App";
import {
  EMBED_CANCEL_MESSAGE,
  EMBED_COMPLETE_MESSAGE,
  EMBED_ERROR_MESSAGE,
  EMBED_INIT_MESSAGE,
  EMBED_READY_MESSAGE,
  FishCrossLineEmbedIncomingMessage,
  FishCrossLineEmbedOutgoingMessage,
} from "./embedProtocol";
import { FishCrossLineResultV1, TaggerCompletePayload } from "./workflow";

type EmbedImage = {
  id?: string;
  name: string;
  src: string;
  width: number;
  height: number;
};

function embedParams() {
  return new URLSearchParams(window.location.search);
}

function parentOrigin() {
  return embedParams().get("parentOrigin") || embedParams().get("origin") || "";
}

function embedNonce() {
  return embedParams().get("nonce") || "";
}

function isAllowedOrigin(origin: string, expectedOrigin: string) {
  if (!expectedOrigin) return origin === window.location.origin;
  return origin === expectedOrigin;
}

function probeEmbedImage(message: FishCrossLineEmbedIncomingMessage) {
  return new Promise<EmbedImage>((resolve, reject) => {
    const blob = new Blob([message.image.bytes], { type: message.image.mimeType });
    if (!blob.type.startsWith("image/")) {
      reject(new Error("Embed image must be an image file"));
      return;
    }

    const src = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      resolve({
        id: message.image.id,
        name: message.image.name || "embedded-koi-image",
        src,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("Could not load embedded image"));
    };
    image.src = src;
  });
}

function resultFromPayload(payload: TaggerCompletePayload, image: EmbedImage): FishCrossLineResultV1 {
  return {
    version: 1,
    imageWidth: image.width,
    imageHeight: image.height,
    tags: payload.annotations
      .filter((annotation) => annotation.rotationDeg != null && annotation.rotationPivot && annotation.cropBox)
      .map((annotation) => ({
        bodyLine: annotation.bodyLine,
        finLine: annotation.finLine,
        rotationDeg: annotation.rotationDeg ?? 0,
        rotationPivot: annotation.rotationPivot!,
        cropBox: annotation.cropBox!,
      })),
  };
}

export default function EmbedTagger() {
  const [image, setImage] = useState<EmbedImage | null>(null);
  const [status, setStatus] = useState<"waiting" | "ready" | "complete" | "error">("waiting");
  const [error, setError] = useState<string | null>(null);
  const expectedOrigin = useMemo(parentOrigin, []);
  const nonce = useMemo(embedNonce, []);
  const sourceWindow = useRef<MessageEventSource | null>(null);
  const sourceOrigin = useRef(expectedOrigin || window.location.origin);
  const objectUrl = useRef<string | null>(null);

  function postToParent(message: FishCrossLineEmbedOutgoingMessage) {
    const targetOrigin = sourceOrigin.current || expectedOrigin || window.location.origin;
    if (sourceWindow.current) {
      sourceWindow.current.postMessage(message, { targetOrigin });
      return;
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, targetOrigin);
      return;
    }
    window.opener?.postMessage(message, targetOrigin);
  }

  useEffect(() => {
    function sendError(nextError: unknown) {
      const message = nextError instanceof Error ? nextError.message : "Embed failed";
      setError(message);
      setStatus("error");
      postToParent({ type: EMBED_ERROR_MESSAGE, nonce, error: message });
    }

    async function handleMessage(event: MessageEvent) {
      if (!isAllowedOrigin(event.origin, expectedOrigin)) return;
      const data = event.data as Partial<FishCrossLineEmbedIncomingMessage> | undefined;
      if (data?.type !== EMBED_INIT_MESSAGE) return;
      if (nonce && data.nonce !== nonce) return;
      if (!data.image?.bytes || !data.image.mimeType) {
        sendError(new Error("Embed init message is missing image bytes"));
        return;
      }

      try {
        sourceWindow.current = event.source;
        sourceOrigin.current = event.origin;
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        const nextImage = await probeEmbedImage(data as FishCrossLineEmbedIncomingMessage);
        objectUrl.current = nextImage.src;
        setImage(nextImage);
        setStatus("ready");
      } catch (nextError) {
        sendError(nextError);
      }
    }

    window.addEventListener("message", handleMessage);
    postToParent({ type: EMBED_READY_MESSAGE, nonce });
    return () => {
      window.removeEventListener("message", handleMessage);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, [expectedOrigin, nonce]);

  async function completeEmbed(payload: TaggerCompletePayload) {
    if (!image) return;
    postToParent({
      type: EMBED_COMPLETE_MESSAGE,
      nonce,
      result: resultFromPayload(payload, image),
    });
    setStatus("complete");
  }

  function cancelEmbed() {
    postToParent({ type: EMBED_CANCEL_MESSAGE, nonce });
    setStatus("complete");
  }

  if (status === "ready" && image) {
    return <App initialImage={image} sessionMode metadata={{ mode: "embed" }} onSessionComplete={completeEmbed} persistLocalSettings={false} />;
  }

  return (
    <main className="embed-state">
      <section>
        <h1>{status === "error" ? "Embed failed" : status === "complete" ? "Tagging complete" : "Waiting for image"}</h1>
        <p>
          {status === "error"
            ? error
            : status === "complete"
              ? "The result was sent back to the parent app."
              : "The parent app will send the photo directly to this editor."}
        </p>
        {status === "waiting" && (
          <button type="button" onClick={cancelEmbed}>
            Cancel
          </button>
        )}
      </section>
    </main>
  );
}
