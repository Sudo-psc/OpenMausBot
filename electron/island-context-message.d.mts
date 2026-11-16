export declare const ISLAND_MESSAGE_LIMITS: Readonly<{
  maxFrames: number; maxFrameBytes: number; maxOmiChars: number; maxPromptChars: number;
}>;

/** An explicit user send uploads recent captured images and quotes external Omi context. */
export declare function prepareIslandMessage(input: {
  text: string;
  frames?: Array<{ dataUrl: string; capturedAt?: number; displayId?: string; hash?: string; app?: string }>;
  omiContext?: string;
  /** What is around the request: the app in front, open window names, the local time, and whether computer control works. */
  surroundings?: { app?: string; windows?: string[]; localTime?: string; computerReady?: boolean };
  request: (route: string, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
}): Promise<string>;
