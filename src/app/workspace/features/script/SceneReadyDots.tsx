'use client';

/**
 * Five micro-dots on SceneCard header: Text · TTS · Prompt · Image · Video.
 * Pure store read — no gen actions.
 */
import React, { useMemo } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { evaluateSceneMediaReady } from '@/lib/pipeline';
import type { StationStatus } from '@/lib/pipeline';

function dotClass(status: StationStatus | 'ready' | 'empty' | 'partial'): string {
  if (status === 'ready') return 'bg-emerald-400';
  if (status === 'partial') return 'bg-amber-400';
  return 'bg-zinc-700';
}

export type SceneReadyDotsProps = {
  chapter: number;
  sceneIndex: number;
  sceneText: string;
  className?: string;
};

export default function SceneReadyDots({
  chapter,
  sceneIndex,
  sceneText,
  className = '',
}: SceneReadyDotsProps) {
  const generatedAudioPaths = useNovelStore((s) => s.generatedAudioPaths);
  const generatedPrompts = useNovelStore((s) => s.generatedPrompts);
  const generatedImages = useNovelStore((s) => s.generatedImages);
  const generatedVideos = useNovelStore((s) => s.generatedVideos);

  const ready = useMemo(
    () =>
      evaluateSceneMediaReady(chapter, sceneIndex, sceneText, {
        generatedAudioPaths,
        generatedPrompts,
        generatedImages,
        generatedVideos,
      }),
    [
      chapter,
      sceneIndex,
      sceneText,
      generatedAudioPaths,
      generatedPrompts,
      generatedImages,
      generatedVideos,
    ],
  );

  const textSt: StationStatus = ready.hasText ? 'ready' : 'empty';
  const ttsSt: StationStatus = ready.hasTts ? 'ready' : 'empty';
  const promptSt: StationStatus =
    ready.promptCount <= 0
      ? 'empty'
      : ready.promptsWithImageText >= ready.promptCount
        ? 'ready'
        : 'partial';
  const imageSt: StationStatus =
    ready.promptCount <= 0
      ? 'empty'
      : ready.imageDone >= ready.promptCount
        ? 'ready'
        : ready.imageDone > 0
          ? 'partial'
          : 'empty';
  const videoSt: StationStatus =
    ready.promptCount <= 0
      ? 'empty'
      : ready.videoDone >= ready.promptCount
        ? 'ready'
        : ready.videoDone > 0
          ? 'partial'
          : 'empty';

  const tip = [
    `Chữ: ${ready.hasText ? 'có' : 'trống'}`,
    `TTS: ${ready.hasTts ? `${ready.ttsDurationSec.toFixed(1)}s` : 'chưa'}`,
    `Prompt: ${ready.promptsWithImageText}/${Math.max(ready.promptCount, 0)}`,
    `Ảnh: ${ready.imageDone}/${Math.max(ready.promptCount, 0)}`,
    `Video: ${ready.videoDone}/${Math.max(ready.promptCount, 0)}`,
  ].join(' · ');

  const items: { key: string; st: StationStatus; label: string }[] = [
    { key: 't', st: textSt, label: 'Chữ' },
    { key: 'a', st: ttsSt, label: 'TTS' },
    { key: 'p', st: promptSt, label: 'Prompt' },
    { key: 'i', st: imageSt, label: 'Ảnh' },
    { key: 'v', st: videoSt, label: 'Video' },
  ];

  return (
    <span
      className={`inline-flex items-center gap-0.5 pointer-events-none ${className}`}
      title={tip}
      aria-label={tip}
    >
      {items.map((it) => (
        <span
          key={it.key}
          className={`h-1.5 w-1.5 rounded-full ${dotClass(it.st)}`}
          title={it.label}
        />
      ))}
    </span>
  );
}
