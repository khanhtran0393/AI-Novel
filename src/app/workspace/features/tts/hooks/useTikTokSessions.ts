import { useMemo, useState } from 'react';
import { useNovelStore, type TTSConfig } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';
import { autoImportTikTokSessionAction } from '../../../hooks/useCookieActions';

export function useTikTokSessions(config: TTSConfig) {
  const store = useNovelStore();
  const [isFetchingTikTokSession, setIsFetchingTikTokSession] = useState(false);
  const [newTikTokSessionInput, setNewTikTokSessionInput] = useState('');
  const [copiedTikTokIdx, setCopiedTikTokIdx] = useState<number | null>(null);

  const tiktokSessions = useMemo(() => {
    const list = (store.tiktokSessionIds || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const primary = (config.tiktokSessionId || '').trim();
    return primary && !list.includes(primary) ? [primary, ...list] : list;
  }, [config.tiktokSessionId, store.tiktokSessionIds]);

  const isTikTokWithoutSession =
    config.platform === 'tiktok_tts' &&
    !config.tiktokSessionId?.trim() &&
    !(store.tiktokSessionIds || []).some((s) => s?.trim());

  const handleAutoFetchTikTokSession = async () => {
    if (isFetchingTikTokSession) return;
    setIsFetchingTikTokSession(true);
    try {
      const slot = tiktokSessions.length + 1;
      toast.info(
        'Notice',
        '🤖 Hệ thống đang mở Chrome để bạn đăng nhập TikTok.\n\n' +
          `Session dòng #${slot} (profile Chrome riêng — nhiều tài khoản).\n` +
          '1. Đăng nhập TikTok trên cửa sổ Chrome vừa mở\n' +
          '2. Hệ thống tự lấy sessionid và đóng Chrome\n' +
          '3. Session được thêm thành 1 dòng trong danh sách',
      );
      const sessionId = await autoImportTikTokSessionAction(slot);
      store.addTikTokSession(sessionId);
      toast.info('Notice', `🎉 Đã thêm SessionID TikTok (dòng #${slot}) thành công!`);
    } catch (err) {
      toast.info(
        'Notice',
        `❌ Lỗi lấy Session TikTok: ${err instanceof Error ? err.message : String(err)}\n\n` +
          'Bạn có thể copy thủ công cookie sessionid và dán vào ô bên dưới.',
      );
    } finally {
      setIsFetchingTikTokSession(false);
    }
  };

  const handleAddTikTokSessionsFromInput = () => {
    const lines = newTikTokSessionInput
      .split(/\r?\n|[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return;
    lines.forEach((line) => {
      store.addTikTokSession(line);
    });
    setNewTikTokSessionInput('');
  };

  const handleCopyTikTokSession = (sid: string, idx: number) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(sid);
      setCopiedTikTokIdx(idx);
      window.setTimeout(() => setCopiedTikTokIdx(null), 2000);
    }
  };

  const handleSetPrimaryTikTokSession = (sid: string) => {
    store.updateTTSConfig({ tiktokSessionId: sid });
    toast.info('Notice', 'Đã đặt SessionID chính cho TikTok TTS.');
    if (sid.trim() && !(store.tiktokSessionIds || []).includes(sid.trim())) {
      store.addTikTokSession(sid.trim());
    }
  };

  const handleRemoveTikTokRow = (sid: string) => {
    const list = store.tiktokSessionIds || [];
    const idx = list.findIndex((s) => s === sid);
    if (idx >= 0) {
      store.removeTikTokSession(idx);
    }
    if ((config.tiktokSessionId || '').trim() === sid) {
      const next = list.filter((s) => s !== sid);
      store.updateTTSConfig({ tiktokSessionId: next[0] || '' });
    }
  };

  return {
    tiktokSessions,
    isTikTokWithoutSession,
    isFetchingTikTokSession,
    newTikTokSessionInput,
    setNewTikTokSessionInput,
    copiedTikTokIdx,
    handleAutoFetchTikTokSession,
    handleAddTikTokSessionsFromInput,
    handleCopyTikTokSession,
    handleSetPrimaryTikTokSession,
    handleRemoveTikTokRow,
  };
}
