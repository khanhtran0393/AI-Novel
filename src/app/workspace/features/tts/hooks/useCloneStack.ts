import { useCallback, useEffect, useState } from 'react';
import { API } from '@/contracts';
import { toast } from '@/lib/toastBus';

export type CloneProfile = {
  name: string;
  hasSample?: boolean;
  samplePath?: string | null;
  text?: string;
  speaker_seed?: number;
  style_seed?: number;
  pitch_shift?: number;
  filename?: string;
  isUser?: boolean;
  source?: string;
};

export type CloneStatus = {
  profilesCount?: number;
  samplesResolved?: number;
  userCloneFiles?: number;
  ffmpeg?: boolean;
  universalZeroShot?: boolean;
  onnxBrain?: {
    ready?: boolean;
    totalGB?: number;
    modelsDir?: string;
    missing?: string[];
  };
} | null;

export type CloneEngineHealth = {
  online: boolean;
  xtts?: boolean;
  cloneMode?: string;
  message?: string;
  loading?: boolean;
};

export function useCloneStack({
  isOpen,
  voiceUiTab,
  runVoicePrep,
  engineUrl,
}: {
  isOpen: boolean;
  voiceUiTab: 'clone' | 'engine' | 'create';
  runVoicePrep: (forceRefresh?: boolean) => Promise<void>;
  engineUrl?: string;
}) {
  const [cloneProfiles, setCloneProfiles] = useState<CloneProfile[]>([]);
  const [cloneStatus, setCloneStatus] = useState<CloneStatus>(null);
  const [engineHealth, setEngineHealth] = useState<CloneEngineHealth>({
    online: false,
    loading: false,
  });
  const [engineStarting, setEngineStarting] = useState(false);
  const [deletingCloneName, setDeletingCloneName] = useState<string | null>(null);

  const refreshCloneStack = useCallback(async () => {
    setEngineHealth((h) => ({ ...h, loading: true }));
    try {
      const [profRes, stRes] = await Promise.all([
        fetch(API.vinaVoiceProfiles).then((r) => r.json()),
        fetch(API.vinaVoiceStatus).then((r) => r.json()),
      ]);
      if (profRes?.ok && Array.isArray(profRes.profiles)) {
        setCloneProfiles(profRes.profiles);
        setCloneStatus(profRes.status || stRes || null);
      }
      if (stRes?.ok) {
        setCloneStatus((prev) => ({
          ...(prev || {}),
          ...(stRes.onnxBrain
            ? {
                onnxBrain: stRes.onnxBrain,
                universalZeroShot: !!stRes.universalZeroShot,
                ffmpeg: stRes.ffmpeg,
                profilesCount: stRes.profilesCount ?? prev?.profilesCount,
                samplesResolved: stRes.samplesResolved ?? prev?.samplesResolved,
                userCloneFiles: stRes.userCloneFiles ?? prev?.userCloneFiles,
              }
            : prev || {}),
        }));
        setEngineHealth({
          online: !!stRes.engine?.online || !!stRes.onnxBrain?.ready,
          xtts: !!stRes.engine?.xtts_available,
          cloneMode: stRes.cloneMode,
          message: stRes.onnxBrain?.ready
            ? `ONNX brain ${stRes.onnxBrain.totalGB}GB - Universal Zero-Shot`
            : stRes.engine?.online
              ? stRes.readyForTrueTimbre
                ? 'Engine + XTTS - clone timbre'
                : 'Engine online - HTTP phụ'
              : 'Não ONNX thiếu / engine offline',
          loading: false,
        });
      }
    } catch (err) {
      console.error('Failed to load clone stack:', err);
      setEngineHealth((h) => ({ ...h, loading: false, online: false }));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const initial = window.setTimeout(() => {
      void refreshCloneStack();
    }, 0);
    const t = window.setInterval(() => {
      if (document.hidden) return;
      if (voiceUiTab === 'create' || voiceUiTab === 'clone') {
        void refreshCloneStack();
      }
    }, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(t);
    };
  }, [isOpen, voiceUiTab, refreshCloneStack]);

  const startCloneEngine = useCallback(async () => {
    setEngineStarting(true);
    try {
      const res = await fetch(API.vinaVoiceEngineStart, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engineUrl: engineUrl || 'http://127.0.0.1:8765',
        }),
      });
      const data = await res.json().catch(() => ({}));
      await refreshCloneStack();
      void runVoicePrep(true);
      toast.info(
        'Notice',
        data.message ||
          (data.ok
            ? 'Engine đã sẵn sàng.'
            : data.error || 'Không khởi động được engine. Chạy tools/vina_voice_engine/RUN_ENGINE.bat'),
      );
      if (!res.ok || !data.ok) {
        return;
      }
    } catch (e) {
      toast.info('Notice', e instanceof Error ? e.message : String(e));
    } finally {
      setEngineStarting(false);
    }
  }, [engineUrl, refreshCloneStack, runVoicePrep]);

  const deleteCloneProfile = useCallback(
    async (name: string) => {
      const profileName = String(name || '').trim();
      if (!profileName) return false;
      setDeletingCloneName(profileName);
      try {
        const res = await fetch(API.vinaVoiceProfiles, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: profileName }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          toast.info('Notice', data.error || `Không xóa được «${profileName}».`);
          return false;
        }
        if (Array.isArray(data.profiles)) {
          setCloneProfiles(data.profiles);
        } else {
          setCloneProfiles((prev) => prev.filter((p) => p.name !== profileName));
        }
        void runVoicePrep(true);
        toast.info('Notice', `Đã xóa giọng clone «${profileName}».`);
        return true;
      } catch (e) {
        toast.info('Notice', e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setDeletingCloneName(null);
      }
    },
    [runVoicePrep],
  );

  const deleteAllUserClones = useCallback(async () => {
    setDeletingCloneName('__all__');
    try {
      const res = await fetch(API.vinaVoiceProfiles, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allUser: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !(Array.isArray(data.deleted) && data.deleted.length)) {
        toast.info('Notice', data.error || 'Không xóa được USER clone.');
        return false;
      }
      if (Array.isArray(data.profiles)) {
        setCloneProfiles(data.profiles);
      } else {
        await refreshCloneStack();
      }
      void runVoicePrep(true);
      const n = Array.isArray(data.deleted) ? data.deleted.length : 0;
      toast.info('Notice', n ? `Đã xóa ${n} giọng USER clone.` : 'Không còn USER clone.');
      return true;
    } catch (e) {
      toast.info('Notice', e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setDeletingCloneName(null);
    }
  }, [refreshCloneStack, runVoicePrep]);

  return {
    cloneProfiles,
    setCloneProfiles,
    cloneStatus,
    setCloneStatus,
    engineHealth,
    setEngineHealth,
    engineStarting,
    deletingCloneName,
    refreshCloneStack,
    startCloneEngine,
    deleteCloneProfile,
    deleteAllUserClones,
  };
}
