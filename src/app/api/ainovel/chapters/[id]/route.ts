import { NextResponse } from 'next/server';
import { loadChapter } from '@/lib/novel-engine/store/diskStore';
import { loadProjectContext } from '@/lib/novel-engine/projectContext';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const params = await Promise.resolve(context.params);
  const id = Number(params.id);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: 'Invalid chapter id' }, { status: 400 });
  }

  const disk = loadChapter(id);
  if (disk) {
    return NextResponse.json({
      id: disk.id,
      title: disk.title,
      content: disk.content,
      dan_y: disk.dan_y,
      status: disk.status,
      wordCount: disk.wordCount,
    });
  }

  const ctx = loadProjectContext();
  const found = ctx.danh_sach_chuong.find((c) => c.so_chuong === id);
  if (found) {
    return NextResponse.json({
      id,
      title: found.tieu_de,
      content: found.noi_dung || '',
      dan_y: found.dan_y || '',
      status: found.noi_dung?.trim() ? 'draft' : 'empty',
    });
  }

  return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
}
