import { FishCrossLineResultV1 } from "./workflow";

export const EMBED_INIT_MESSAGE = "fishcrossline:embed:init";
export const EMBED_READY_MESSAGE = "fishcrossline:embed:ready";
export const EMBED_COMPLETE_MESSAGE = "fishcrossline:embed:complete";
export const EMBED_CANCEL_MESSAGE = "fishcrossline:embed:cancel";
export const EMBED_ERROR_MESSAGE = "fishcrossline:embed:error";

export type FishCrossLineEmbedInitMessage = {
  type: typeof EMBED_INIT_MESSAGE;
  nonce: string;
  image: {
    bytes: ArrayBuffer;
    mimeType: string;
    name?: string;
    id?: string;
  };
};

export type FishCrossLineEmbedReadyMessage = {
  type: typeof EMBED_READY_MESSAGE;
  nonce: string;
};

export type FishCrossLineEmbedCompleteMessage = {
  type: typeof EMBED_COMPLETE_MESSAGE;
  nonce: string;
  result: FishCrossLineResultV1;
};

export type FishCrossLineEmbedCancelMessage = {
  type: typeof EMBED_CANCEL_MESSAGE;
  nonce: string;
};

export type FishCrossLineEmbedErrorMessage = {
  type: typeof EMBED_ERROR_MESSAGE;
  nonce: string;
  error: string;
};

export type FishCrossLineEmbedIncomingMessage = FishCrossLineEmbedInitMessage;

export type FishCrossLineEmbedOutgoingMessage =
  | FishCrossLineEmbedReadyMessage
  | FishCrossLineEmbedCompleteMessage
  | FishCrossLineEmbedCancelMessage
  | FishCrossLineEmbedErrorMessage;

