import { NextResponse } from 'next/server';
import { listChapters, loadProgress } from '@/lib/novel-engine/store/diskStore';
import { loadProjectContext } from '@/lib/novel-engine/projectContext';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Xuất toàn bộ chương engine ra Markdown (client tải file).
 */
export async function GET() {
  const ctx = loadProjectContext();
  const progress = loadProgress();
  const chapters = listChapters().filter((c) => c.content.trim());

  if (chapters.length === 0) {
    // IRON B10: không xuất workspace outline thay engine commit
    return NextResponse.json(
      {
        error:
          'Chưa có chương engine đã commit để tải. Không fallback nội dung workspace/outline. Chạy AI Novel writer/commit trước.',
      },
      { status: 404 },
    );
  }

  const md = buildMarkdown(
    progress?.projectName || ctx.ten_tac_pham,
    chapters.map((c) => ({ id: c.id, title: c.title, content: c.content })),
  );
  return markdownResponse(md, progress?.projectName || ctx.ten_tac_pham);
}

function buildMarkdown(
  title: string,
  chapters: Array<{ id: number; title: string; content: string }>,
): string {
  const lines = [
    `# ${title || 'Untitled'}`,
    '',
    `> Xuất từ AI Novel native engine · ${new Date().toISOString()}`,
    '',
  ];
  for (const c of chapters.sort((a, b) => a.id - b.id)) {
    lines.push(`## Chương ${c.id}: ${c.title}`, '', c.content.trim(), '', '---', '');
  }
  return lines.join('\n');
}

function markdownResponse(md: string, title: string) {
  const safe = (title || 'novel').replace(/[^\w\u00C0-\u024f\-]+/gi, '_').slice(0, 60);
  return new NextResponse(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}_full.md"`,
    },
  });
}
