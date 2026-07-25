'use client';

/**
 * LA Studio–style studio panel inside «Cấu Hình Giọng Đọc Toàn Cục».
 * Theme mirrors LA Studio (Catppuccin-ish purple): #1e1e2e / #7c4dff.
 * Engine runs hidden via /api/la-studio/status — UI is the control surface.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNovelStore, type TTSConfig } from '@/store/useNovelStore';
import {
  Loader2,
  Mic2,
  Play,
  Power,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Waves,
} from 'lucide-react';
import { API } from '@/contracts';
import type { VoiceCatalog, VoiceOption } from '@/lib/voiceCatalog';
import { getVoiceList } from '@/lib/voiceCatalog';
import { toast } from '@/lib/toastBus';
import { buildClientApiHeaders } from '../../../modules/apiClient';
import { TTS_PREVIEW_SCENE_TEXT } from '@/lib/tts/previewDefaults';

const THEME = {
  bg: '#1e1e2e',
  surface: '#2a2a3e',
  surfaceAlt: '#35354a',
  accent: '#7c4dff',
  accentLight: '#a27eff',
  text: '#e0e0f0',
  textMuted: '#9090b0',
  danger: '#ef5350',
  success: '#66bb6a',
  warning: '#ffa726',
} as const;

export type LaStudioStudioTabProps = {
  config: TTSConfig;
  updateTTSConfig: (p: Partial<TTSConfig>) => void;
  dynamicVoices: VoiceCatalog;
  isFreeTier: boolean;
  isPreviewing: boolean;
  /** Optional voiceId — nghe thử đúng giọng target (nút ▶ từng hàng) */
  onPreviewVoice: (voiceId?: string) => void | Promise<void>;
  setCastStudioOpen: (v: boolean) => void;
  ensureVoiceCastSeeded: () => void;
};

type StudioMode = 'tts' | 'clone' | 'design';

type HealthState = {
  online?: boolean;
  ready?: boolean;
  ttsLoaded?: boolean | null;
  ttsFamily?: string | null;
  message?: string;
  baseUrl?: string;
};

type FamilyRow = {
  id: string;
  title: string;
  subtitle: string;
  kind: string;
  shipDefault?: boolean;
  sizeHint?: string;
  installed: boolean;
  ready: boolean;
  note: string;
  download?: {
    status?: string;
    progress?: number;
    message?: string;
    bytesReceived?: number;
    bytesTotal?: number;
    error?: string;
  } | null;
};

