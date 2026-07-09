/**
 * Flow Router — port thuần từ ainovel-cli internal/host/flow/router.go
 * Hàm pure: State → Instruction | null. Không I/O.
 */
import {
  type Instruction,
  type RouteState,
  nextChapter,
} from '../domain';

/**
 * Ưu tiên (loại trừ lẫn nhau, khớp từ trên xuống — mirror Go):
 *  1. Phase=complete        → null
 *  2. Phase!=writing        → null (LLM/architect)
 *  3. PendingRewrites       → writer rewrite/polish
 *  4. Flow=reviewing        → null
 *  5. Flow=steering         → null
 *  6-10. Arc end layered    → editor/architect
 * 11. else                  → writer next chapter
 */
export function route(s: RouteState): Instruction | null {
  const p = s.progress;
  if (!p) return null;

  if (p.phase === 'complete') return null;
  if (p.phase !== 'writing') return null;

  if (p.pendingRewrites.length > 0) {
    const ch = p.pendingRewrites[0];
    const verb = p.flow === 'polishing' ? 'Đánh bóng' : 'Viết lại';
    return {
      agent: 'writer',
      task: `${verb} chương ${ch}`,
      reason: `Hàng đợi PendingRewrites còn ${p.pendingRewrites.length} chương`,
      chapter: ch,
    };
  }

  if (p.flow === 'reviewing') return null;
  if (p.flow === 'steering') return null;

  if (p.layered && s.arcBoundary?.isArcEnd) {
    const b = s.arcBoundary;
    if (!s.hasArcReview) {
      return {
        agent: 'editor',
        task: `Thực hiện đánh giá cấp cung truyện cho tập ${b.volume} cung ${b.arc} (scope=arc)`,
        reason: 'Đánh giá cuối cung truyện chưa hoàn thành',
        chapter: 0,
      };
    }
    if (!s.hasArcSummary) {
      return {
        agent: 'editor',
        task: `Tạo tóm tắt cung ${b.arc} tập ${b.volume} (save_arc_summary)`,
        reason: 'Tóm tắt cung truyện chưa hoàn thành',
        chapter: 0,
      };
    }
    if (b.isVolumeEnd && !s.hasVolumeSummary) {
      return {
        agent: 'editor',
        task: `Tạo tóm tắt tập ${b.volume} (save_volume_summary)`,
        reason: 'Tóm tắt tập chưa hoàn thành',
        chapter: 0,
      };
    }
    if (b.needsExpansion && b.nextArc > 0) {
      return {
        agent: 'architect_long',
        task: `Mở rộng cung ${b.nextArc} tập ${b.nextVolume} (save_foundation type=expand_arc)`,
        reason: 'Skeleton cung truyện tiếp theo cần được mở rộng',
        chapter: 0,
      };
    }
    if (b.needsNewVolume) {
      return {
        agent: 'architect_long',
        task: 'Đánh giá rồi append_volume hoặc complete_book',
        reason: 'Cuối tập cần quyết định thêm tập mới hay kết thúc',
        chapter: 0,
      };
    }
  }

  const next = nextChapter(p);
  if (next <= 0) return null;

  return {
    agent: 'writer',
    task: `Viết chương ${next}`,
    reason: 'Tiếp tục viết chương tiếp theo',
    chapter: next,
  };
}

export function formatHostMessage(i: Instruction): string {
  return (
    `[Host ra lệnh] Bước tiếp theo: gọi subagent(${i.agent}, "${i.task}")\n` +
    `Lý do: ${i.reason}\n` +
    `Đây là lệnh từ tầng luồng — thực thi ngay trong engine native (không phụ thuộc ainovel-gui).`
  );
}
