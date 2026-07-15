import { useCallback, useEffect, useState } from 'react';
import {
  STATIC_VOICE_CATALOG,
  type VoiceCatalog,
} from '@/lib/voiceCatalog';
import { prepareVoiceCatalog } from '@/lib/voiceCatalogPrep';

export type VoicePrepMeta = {
  sources: string[];
  total: number;
  loading: boolean;
};

export function useVoiceCatalogPrep(isOpen: boolean) {
  const [dynamicVoices, setDynamicVoices] = useState<VoiceCatalog>(STATIC_VOICE_CATALOG);
  const [prepMeta, setPrepMeta] = useState<VoicePrepMeta>({
    sources: ['static'],
    total: 0,
    loading: false,
  });

  const runVoicePrep = useCallback(async (forceRefresh = false) => {
    setPrepMeta((m) => ({ ...m, loading: true }));
    try {
      const result = await prepareVoiceCatalog({ forceRefresh });
      setDynamicVoices(result.catalog);
      const total = Object.values(result.counts || {}).reduce((a, b) => a + b, 0);
      setPrepMeta({
        sources: result.sources,
        total,
        loading: false,
      });
      console.info(
        `[TTS Voices Prep UI] sources=${result.sources.join('+')} total=${total}`,
        result.counts,
      );
    } catch (err) {
      console.error('[TTS Voices Prep UI] failed', err);
      setPrepMeta((m) => ({ ...m, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      void runVoicePrep(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, runVoicePrep]);

  return {
    dynamicVoices,
    prepMeta,
    runVoicePrep,
  };
}