export default function LaStudioStudioTab(props: LaStudioStudioTabProps) {
  const {
    config,
    updateTTSConfig,
    dynamicVoices,
    isFreeTier,
    isPreviewing,
    onPreviewVoice,
    setCastStudioOpen,
    ensureVoiceCastSeeded,
  } = props;

  const [mode, setMode] = useState<StudioMode>('tts');
  const [health, setHealth] = useState<
    (HealthState & {
      canSynth?: boolean;
      kokoroCliReady?: boolean;
    }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceHint, setVoiceHint] = useState('');
  const [voiceOrigin, setVoiceOrigin] = useState('');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [synthText, setSynthText] = useState(TTS_PREVIEW_SCENE_TEXT);
  const [cloneName, setCloneName] = useState('');
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  /** Durable user clones (saved on disk) — Voice Clone tab */
  const [userClones, setUserClones] = useState<VoiceOption[]>([]);
  const [cloneSamplePlaying, setCloneSamplePlaying] = useState(false);
  const [deletingCloneId, setDeletingCloneId] = useState<string | null>(null);
  const cloneLocalUrlRef = useRef<string | null>(null);
  const [designPrompt, setDesignPrompt] = useState(
    'Giọng nữ miền Nam ấm áp, kể chuyện chậm rãi',
  );
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [familyBusy, setFamilyBusy] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [downloadMsg, setDownloadMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const activeFamily =
    config.laStudioFamily ||
    families.find((f) => f.ready)?.id ||
    'kokoro-vietnamese';

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollFamilies = useCallback(async (familyId?: string) => {
    const url = familyId
      ? `${API.laStudioFamilies}?familyId=${encodeURIComponent(familyId)}`
      : API.laStudioFamilies;
    const fRes = await fetch(url, {
      cache: 'no-store',
      headers: buildClientApiHeaders(),
    });
    const fData = (await fRes.json()) as {
      families?: FamilyRow[];
      error?: string;
      job?: {
        status?: string;
        progress?: number;
        message?: string;
        error?: string;
      } | null;
    };
    if (!fRes.ok) {
      throw new Error(
        fData.error ||
          (fRes.status === 403
            ? 'LA Studio cần Trial/Pro — bấm logo app → Bản quyền để kích hoạt.'
            : `HTTP ${fRes.status}`),
      );
    }
    if (Array.isArray(fData.families)) setFamilies(fData.families);
    if (fData.job) {
      setDownloadPct(Number(fData.job.progress) || 0);
      setDownloadMsg(String(fData.job.message || ''));
      if (fData.job.status === 'done' || fData.job.status === 'error') {
        return fData.job.status;
      }
      return 'running';
    }
    return 'idle';
  }, []);

  /**
   * Sau khi tải / đổi family: quét lại đĩa + API để biết giọng nằm ở đâu.
   * Không hardcode id — chỉ hiện voice thật tìm được.
   */
  const reloadUserClones = useCallback(async () => {
    try {
      const vRes = await fetch(
        `${API.laStudioVoices}?familyId=user-clones&includeClones=1`,
        { cache: 'no-store', headers: buildClientApiHeaders() },
      );
      const vData = (await vRes.json()) as {
        userClones?: Array<{
          id: string;
          name: string;
          previewUrl?: string;
          samplePublicUrl?: string;
          gender?: string;
        }>;
        error?: string;
      };
      if (!vRes.ok) {
        if (vRes.status !== 403) {
          console.warn('[LA Studio] userClones', vData.error || vRes.status);
        }
        return [];
      }
      const list: VoiceOption[] = (vData.userClones || []).map((c) => ({
        id: c.id,
        name: c.name || c.id,
        gender:
          c.gender === 'female' || c.gender === 'male' || c.gender === 'neutral'
            ? c.gender
            : 'neutral',
        previewUrl: c.previewUrl || c.samplePublicUrl,
      }));
      setUserClones(list);
      return list;
    } catch (e) {
      console.warn('[LA Studio] userClones load', e);
      return [];
    }
  }, []);

  const reloadVoicesForFamily = useCallback(async (familyId: string) => {
    const q = familyId
      ? `?familyId=${encodeURIComponent(familyId)}&includeClones=1`
      : '?includeClones=1';
    const vRes = await fetch(`${API.laStudioVoices}${q}`, {
      cache: 'no-store',
      headers: buildClientApiHeaders(),
    });
    const vData = (await vRes.json()) as {
      error?: string;
      voices?: Array<{
        id: string;
        name: string;
        detail?: string;
        source?: string;
        samplePublicUrl?: string;
        previewUrl?: string;
        gender?: string;
      }>;
      userClones?: Array<{
        id: string;
        name: string;
        previewUrl?: string;
        samplePublicUrl?: string;
        gender?: string;
      }>;
      /** only for kokoro-vietnamese — do NOT use as fallback for other families */
      kokoro?: Array<{ id: string; name: string }>;
      howToPreview?: string;
      portableRoot?: string | null;
      familyTitle?: string;
      voiceCount?: number;
      familyId?: string;
    };
    if (!vRes.ok) {
      const msg =
        vData.error ||
        (vRes.status === 403
          ? 'Cần Trial/Pro + token Bản quyền để load giọng LA Studio.'
          : `Load giọng thất bại (HTTP ${vRes.status}).`);
      setVoices([]);
      setVoiceHint(msg);
      setVoiceOrigin('');
      return [];
    }
    const list: VoiceOption[] = [];
    // Strict: only this family's voices — never fall back to Kokoro 14 for VieNeu/etc.
    const rows = Array.isArray(vData.voices) ? vData.voices : [];
    for (const row of rows) {
      if (!row.id || row.id === 'default') continue;
      const isSample =
        row.source === 'sample' || /\(mẫu\)|mẫu/i.test(String(row.name || ''));
      const detail = String(row.detail || '');
      const genderFromRow =
        row.gender === 'female' || row.gender === 'male' || row.gender === 'neutral'
          ? row.gender
          : /female|nữ|nu/i.test(detail + row.id)
            ? 'female'
            : /male|nam/i.test(detail + row.id)
              ? 'male'
              : /mai_|my_|ngoc_|diem_|thuc_|_nu_|vibe_nu|vox_.*f|vieneu_nu/i.test(
                    row.id,
                  )
                ? 'female'
                : /hung_|manh_|phat_|thanh_|tuan_|duc_|_nam_|vibe_nam|vox_.*m|vieneu_nam/i.test(
                      row.id,
                    )
                  ? 'male'
                  : 'neutral';
      const preview =
        row.previewUrl || row.samplePublicUrl || undefined;
      list.push({
        id: row.id,
        name:
          isSample && !/\(mẫu\)/i.test(String(row.name || ''))
            ? `${row.name} (mẫu)`
            : row.name || row.id,
        gender: genderFromRow,
        previewUrl: preview,
      });
    }
    setVoices(list);
    if (Array.isArray(vData.userClones)) {
      setUserClones(
        vData.userClones.map((c) => ({
          id: c.id,
          name: c.name || c.id,
          gender:
            c.gender === 'female' || c.gender === 'male' || c.gender === 'neutral'
              ? c.gender
              : 'neutral',
          previewUrl: c.previewUrl || c.samplePublicUrl,
        })),
      );
    }
    setVoiceHint(
      vData.howToPreview ||
        (list.length
          ? `${list.length} giọng · ${vData.familyTitle || familyId} — bấm ▶ nghe mẫu`
          : `Family «${vData.familyTitle || familyId}» chưa có giọng mẫu.`),
    );
    setVoiceOrigin(
      vData.portableRoot
        ? String(vData.portableRoot)
        : list.length
          ? `family:${familyId}`
          : '',
    );
    // Drop store voice if it doesn't belong to this family (was leftover Kokoro id)
    const cur = String(config.voice || '').trim();
    const platForFamily =
      familyId === 'omnivoice' ? 'omnivoice_local' : 'la_studio';
    if (list.length && cur && !list.some((x) => x.id === cur)) {
      updateTTSConfig({
        platform: platForFamily as TTSConfig['platform'],
        laStudioFamily: familyId,
        voice: list[0].id,
        vinaUseClone: false,
      });
    } else if (
      !list.length &&
      familyId !== 'kokoro-vietnamese' &&
      familyId !== 'omnivoice'
    ) {
      // avoid preview with wrong family's voice id
      updateTTSConfig({
        platform: 'la_studio',
        laStudioFamily: familyId,
        voice: '',
        vinaUseClone: false,
      });
    }
    return list;
  }, [config.voice, updateTTSConfig]);

  const ensureFamily = useCallback(
    async (f: FamilyRow) => {
      // OmniVoice stays in LA Studio env (not listed on Engine dropdown)
      if (f.id === 'omnivoice') {
        setFamilyBusy(f.id);
        try {
          const res = await fetch(API.laStudioFamilies, {
            method: 'POST',
            headers: buildClientApiHeaders(),
            body: JSON.stringify({ familyId: f.id, wait: true }),
          });
          const data = (await res.json()) as {
            switchPlatform?: string;
            switchVoice?: string;
            message?: string;
            error?: string;
          };
          if (!res.ok) {
            throw new Error(
              data.error ||
                data.message ||
                (res.status === 403
                  ? 'Cần Trial/Pro — logo app → Bản quyền.'
                  : `HTTP ${res.status}`),
            );
          }
          const omniVoice = data.switchVoice || 'alloy';
          updateTTSConfig({
            platform: 'omnivoice_local',
            laStudioFamily: 'omnivoice',
            voice: omniVoice,
            language: config.language || 'vi',
            vinaUseClone: false,
          });
          const omniList = getVoiceList(
            dynamicVoices,
            'omnivoice_local',
            config.language || 'vi',
          );
          if (omniList.length) {
            setVoices(omniList);
            setVoiceHint(
              `${omniList.length} giọng OmniVoice — bấm ▶ nghe thử (exclusive GPU · tab LA Studio)`,
            );
            setVoiceOrigin('omnivoice_local catalog');
          } else {
            setVoices([
              { id: 'alloy', name: 'Alloy', gender: 'neutral' },
              { id: 'nova', name: 'Nova', gender: 'female' },
              { id: 'echo', name: 'Echo', gender: 'male' },
              { id: 'shimmer', name: 'Shimmer', gender: 'female' },
            ]);
            setVoiceHint(
              'Preset Omni — chọn giọng rồi Nghe thử (tab LA Studio · không sang Engine).',
            );
            setVoiceOrigin('omnivoice presets');
          }
          void fetch(API.omnivoiceStatus, {
            method: 'POST',
            cache: 'no-store',
          }).catch(() => undefined);
          toast.success(
            'OmniVoice',
            data.message ||
              'OmniVoice sẵn sàng trong tab LA Studio. Chọn giọng Omni và Nghe thử.',
          );
        } catch (e) {
          toast.error('LA Studio', e instanceof Error ? e.message : String(e));
        } finally {
          setFamilyBusy(null);
        }
        return;
      }

      updateTTSConfig({
        platform: 'la_studio',
        laStudioFamily: f.id,
        vinaUseClone: false,
      });

      if (f.ready) {
        setFamilyBusy(f.id);
        setDownloadMsg('Đang bake giọng mẫu trên máy này…');
        try {
          // Ship: await bake so ▶ links resolve before UI shows list
          await fetch(
            `${API.laStudioVoices}?familyId=${encodeURIComponent(f.id)}&ensureSamples=1`,
            { cache: 'no-store', headers: buildClientApiHeaders() },
          );
        } catch {
          /* list still from reload */
        }
        const list = await reloadVoicesForFamily(f.id);
        const withSample = list.filter((v) => v.previewUrl).length;
        setFamilyBusy(null);
        setDownloadMsg('');
        toast.info(
          'LA Studio',
          list.length
            ? `«${f.title}» · ${withSample}/${list.length} giọng có ▶ — tự bake trên máy user`
            : `«${f.title}» chưa có giọng — cần pack Kokoro ship để bake nghe thử`,
        );
        return;
      }

      // Download-on-demand
      setFamilyBusy(f.id);
      setDownloadPct(1);
      setDownloadMsg(`Bắt đầu tải «${f.title}»…`);
      stopPoll();
      try {
        // start without waiting forever on huge packs — poll
        await fetch(API.laStudioFamilies, {
          method: 'POST',
          headers: buildClientApiHeaders(),
          body: JSON.stringify({ familyId: f.id, wait: false }),
        });

        await new Promise<void>((resolve) => {
          let ticks = 0;
          pollRef.current = setInterval(() => {
            void (async () => {
              ticks += 1;
              try {
                const st = await pollFamilies(f.id);
                if (st === 'done') {
                  stopPoll();
                  toast.success('LA Studio', `Đã tải xong «${f.title}»`);
                  resolve();
                } else if (st === 'error') {
                  stopPoll();
                  toast.error('LA Studio', downloadMsg || `Tải «${f.title}» thất bại`);
                  resolve();
                } else if (ticks > 600) {
                  // ~10 min
                  stopPoll();
                  toast.error('LA Studio', 'Timeout tải family (>10 phút)');
                  resolve();
                }
              } catch {
                /* keep polling */
              }
            })();
          }, 1000);
        });

        // Final wait=true for small packs / finish state
        const res = await fetch(API.laStudioFamilies, {
          method: 'POST',
          headers: buildClientApiHeaders(),
          body: JSON.stringify({ familyId: f.id, wait: true }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          message?: string;
          error?: string;
          families?: FamilyRow[];
          synthHint?: string;
        };
        if (!res.ok) {
          throw new Error(
            data.error ||
              data.message ||
              (res.status === 403
                ? 'Cần Trial/Pro — logo app → Bản quyền.'
                : `HTTP ${res.status}`),
          );
        }
        if (Array.isArray(data.families)) setFamilies(data.families);
        // Sau tải: bake mẫu TRÊN MÁY USER (userData) + gắn URL API nghe thử
        setDownloadMsg('Đang tạo file nghe thử trên máy…');
        try {
          await fetch(
            `${API.laStudioVoices}?familyId=${encodeURIComponent(f.id)}&ensureSamples=1`,
            { cache: 'no-store', headers: buildClientApiHeaders() },
          );
        } catch {
          /* continue */
        }
        const list = await reloadVoicesForFamily(f.id);
        const withSample = list.filter((v) => v.previewUrl).length;
        if (data.ok) {
          toast.success(
            'LA Studio',
            list.length
              ? `«${f.title}» sẵn sàng · ${withSample}/${list.length} giọng ▶ nghe thử (tự bake máy này)`
              : data.synthHint ||
                  data.message ||
                  `«${f.title}» đã tải; bake mẫu thất bại — kiểm tra Kokoro ship trong gói app.`,
          );
        } else if (data.error) {
          toast.error('LA Studio', data.error || data.message || 'Tải thất bại');
        }
      } catch (e) {
        toast.error('LA Studio', e instanceof Error ? e.message : String(e));
      } finally {
        stopPoll();
        setFamilyBusy(null);
        setDownloadPct(0);
        setDownloadMsg('');
      }
    },
    [
      config.language,
      downloadMsg,
      dynamicVoices,
      pollFamilies,
      reloadVoicesForFamily,
      stopPoll,
      updateTTSConfig,
    ],
  );

  /**
   * Voice library = ONLY current family list from API/disk.
   * Do NOT merge static catalog (that was why all families showed 14 Kokoro voices).
   */
  const mergedVoices = useMemo(() => {
    const map = new Map<string, VoiceOption>();
    for (const v of voices) {
      if (v.id && v.id !== 'default') map.set(v.id, v);
    }
    // Omni: fill from app Omni catalog when family list empty
    if (map.size === 0 && activeFamily === 'omnivoice') {
      for (const v of getVoiceList(
        dynamicVoices,
        'omnivoice_local',
        config.language || 'vi',
      )) {
        if (v.id && v.id !== 'default') map.set(v.id, v);
      }
    }
    // Kokoro family only: if API empty, allow static catalog as last resort
    if (
      map.size === 0 &&
      (activeFamily === 'kokoro-vietnamese' || !activeFamily)
    ) {
      for (const v of getVoiceList(
        dynamicVoices,
        'la_studio',
        config.language || 'vi',
      )) {
        if (v.id && v.id !== 'default') map.set(v.id, v);
      }
    }
    return [...map.values()];
  }, [voices, dynamicVoices, config.language, activeFamily]);

  const selectedId = (config.voice || '').trim() || 'diem_trinh';

  /**
   * Probe / optional ensure engine.
   * @param ensure — POST spawn+poll (only when offline or user clicks «Engine ẩn»)
   * @param quiet — no toast, light busy (tab open must not re-boot every time)
   */
  const refresh = useCallback(
    async (
      ensure = false,
      opts?: { quiet?: boolean },
    ): Promise<
      | (HealthState & {
          canSynth?: boolean;
          kokoroCliReady?: boolean;
        })
      | null
    > => {
      const quiet = opts?.quiet === true;
      // Quiet probe: only soft busy if we have no health yet
      if (!quiet || !health) setBusy(true);
      try {
        // BẮT BUỘC entitlement header (enforce) — thiếu → 403 «không kết nối được»
        const res = await fetch(API.laStudioStatus, {
          method: ensure ? 'POST' : 'GET',
          headers: buildClientApiHeaders(),
          body: ensure
            ? JSON.stringify({
                spawnApp: true,
                hidden: true,
                // Tab re-open: short poll; user button: full warm
                pollMs: quiet ? 6_000 : 12_000,
              })
            : undefined,
          cache: 'no-store',
        });
        const data = (await res.json().catch(() => ({}))) as HealthState & {
          ttsFamily?: string | null;
          canSynth?: boolean;
          kokoroCliReady?: boolean;
          error?: string;
          spawnError?: string;
          message?: string;
        };

        if (!res.ok) {
          const msg =
            data.error ||
            data.message ||
            (res.status === 403
              ? 'LA Studio (API / Engine ẩn) cần gói Trial hoặc Pro. Bấm logo app → Bản quyền để kích hoạt token.'
              : `Kết nối LA Studio thất bại (HTTP ${res.status}).`);
          setHealth({
            online: false,
            canSynth: false,
            message: msg,
          });
          if (ensure && !quiet) toast.error('LA Studio — không kết nối', msg);
          return { online: false, canSynth: false, message: msg };
        }

        const next = {
          ...data,
          message:
            data.message ||
            (data.online && !data.ttsLoaded
              ? 'API online · model TTS chưa load (vẫn gen Kokoro CLI được nếu pack ship có).'
              : data.message),
        };
        setHealth(next);

        const famId =
          config.laStudioFamily ||
          'kokoro-vietnamese';
        await reloadVoicesForFamily(famId);

        try {
          await pollFamilies();
          if (!config.laStudioFamily) {
            updateTTSConfig({ laStudioFamily: 'kokoro-vietnamese' });
          }
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          if (/Trial|Pro|403|Bản quyền/i.test(m) && ensure && !quiet) {
            toast.error('LA Studio', m);
          }
        }

        // Toast only on explicit user «Engine ẩn» — not every modal open
        if (ensure && !quiet) {
          if (data.canSynth || data.online) {
            toast.success(
              'LA Studio',
              data.message ||
                (data.online
                  ? data.ttsLoaded
                    ? 'API sẵn sàng (model loaded).'
                    : 'API online — model chưa load; Kokoro CLI có thể gen được.'
                  : data.kokoroCliReady
                    ? 'Kokoro CLI sẵn sàng (gen thật)'
                    : 'Engine sẵn sàng'),
            );
          } else {
            toast.error(
              'LA Studio',
              data.spawnError ||
                data.message ||
                'Chưa sẵn sàng. Cài LA Studio + pack Kokoro, hoặc bật Trial/Pro.',
            );
          }
        }
        return next;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setHealth({ online: false, message: msg });
        if (ensure && !quiet) toast.error('LA Studio', msg);
        return { online: false, canSynth: false, message: msg };
      } finally {
        setBusy(false);
      }
    },
    // health only gates busy UI — omit from deps to avoid refresh identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.laStudioFamily, pollFamilies, reloadVoicesForFamily, updateTTSConfig],
  );

  useEffect(() => {
    // Ensure LA Studio env + voice list.
    // omnivoice_local is valid here (Omni family) — do NOT force back to la_studio.
    if (config.platform === 'omnivoice_local') {
      if (!config.laStudioFamily || config.laStudioFamily !== 'omnivoice') {
        updateTTSConfig({ laStudioFamily: 'omnivoice' });
      }
      if (!config.voice) {
        updateTTSConfig({ voice: 'alloy' });
      }
    } else if (config.platform !== 'la_studio') {
      updateTTSConfig({
        platform: 'la_studio',
        language: config.language || 'vi',
        voice:
          config.voice && config.voice !== 'default'
            ? config.voice
            : 'diem_trinh',
        laStudioFamily: config.laStudioFamily || 'kokoro-vietnamese',
        vinaUseClone: false,
      });
    } else if (
      !config.voice ||
      config.voice === 'default' ||
      /model dang load|model đang load/i.test(config.voice)
    ) {
      updateTTSConfig({ voice: 'diem_trinh' });
    }

    // Tab open: GET status only (boot already warmed engine via LaStudioAutoBootstrap).
    // Spawn only if offline — quiet, no toast storm / no full re-boot UI.
    let cancelled = false;
    void (async () => {
      const probe = await refresh(false, { quiet: true });
      if (cancelled) return;
      if (!probe?.canSynth && !probe?.online) {
        await refresh(true, { quiet: true });
      }
      if (cancelled) return;
      await reloadUserClones();
    })();

    return () => {
      cancelled = true;
      stopPoll();
      if (cloneLocalUrlRef.current) {
        URL.revokeObjectURL(cloneLocalUrlRef.current);
        cloneLocalUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode === 'clone') void reloadUserClones();
  }, [mode, reloadUserClones]);

  /** Keep real family voice ids (Trúc Ly, …). Only remap empty/placeholder for Kokoro. */
  const resolvePreviewVoiceId = (id: string) => {
    const raw = String(id || '').trim();
    if (
      !raw ||
      raw === 'default' ||
      /model dang load|model đang load/i.test(raw)
    ) {
      if (activeFamily === 'omnivoice') {
        return mergedVoices[0]?.id || 'alloy';
      }
      if (
        activeFamily === 'kokoro-vietnamese' ||
        !activeFamily
      ) {
        return mergedVoices[0]?.id || 'diem_trinh';
      }
      return mergedVoices[0]?.id || raw;
    }
    return raw;
  };

  const selectVoice = (id: string) => {
    const voiceId = resolvePreviewVoiceId(id);
    const isUserClone = /^lsc_/i.test(voiceId);
    const fam = isUserClone
      ? activeFamily === 'omnivoice'
        ? 'omnivoice'
        : config.laStudioFamily || activeFamily || 'kokoro-vietnamese'
      : activeFamily || config.laStudioFamily || 'kokoro-vietnamese';
    // User clones: Omni family → omnivoice_local (clone:profile); else la_studio API
    const platform = isUserClone
      ? fam === 'omnivoice'
        ? 'omnivoice_local'
        : 'la_studio'
      : fam === 'omnivoice'
        ? 'omnivoice_local'
        : 'la_studio';
    updateTTSConfig({
      platform: platform as TTSConfig['platform'],
      voice: voiceId,
      language: config.language || 'vi',
      laStudioFamily: fam,
      vinaUseClone: false,
    });
  };

  /** Play durable clone sample (ref WAV) without full TTS */
  const playCloneSample = async (voiceId: string, previewUrl?: string) => {
    const url =
      previewUrl ||
      `${API.laStudioSampleAudio}?familyId=user-clones&voiceId=${encodeURIComponent(voiceId)}`;
    setCloneSamplePlaying(true);
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        headers: buildClientApiHeaders(),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      if (blob.size < 400) throw new Error('Mẫu quá ngắn');
      const objUrl = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(objUrl);
        audio.onended = () => {
          URL.revokeObjectURL(objUrl);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(objUrl);
          reject(new Error('play error'));
        };
        void audio.play().catch(reject);
      });
    } catch (e) {
      toast.error(
        'Nghe mẫu',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setCloneSamplePlaying(false);
    }
  };

  /** Preview local File before upload (no server) */
  const playLocalCloneFile = async () => {
    if (!cloneFile) return;
    setCloneSamplePlaying(true);
    try {
      if (cloneLocalUrlRef.current) {
        URL.revokeObjectURL(cloneLocalUrlRef.current);
      }
      const objUrl = URL.createObjectURL(cloneFile);
      cloneLocalUrlRef.current = objUrl;
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(objUrl);
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error('play error'));
        void audio.play().catch(reject);
      });
    } catch (e) {
      toast.error(
        'Nghe file',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setCloneSamplePlaying(false);
    }
  };

  const handleDeleteClone = async (id: string) => {
    setDeletingCloneId(id);
    try {
      const res = await fetch(
        `${API.laStudioVoices}?id=${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: buildClientApiHeaders() },
      );
      const data = (await res.json()) as {
        error?: string;
        userClones?: Array<{
          id: string;
          name: string;
          previewUrl?: string;
          samplePublicUrl?: string;
        }>;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (Array.isArray(data.userClones)) {
        setUserClones(
          data.userClones.map((c) => ({
            id: c.id,
            name: c.name || c.id,
            gender: 'neutral' as const,
            previewUrl: c.previewUrl || c.samplePublicUrl,
          })),
        );
      } else {
        await reloadUserClones();
      }
      if (config.voice === id) {
        updateTTSConfig({ voice: '' });
      }
      toast.success('Voice Clone', `Đã xóa «${id}».`);
    } catch (e) {
      toast.error(
        'Voice Clone',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setDeletingCloneId(null);
    }
  };

  const previewOneVoice = async (id: string) => {
    const voiceId = resolvePreviewVoiceId(id);
    if (isPreviewing) {
      void onPreviewVoice(voiceId);
      setPreviewingId(null);
      return;
    }
    selectVoice(voiceId);
    setPreviewingId(voiceId);

    const row =
      mergedVoices.find((v) => v.id === voiceId) ||
      userClones.find((v) => v.id === voiceId);
    const isUserClone = /^lsc_/i.test(voiceId);
    const family = isUserClone
      ? 'user-clones'
      : activeFamily ||
        useNovelStore.getState().ttsConfig?.laStudioFamily ||
        config.laStudioFamily ||
        'kokoro-vietnamese';
    // Ship-safe: sample-audio resolves data/public/pack + auto-bake when missing
    // User clones: always familyId=user-clones
    const baseQ =
      `familyId=${encodeURIComponent(family)}` +
      `&voiceId=${encodeURIComponent(voiceId.normalize('NFC'))}`;
    const tryUrls = [
      // Prefer bake=1 first when list has no URL (post-download first ▶)
      row?.previewUrl
        ? row.previewUrl
        : `${API.laStudioSampleAudio}?${baseQ}${isUserClone ? '' : '&bake=1'}`,
      `${API.laStudioSampleAudio}?${baseQ}`,
      ...(isUserClone
        ? []
        : [`${API.laStudioSampleAudio}?${baseQ}&bake=1`]),
    ].filter(Boolean) as string[];
    // de-dupe
    const seen = new Set<string>();
    const urls = tryUrls.filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });

    let lastSampleErr = '';
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          cache: 'no-store',
          headers: buildClientApiHeaders(),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          lastSampleErr =
            j?.error ||
            (res.status === 403
              ? 'Cần Trial/Pro để nghe thử LA Studio'
              : `HTTP ${res.status}`);
          continue;
        }
        const ct = res.headers.get('Content-Type') || '';
        if (ct.includes('json')) {
          const j = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          lastSampleErr = j?.error || 'sample JSON response';
          continue;
        }
        const blob = await res.blob();
        if (blob.size < 800) {
          lastSampleErr = `WAV quá ngắn (${blob.size}B)`;
          continue;
        }
        const objUrl = URL.createObjectURL(blob);
        await new Promise<void>((resolve, reject) => {
          const audio = new Audio(objUrl);
          audio.onended = () => {
            URL.revokeObjectURL(objUrl);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(objUrl);
            reject(new Error('play error'));
          };
          void audio.play().catch(reject);
        });
        toast.success(
          'Giọng mẫu',
          `Đã phát «${row?.name || voiceId}»` +
            (family === 'kokoro-vietnamese'
              ? ' (Kokoro-VI)'
              : ' (demo bake trên máy · gen engine family cần model load)'),
        );
        setPreviewingId(null);
        return;
      } catch (e) {
        lastSampleErr = e instanceof Error ? e.message : String(e);
      }
    }

    try {
      // Full TTS path (Kokoro CLI / API) — parent shows toast on error
      if (lastSampleErr) {
        console.warn('[LA Studio ▶] sample path failed:', lastSampleErr);
      }
      await onPreviewVoice(voiceId);
    } finally {
      setPreviewingId(null);
    }
  };

  const handleCloneCreate = async () => {
    if (isFreeTier) {
      toast.error('Gói Free', 'Clone LA Studio cần Trial/Pro.');
      return;
    }
    if (!cloneFile) {
      toast.error('LA Studio', 'Chọn file mẫu WAV/MP3 (3–12s, một giọng).');
      return;
    }
    setCloneBusy(true);
    try {
      const buf = await cloneFile.arrayBuffer();
      const b64 = btoa(
        new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''),
      );
      const name =
        cloneName.trim() ||
        cloneFile.name.replace(/\.[^.]+$/, '') ||
        `clone_${Date.now().toString(36)}`;
      const res = await fetch(API.laStudioVoices, {
        method: 'POST',
        headers: buildClientApiHeaders(),
        body: JSON.stringify({
          name,
          audioBase64: b64,
          language: config.language || 'vi',
          sourceName: cloneFile.name,
          familyId: activeFamily || config.laStudioFamily || '',
          preferOmni: activeFamily === 'omnivoice',
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        voice?: {
          id: string;
          name: string;
          previewUrl?: string;
          samplePublicUrl?: string;
        };
        platform?: string;
        message?: string;
        userClones?: Array<{
          id: string;
          name: string;
          previewUrl?: string;
          samplePublicUrl?: string;
        }>;
        saved?: boolean;
      };
      if (!res.ok || !data.voice?.id) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (Array.isArray(data.userClones)) {
        setUserClones(
          data.userClones.map((c) => ({
            id: c.id,
            name: c.name || c.id,
            gender: 'neutral' as const,
            previewUrl: c.previewUrl || c.samplePublicUrl,
          })),
        );
      } else {
        await reloadUserClones();
      }
      // Select + persist platform for use
      const plat =
        data.platform === 'omnivoice_local'
          ? 'omnivoice_local'
          : 'la_studio';
      updateTTSConfig({
        platform: plat as TTSConfig['platform'],
        voice: data.voice.id,
        language: config.language || 'vi',
        laStudioFamily:
          plat === 'omnivoice_local'
            ? 'omnivoice'
            : config.laStudioFamily || activeFamily || 'kokoro-vietnamese',
        vinaUseClone: false,
      });
      toast.success(
        'Voice Clone',
        data.message ||
          `Đã lưu «${data.voice.name}». Bấm ▶ nghe mẫu hoặc «Nghe thử TTS».`,
      );
      setCloneFile(null);
      setCloneName('');
      if (fileRef.current) fileRef.current.value = '';
      // Stay on clone tab so user can hear sample + use
      void refresh(false);
    } catch (e) {
      toast.error(
        'Voice Clone',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setCloneBusy(false);
    }
  };

  // Trial/Pro only — Free is blocked in modal tab + server tts_premium gate.
  if (isFreeTier) {
    return (
      <div
        className="rounded-xl border p-5 space-y-3"
        style={{
          background: THEME.bg,
          borderColor: 'rgba(124,77,255,0.4)',
          color: THEME.text,
        }}
      >
        <div className="flex items-center gap-2">
          <Waves className="h-5 w-5" style={{ color: THEME.accentLight }} />
          <div className="text-sm font-bold">LA Studio · Trial / Pro</div>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: THEME.textMuted }}>
          Multi-family TTS (Kokoro-VI ship + family tải on-demand) chỉ mở cho{' '}
          <strong style={{ color: THEME.accentLight }}>Trial</strong> và{' '}
          <strong style={{ color: THEME.accentLight }}>Pro</strong>. Gói Free dùng
          tab <strong>Engine</strong> → Edge TTS hoặc Piper.
        </p>
        <p className="text-[11px]" style={{ color: THEME.textMuted }}>
          Nhấp logo AI Novel → Bản quyền → bật Trial 7 ngày hoặc kích hoạt Pro.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        background: THEME.bg,
        borderColor: 'rgba(124,77,255,0.4)',
        color: THEME.text,
      }}
    >
      {/* Header bar — LA Studio chrome */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-3 border-b"
        style={{
          background: THEME.surface,
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'rgba(124,77,255,0.25)' }}
          >
            <Waves className="h-4 w-4" style={{ color: THEME.accentLight }} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-wide">LA Studio</div>
            <div className="text-[10px] truncate" style={{ color: THEME.textMuted }}>
              Multi-family · ship: Kokoro-VI · {activeFamily}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border"
            style={{
              borderColor: health?.canSynth
                ? 'rgba(102,187,106,0.45)'
                : 'rgba(144,144,176,0.35)',
              color: health?.canSynth ? THEME.success : THEME.textMuted,
              background: health?.canSynth
                ? 'rgba(102,187,106,0.12)'
                : 'rgba(0,0,0,0.2)',
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: health?.canSynth
                  ? THEME.success
                  : busy
                    ? THEME.warning
                    : THEME.textMuted,
              }}
            />
            {busy
              ? health?.canSynth || health?.online
                ? 'Đang làm mới…'
                : 'Đang kiểm tra…'
              : health?.canSynth
                ? health.online && health.ttsLoaded
                  ? `API sẵn sàng${health.ttsFamily ? ` · ${health.ttsFamily}` : ''}`
                  : health.kokoroCliReady
                    ? 'Kokoro CLI sẵn sàng (gen thật)'
                    : 'Sẵn sàng'
                : 'Chưa sẵn sàng'}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh(true)}
            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg text-white disabled:opacity-50"
            style={{ background: THEME.accent }}
            title="Bật API + spawn engine ẩn"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Power className="h-3 w-3" />
            )}
            Engine ẩn
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh(false)}
            className="p-1.5 rounded-lg border border-white/10 hover:bg-white/5"
            title="Làm mới trạng thái"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mode tabs */}
      <div
        className="flex border-b"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        {(
          [
            { id: 'tts' as const, label: 'Text-to-Speech', icon: Volume2 },
            { id: 'clone' as const, label: 'Voice Clone', icon: Mic2 },
            { id: 'design' as const, label: 'Voice Design', icon: Sparkles },
          ] as const
        ).map((m) => {
          const Icon = m.icon;
          const on = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors"
              style={{
                background: on ? 'rgba(124,77,255,0.22)' : 'transparent',
                color: on ? THEME.accentLight : THEME.textMuted,
                borderBottom: on
                  ? `2px solid ${THEME.accent}`
                  : '2px solid transparent',
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="truncate">{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* Family strip — not only Kokoro */}
      {families.length > 0 && (
        <div
          className="px-4 py-2 border-b overflow-x-auto"
          style={{ borderColor: 'rgba(255,255,255,0.06)', background: THEME.surface }}
        >
          <div className="flex gap-2 min-w-max">
            {families.map((f) => {
              const on = activeFamily === f.id;
              const dl = f.download;
              const isDl =
                familyBusy === f.id ||
                dl?.status === 'downloading' ||
                dl?.status === 'extracting' ||
                dl?.status === 'queued';
              return (
                <button
                  key={f.id}
                  type="button"
                  disabled={!!familyBusy && familyBusy !== f.id}
                  onClick={() => void ensureFamily(f)}
                  className="text-left rounded-lg border px-2.5 py-1.5 max-w-[200px]"
                  style={{
                    borderColor: on
                      ? 'rgba(124,77,255,0.65)'
                      : 'rgba(255,255,255,0.08)',
                    background: on
                      ? 'rgba(124,77,255,0.22)'
                      : THEME.surfaceAlt,
                  }}
                  title={f.note}
                >
                  <div
                    className="text-[11px] font-bold truncate"
                    style={{ color: THEME.text }}
                  >
                    {f.title}
                    {f.shipDefault ? ' · ship' : ''}
                  </div>
                  <div
                    className="text-[9px] truncate"
                    style={{ color: THEME.textMuted }}
                  >
                    {isDl
                      ? `Tai ${dl?.progress ?? downloadPct}%…`
                      : f.id === 'kokoro-vietnamese' && (f.ready || f.installed)
                        ? '14 giong Kokoro-VI'
                        : f.id === 'omnivoice'
                          ? 'Omni trong tab LA Studio'
                          : f.ready || f.installed
                            ? 'Da cai — list giong rieng'
                            : `Bam de tai (${f.sizeHint || '?'})`}
                  </div>
                </button>
              );
            })}
          </div>
          {familyBusy ? (
            <div className="mt-2">
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.08)' }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(2, downloadPct)}%`,
                    background: THEME.accent,
                  }}
                />
              </div>
              <p className="text-[9px] mt-1" style={{ color: THEME.textMuted }}>
                {downloadMsg || `Dang tai «${familyBusy}»…`}
              </p>
            </div>
          ) : null}
          <p className="text-[9px] mt-1.5" style={{ color: THEME.textMuted }}>
            Tab LA Studio: Kokoro + multi-family + OmniVoice. Tab Engine chọn tay:
            Edge · Piper · CapCut · TikTok · Gemini.
          </p>
        </div>
      )}

      <div className="p-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4">
        {/* Left: voice library (TTS/design) OR saved clones (clone mode) */}
        <div
          className="rounded-xl border p-3 flex flex-col min-h-[220px]"
          style={{
            background: THEME.surface,
            borderColor: 'rgba(255,255,255,0.06)',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: THEME.textMuted }}
            >
              {mode === 'clone'
                ? 'Giọng clone đã lưu'
                : `Voice library · ${activeFamily}`}
            </span>
            <span className="text-[10px]" style={{ color: THEME.textMuted }}>
              {mode === 'clone'
                ? `${userClones.length} giọng`
                : `${mergedVoices.length} giọng`}
            </span>
          </div>
          {mode === 'clone' ? (
            <p
              className="text-[9px] leading-relaxed mb-2 rounded-lg border px-2 py-1.5"
              style={{
                color: THEME.textMuted,
                borderColor: 'rgba(124,77,255,0.25)',
                background: 'rgba(0,0,0,0.2)',
              }}
            >
              Lưu trên máy (data/la-studio/user-clones) — ▶ nghe mẫu · chọn để
              dùng · Nghe thử TTS khi engine sẵn sàng.
            </p>
          ) : (voiceHint || voiceOrigin) ? (
            <p
              className="text-[9px] leading-relaxed mb-2 rounded-lg border px-2 py-1.5"
              style={{
                color: THEME.textMuted,
                borderColor: 'rgba(124,77,255,0.25)',
                background: 'rgba(0,0,0,0.2)',
              }}
              title={voiceOrigin || undefined}
            >
              {voiceHint}
              {voiceOrigin ? (
                <>
                  <br />
                  <span className="font-mono text-[8px] break-all opacity-80">
                    📁 {voiceOrigin}
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
          <div className="flex-1 overflow-y-auto max-h-[280px] space-y-1 pr-1">
            {mode === 'clone' ? (
              userClones.length === 0 ? (
                <div
                  className="text-[11px] space-y-1 py-4 text-center"
                  style={{ color: THEME.textMuted }}
                >
                  <p className="font-semibold" style={{ color: THEME.warning }}>
                    Chưa có giọng clone đã lưu
                  </p>
                  <p>
                    Chọn file WAV/MP3 → đặt tên → «Lưu &amp; tạo giọng clone».
                    Sau đó ▶ nghe mẫu và dùng cho gen TTS.
                  </p>
                </div>
              ) : (
                userClones.map((v) => {
                  const on = selectedId === v.id;
                  const rowBusy =
                    (isPreviewing && previewingId === v.id) ||
                    (cloneSamplePlaying && on);
                  return (
                    <div
                      key={v.id}
                      className="flex items-stretch gap-1 rounded-lg border"
                      style={{
                        background: on
                          ? 'rgba(124,77,255,0.28)'
                          : THEME.surfaceAlt,
                        borderColor: on
                          ? 'rgba(124,77,255,0.55)'
                          : 'transparent',
                        color: THEME.text,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => selectVoice(v.id)}
                        className="min-w-0 flex-1 text-left px-2.5 py-2 text-[12px]"
                        title={`Dùng giọng ${v.name}`}
                      >
                        <div className="font-semibold truncate flex items-center gap-1.5">
                          <span className="truncate">{v.name}</span>
                          <span
                            className="shrink-0 text-[8px] font-bold uppercase px-1 rounded"
                            style={{
                              background: 'rgba(102,187,106,0.35)',
                              color: THEME.success,
                            }}
                          >
                            đã lưu
                          </span>
                        </div>
                        <div
                          className="text-[10px] truncate"
                          style={{ color: THEME.textMuted }}
                        >
                          {v.id}
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={cloneSamplePlaying || isPreviewing}
                        onClick={(e) => {
                          e.stopPropagation();
                          void playCloneSample(v.id, v.previewUrl);
                        }}
                        className="shrink-0 self-center mr-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 hover:bg-white/10 disabled:opacity-50"
                        style={{ color: THEME.accentLight }}
                        title={`Nghe mẫu «${v.name}»`}
                      >
                        {rowBusy && cloneSamplePlaying ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5 fill-current" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={isPreviewing}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectVoice(v.id);
                          void previewOneVoice(v.id);
                        }}
                        className="shrink-0 self-center mr-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 hover:bg-white/10 disabled:opacity-50"
                        style={{ color: THEME.success }}
                        title={`Nghe thử TTS «${v.name}»`}
                      >
                        {isPreviewing && previewingId === v.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={deletingCloneId === v.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteClone(v.id);
                        }}
                        className="shrink-0 self-center mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 hover:bg-red-500/20 disabled:opacity-50"
                        style={{ color: THEME.danger }}
                        title={`Xóa «${v.name}»`}
                      >
                        {deletingCloneId === v.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  );
                })
              )
            ) : mergedVoices.length === 0 ? (
              <div className="space-y-2 text-[11px]" style={{ color: THEME.textMuted }}>
                <p className="font-semibold" style={{ color: THEME.warning }}>
                  Family «{activeFamily}» — 0 giọng (chưa có catalog riêng).
                </p>
                <p>
                  {voiceHint ||
                    'Pack runtime có thể đã cài nhưng thiếu voices_*.json.'}
                </p>
                <button
                  type="button"
                  disabled={!!familyBusy}
                  onClick={() => {
                    const f = families.find((x) => x.id === activeFamily);
                    if (f) void ensureFamily({ ...f, ready: false, installed: false });
                    else
                      void ensureFamily({
                        id: activeFamily,
                        title: activeFamily,
                        subtitle: '',
                        kind: 'api-only',
                        installed: false,
                        ready: false,
                        note: '',
                      });
                  }}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg text-white"
                  style={{ background: THEME.accent }}
                >
                  Tải / bổ sung catalog giọng family này
                </button>
                <ul className="list-disc pl-4 space-y-1 text-[10px]">
                  <li>
                    <strong>Kokoro Vietnamese</strong> — 14 giọng ship sẵn (▶
                    offline)
                  </li>
                  <li>
                    <strong>VieNeu</strong> — cần file{' '}
                    <code className="text-[9px]">voices_v3_turbo.json</code> (bấm
                    tải lại)
                  </li>
                  <li>
                    <strong>OmniVoice</strong> — chọn family Omni (cùng tab LA Studio)
                  </li>
                </ul>
              </div>
            ) : (
              mergedVoices.map((v) => {
                const on =
                  selectedId === v.id ||
                  ((selectedId === 'default' || !selectedId) &&
                    v.id === 'diem_trinh');
                const rowBusy =
                  isPreviewing &&
                  (previewingId === v.id ||
                    (!previewingId && on));
                return (
                  <div
                    key={v.id}
                    className="flex items-stretch gap-1 rounded-lg border"
                    style={{
                      background: on
                        ? 'rgba(124,77,255,0.28)'
                        : THEME.surfaceAlt,
                      borderColor: on
                        ? 'rgba(124,77,255,0.55)'
                        : 'transparent',
                      color: THEME.text,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => selectVoice(v.id)}
                      className="min-w-0 flex-1 text-left px-2.5 py-2 text-[12px] transition-colors"
                      title={`Chọn giọng ${v.name}`}
                    >
                      <div className="font-semibold truncate flex items-center gap-1.5">
                        <span className="truncate">{v.name}</span>
                        {v.previewUrl ? (
                          <span
                            className="shrink-0 text-[8px] font-bold uppercase px-1 rounded"
                            style={{
                              background: 'rgba(124,77,255,0.35)',
                              color: THEME.accentLight,
                            }}
                          >
                            ▶ mẫu
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="text-[10px] truncate"
                        style={{ color: THEME.textMuted }}
                      >
                        {v.id}
                        {v.gender ? ` · ${v.gender}` : ''}
                        {!v.previewUrl ? ' · chưa bake WAV' : ''}
                      </div>
                    </button>
                    <button
                      type="button"
                      disabled={isPreviewing && !rowBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Second click while this row plays = cancel via parent
                        void previewOneVoice(v.id);
                      }}
                      className="shrink-0 self-center mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 hover:bg-white/10 disabled:opacity-50"
                      style={{
                        color: THEME.accentLight,
                        background: rowBusy
                          ? 'rgba(124,77,255,0.35)'
                          : 'transparent',
                      }}
                      title={
                        rowBusy
                          ? `Đang gen «${v.name}» — bấm lại để hủy`
                          : `Nghe thử «${v.name}»`
                      }
                      aria-label={`Nghe thử ${v.name}`}
                    >
                      {rowBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5 fill-current" />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: workspace */}
        <div className="space-y-3 min-w-0">
          {mode === 'tts' && (
            <>
              <label
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: THEME.textMuted }}
              >
                Prompt / kịch bản
              </label>
              <textarea
                value={synthText}
                onChange={(e) => setSynthText(e.target.value)}
                rows={5}
                className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none resize-y"
                style={{
                  background: THEME.surface,
                  borderColor: 'rgba(255,255,255,0.08)',
                  color: THEME.text,
                }}
                placeholder="Nhập text tiếng Việt để tổng hợp…"
              />
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className="text-[10px] font-bold uppercase w-16 shrink-0"
                  style={{ color: THEME.textMuted }}
                >
                  Tốc độ
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={config.speed || 1}
                  onChange={(e) =>
                    updateTTSConfig({ speed: Number(e.target.value) || 1 })
                  }
                  className="flex-1 min-w-[120px] accent-[#7c4dff]"
                />
                <span className="text-[11px] tabular-nums w-10">
                  {(config.speed || 1).toFixed(2)}×
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className="text-[10px] font-bold uppercase w-16 shrink-0"
                  style={{ color: THEME.textMuted }}
                  title="Cao độ (semitone). Lưu trong cấu hình toàn cục · FFmpeg post khi gen TTS"
                >
                  Cao độ
                </label>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={Number.isFinite(Number(config.pitch)) ? Number(config.pitch) : 0}
                  onChange={(e) =>
                    updateTTSConfig({
                      pitch: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="flex-1 min-w-[120px] accent-[#a27eff]"
                />
                <span className="text-[11px] tabular-nums w-10">
                  {(Number(config.pitch) || 0) > 0
                    ? `+${Number(config.pitch) || 0}`
                    : String(Number(config.pitch) || 0)}
                </span>
              </div>
              <p className="text-[9px] leading-relaxed" style={{ color: THEME.textMuted }}>
                <strong>Có — gen TTS dùng đúng config toàn cục.</strong> Lưu platform · family ·
                voice · speed · pitch (persist). Gen cảnh/chương gửi{' '}
                <code className="text-[8px]">ttsConfig</code> → FFmpeg áp cao độ nếu engine không
                native pitch. Đa giọng Role Cast: giọng từng NV + speed/pitch toàn cục (trừ khi NV
                có pitch riêng).
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isPreviewing || !selectedId}
                  onClick={() => {
                    const id =
                      !selectedId || selectedId === 'default'
                        ? 'ngoc_huyen'
                        : selectedId;
                    void previewOneVoice(id);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold text-white disabled:opacity-50"
                  style={{ background: THEME.accent }}
                >
                  {isPreviewing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Nghe thử giọng đã chọn
                </button>
                <button
                  type="button"
                  onClick={() => {
                    ensureVoiceCastSeeded();
                    setCastStudioOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold border border-white/10 hover:bg-white/5"
                >
                  🎭 Phân vai
                </button>
              </div>
            </>
          )}

          {mode === 'clone' && (
            <>
              <p className="text-[11px] leading-relaxed" style={{ color: THEME.textMuted }}>
                Tải mẫu 3–12s (một người, ít nhạc nền) → đặt tên → <strong>Lưu trên máy</strong>{' '}
                + đăng ký engine (LA Studio API / Omni). Sau khi lưu: ▶ nghe mẫu · loa Nghe thử
                TTS · chọn hàng để dùng gen.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.flac"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setCloneFile(f);
                  if (f && !cloneName.trim()) {
                    setCloneName(f.name.replace(/\.[^.]+$/, ''));
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-6 text-[12px] font-semibold hover:bg-white/5"
                style={{
                  borderColor: 'rgba(124,77,255,0.45)',
                  color: THEME.accentLight,
                  background: THEME.surface,
                }}
              >
                <Upload className="h-4 w-4" />
                {cloneFile ? cloneFile.name : 'Chọn file mẫu WAV / MP3'}
              </button>
              <input
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="Tên giọng clone"
                className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none"
                style={{
                  background: THEME.surface,
                  borderColor: 'rgba(255,255,255,0.08)',
                  color: THEME.text,
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!cloneFile || cloneSamplePlaying}
                  onClick={() => void playLocalCloneFile()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold border border-white/10 hover:bg-white/5 disabled:opacity-50"
                  style={{ color: THEME.accentLight }}
                >
                  {cloneSamplePlaying && cloneFile ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Nghe file mẫu
                </button>
                <button
                  type="button"
                  disabled={cloneBusy || !cloneFile}
                  onClick={() => void handleCloneCreate()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold text-white disabled:opacity-50"
                  style={{ background: THEME.accent }}
                >
                  {cloneBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Mic2 className="h-3.5 w-3.5" />
                  )}
                  Lưu &amp; tạo giọng clone
                </button>
              </div>
              {selectedId && /^lsc_/i.test(selectedId) ? (
                <div
                  className="rounded-xl border p-3 space-y-2"
                  style={{
                    borderColor: 'rgba(124,77,255,0.35)',
                    background: 'rgba(124,77,255,0.08)',
                  }}
                >
                  <p className="text-[11px] font-semibold" style={{ color: THEME.text }}>
                    Đang chọn:{' '}
                    {userClones.find((c) => c.id === selectedId)?.name || selectedId}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={cloneSamplePlaying || isPreviewing}
                      onClick={() =>
                        void playCloneSample(
                          selectedId,
                          userClones.find((c) => c.id === selectedId)?.previewUrl,
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold border border-white/10 hover:bg-white/5 disabled:opacity-50"
                      style={{ color: THEME.accentLight }}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Nghe mẫu đã lưu
                    </button>
                    <button
                      type="button"
                      disabled={isPreviewing}
                      onClick={() => void previewOneVoice(selectedId)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold text-white disabled:opacity-50"
                      style={{ background: THEME.success }}
                    >
                      {isPreviewing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5" />
                      )}
                      Nghe thử TTS
                    </button>
                  </div>
                  <p className="text-[9px]" style={{ color: THEME.textMuted }}>
                    Giọng đã gắn vào cấu hình toàn cục — gen cảnh/chương dùng đúng id này.
                    Bấm «Lưu Cấu Hình» ở cuối modal.
                  </p>
                </div>
              ) : null}
            </>
          )}

          {mode === 'design' && (
            <>
              <p className="text-[11px] leading-relaxed" style={{ color: THEME.textMuted }}>
                Mô tả giọng (prompt). Áp dụng khi model LA Studio hỗ trợ voice-design
                (VoxCPM / Omni… đã load). Kết quả gen qua platform la_studio + instruct.
              </p>
              <textarea
                value={designPrompt}
                onChange={(e) => setDesignPrompt(e.target.value)}
                rows={4}
                className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none resize-y"
                style={{
                  background: THEME.surface,
                  borderColor: 'rgba(255,255,255,0.08)',
                  color: THEME.text,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  updateTTSConfig({
                    platform: 'la_studio',
                    voice: selectedId || 'default',
                    // stash design as reference text for future instruct wire
                    vinaReferenceText: designPrompt,
                  });
                  toast.info(
                    'LA Studio',
                    'Đã lưu mô tả design. Load model voice-design trong engine rồi Nghe thử (TTS).',
                  );
                  setMode('tts');
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold text-white"
                style={{ background: THEME.accent }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Dùng mô tả này
              </button>
            </>
          )}

          {health?.kokoroCliReady ? (
            <p className="text-[10px] leading-snug" style={{ color: THEME.success }}>
              Kokoro-VI CLI sẵn sàng — chọn giọng thật (Diễm Trinh / Mai Linh…) rồi «Nghe
              thử» (thường &lt;10s). Không cần chờ load model GUI.
              {!health.online
                ? ' API desktop offline vẫn gen bằng CLI được.'
                : ''}
            </p>
          ) : health?.message && !health.online ? (
            <p className="text-[10px] leading-snug" style={{ color: THEME.warning }}>
              {health.message}
            </p>
          ) : null}
          {!health?.canSynth ? (
            <p className="text-[10px] leading-snug" style={{ color: THEME.warning }}>
              {health?.message ||
                'Chưa sẵn sàng: bấm «Engine ẩn» · cần Trial/Pro + token Bản quyền · pack Kokoro ship.'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
