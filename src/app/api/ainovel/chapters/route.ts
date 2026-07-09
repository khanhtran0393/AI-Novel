import { NextResponse } from 'next/server';
import { listChapters } from '@/lib/novel-engine/store/diskStore';
import { loadProjectContext } from '@/lib/novel-engine/projectContext';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const disk = listChapters();
  if (disk.length > 0) {
    return NextResponse.json({
      chapters: disk.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        wordCount: c.wordCount,
      })),
    });
  }

  // Fallback: outline chapters from project store (chưa draft)
  const ctx = loadProjectContext();
  const chapters = (ctx.danh_sach_chuong || []).map((c) => ({
    id: c.so_chuong,
    title: c.tieu_de || `Chương ${c.so_chuong}`,
    status: c.noi_dung?.trim() ? 'draft' : 'empty',
    wordCount: 0,
  }));

  return NextResponse.json({ chapters });
}
