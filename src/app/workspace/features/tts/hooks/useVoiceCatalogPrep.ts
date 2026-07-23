import { useCallback, useEffect, useState } from 'react';
import { STATIC_VOICE_CATALOG, type VoiceCatalog } from '@/lib/voiceCatalog';
import {
  prepareVoiceCatalog,
  type CapCutPrepDiag,
} from '@/lib/voiceCatalogPrep';

export type VoicePrepMeta = {
  sources: string[];
  total: number;
  loading: boolean;
  error?: string;
};

export function useVoiceCatalogPrep(isOpen: boolean) {
  const [dynamicVoices, setDynamicVoices] = useState<VoiceCatalog>(() => ({
    ...STATIC_VOICE_CATALOG,
  }));
  const [capcutDiag, setCapcutDiag] = useState<CapCutPrepDiag | null>(null);
  const [prepMeta, setPrepMeta] = useState<VoicePrepMeta>({
    sources: ['static'],
    total: 0,
    loading: false,
  });

  const runVoicePrep = useCallback(async (forceRefresh = false) => {
    setPrepMeta((m) => ({ ...m, loading: true, error: undefined }));
    try {
      const result = await prepareVoiceCatalog({ forceRefresh });
      const catalog =
        result.catalog && Object.keys(result.catalog).length > 0
          ? result.catalog
          : STATIC_VOICE_CATALOG;
      setDynamicVoices(catalog);
      setCapcutDiag(result.capcut ?? null);
      const total = Object.values(result.counts || {}).reduce((a, b) => a + b, 0);
      setPrepMeta({
        sources: result.sources?.length ? result.sources : ['static'],
        total,
        loading: false,
        error: result.ok ? undefined : result.error,
      });
      console.info(
        `[TTS Voices Prep UI] sources=${(result.sources || []).join('+')} total=${total}`,
        result.counts,
        result.capcut ? `capcut=${result.capcut.ok ? 'ok' : 'fail'}` : '',
      );
    } catch (err) {
      console.error('[TTS Voices Prep UI] failed', err);
      setDynamicVoices(STATIC_VOICE_CATALOG);
      setCapcutDiag(null);
      setPrepMeta((m) => ({
        ...m,
        loading: false,
        sources: ['static'],
        error: err instanceof Error ? err.message : String(err),
      }));
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
    capcutDiag,
    runVoicePrep,
  };
}
