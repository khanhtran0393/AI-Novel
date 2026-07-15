import { NextResponse } from 'next/server';
import { getStatus } from '@/lib/novel-engine/engine';
import { listChapters, loadProgress, getEngineRoot } from '@/lib/novel-engine/store/diskStore';
import { getRunnerMeta } from '@/lib/novel-engine/runner';
import { resolveRulesForProject, checkChapterAgainstRules } from '@/lib/novel-engine/rules/checker';
import { loadProjectContext } from '@/lib/novel-engine/projectContext';
import { buildCapabilitiesReport } from '@/lib/novel-engine/capabilities';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Diag read-only (CLI discipline): chỉ quan sát, không tự sửa.
 */
export async function GET() {
  const engine = getStatus();
  const progress = loadProgress();
  const chapters = listChapters();
  const ctx = loadProjectContext();
  const rules = resolveRulesForProject(ctx.userRules);
  const findings = chapters.flatMap((c) =>
    checkChapterAgainstRules(c.content, rules).map((f) => ({
      chapter: c.id,
      ...f,
    })),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    root: getEngineRoot(),
    runner: getRunnerMeta(),
    progress,
    chapterCount: chapters.length,
    completed: progress?.completedChapters || [],
    engineDiagnostics: engine.diagnostics,
    ruleFindings: findings.slice(0, 50),
    capabilities: buildCapabilitiesReport(),
    note: 'Diag read-only — không auto-fix (kỷ luật ainovel-cli).',
  };

  // Ghi file diag (overwrite) giống CLI meta/diag-export.md
  try {
    const md = [
      '# AI Novel Engine Diag Export',
      '',
      `Generated: ${report.generatedAt}`,
      `Runner: ${report.runner.status} · ${report.runner.lastAction}`,
      `Chapters on disk: ${report.chapterCount}`,
      `Completed: ${(report.completed || []).join(', ') || '—'}`,
      '',
      '## Rule findings',
      ...(findings.length
        ? findings.slice(0, 30).map((f) => `- ch${f.chapter} [${f.severity}] ${f.rule}: ${f.message}`)
        : ['- (none)']),
      '',
      '## Engine diagnostics',
      ...(engine.diagnostics.length
        ? engine.diagnostics.map((d) => `- [${d.severity}] ${d.rule}: ${d.message}`)
        : ['- (none)']),
      '',
      '## Independence',
      '- dependsOnAinovelGui: false',
      '- dependsOnPort8080: false',
      `- capcutTts: ${report.capabilities.media.capcutTts.available ? 'installed' : 'unavailable (no auto Edge fallback)'}`,
      `- pythonCore: ${report.capabilities.nav.pythonCoreGateway}`,
    ].join('\n');

    const out = path.join(getEngineRoot(), 'meta', 'diag-export.md');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md, 'utf8');
  } catch {
    // non-fatal
  }

  return NextResponse.json(report);
}
