export type TTSProgressEvent = {
  percent: number;
  current?: number;
  total?: number;
  label?: string;
  multi?: boolean;
};

export type TtsVoiceSegment = {
  speaker: string | null;
  text: string;
  voice: string;
  speed?: number;
  pitch?: number;
  emotion?: string;
};
