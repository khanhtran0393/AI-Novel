export interface TTSOptions {
  voice: string;
  speed: number;
  pitch: number;
  tiktokSessionId: string;
  api_url_vieneu: string;
  apiKeys: string[];
}

export interface TTSProvider {
  name: string;
  supportsNativeSpeed: boolean;
  supportsNativePitch: boolean;
  generate: (
    text: string,
    options: TTSOptions,
  ) => Promise<{
    buffer: Buffer;
    method: string;
    nativeSpeedApplied?: boolean;
    nativePitchApplied?: boolean;
  }>;
}
