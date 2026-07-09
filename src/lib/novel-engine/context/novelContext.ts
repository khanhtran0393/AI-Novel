/**
 * Novel context pack — thống nhất lorebook / scroll summary / short-term.
 */
import { loadProjectContext, type ProjectContext } from '../projectContext';
import { listChapters, loadChapter } from '../store/diskStore';
import { resolveRulesForProject } from '../rules/checker';
import { type NovelRules } from '../rules/defaultRules';

export interface NovelContextPack {
  projectName: string;
  chapter: number;
  lorebook: string;
  outline: string;
  scrollSummary: string;
  shortTerm: string[];
  chapterPlan: string;
  recentChaptersDigest: string;
  characterBible: string;
  rules: NovelRules;
  promptBlock: string;
}

export function buildNovelContext(chapterNum: number, ctx?: ProjectContext): NovelContextPack {
  const project = ctx || loadProjectContext();
  const meta = project.danh_sach_chuong.find((c) => c.so_chuong === chapterNum);
  const disk = loadChapter(chapterNum);
  const chapterPlan = disk?.dan_y || meta?.dan_y || '';

  const recent = listChapters()
    .filter((c) => c.id < chapterNum && c.content.trim())
    .slice(-3)
    .map((c) => {
      const snippet = c.content.replace(/\s+/g, ' ').slice(0, 280);
      return `Ch${c.id} ${c.title}: ${snippet}…`;
    });

  const charLines = (project.nhan_vat || []).map((name) => {
    const p = project.nhan_vat_prompts?.[name] as Record<string, string> | undefined;
    const bits = [
      p?.vai_tro,
      p?.gioi_tinh,
      p?.giong_thoai,
      p?.ngoai_hinh?.slice(0, 80),
    ].filter(Boolean);
    return `- ${name}${bits.length ? `: ${bits.join(' · ')}` : ''}`;
  });

  const rules = resolveRulesForProject(project.userRules);

  const promptBlock = [
    `=== LOREBOOK ===\n${project.lorebook || '(trống)'}`,
    `=== DÀN Ý TỔNG ===\n${(project.dan_y_tong_the || '').slice(0, 4000)}`,
    `=== CUỐN CHIẾU ===\n${project.tom_tat_cuon_chieu || '(chưa có)'}`,
    `=== NGẮN HẠN ===\n${(project.tri_nho_ngan_han || []).join('\n') || '(chưa có)'}`,
    `=== DÀN Ý CHƯƠNG ${chapterNum} ===\n${chapterPlan || '(chưa plan)'}`,
    `=== NHÂN VẬT ===\n${charLines.join('\n') || '(chưa có)'}`,
    recent.length ? `=== 3 CHƯƠNG GẦN ===\n${recent.join('\n')}` : '',
    `=== RULES (tự động) ===\n` +
      `words ${rules.chapterWordsMin}-${rules.chapterWordsMax}; ` +
      `forbidden=${rules.forbiddenPhrases.length}; fatigue=${rules.fatigueWords.length}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    projectName: project.ten_tac_pham,
    chapter: chapterNum,
    lorebook: project.lorebook,
    outline: project.dan_y_tong_the,
    scrollSummary: project.tom_tat_cuon_chieu,
    shortTerm: project.tri_nho_ngan_han || [],
    chapterPlan,
    recentChaptersDigest: recent.join('\n'),
    characterBible: charLines.join('\n'),
    rules,
    promptBlock,
  };
}
