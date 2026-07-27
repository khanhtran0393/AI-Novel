'use client';

import React, { useState } from 'react';
import { Copy } from 'lucide-react';

/** Ô SEO/meta có nút sao chép — dùng trong YouTube Studio */
export default function SeoField({
  label,
  value,
  onChange,
  onBlur,
  rows = 4,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value?.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-w-0 flex flex-col gap-2 rounded-lg border border-zinc-900 bg-zinc-950/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          {label}
        </label>
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={!value?.trim()}
          className="flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border border-zinc-800/80 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans"
          title="Sao chép"
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? 'Đã chép' : 'Sao chép'}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={rows}
        placeholder={placeholder}
        className={`w-full min-h-[6rem] resize-y rounded-lg border border-zinc-800 bg-black/50 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-600/50 placeholder:text-zinc-600 ${
          mono ? 'font-mono text-[12px] leading-relaxed' : 'font-sans leading-relaxed'
        }`}
      />
    </div>
  );
}

export function hasImageCredentials(
  store: {
    apiKey?: string;
    apiKeys?: string[];
    googleStudioCookie?: string;
    googleStudioCookies?: string[];
    openaiApiKey?: string;
    openaiApiKeys?: string[];
    grokApiKey?: string;
    grokApiKeys?: string[];
    imageProvider?: string;
  },
): boolean {
  if (store.imageProvider === 'flow') return true;
  const hasApiKey = !!store.apiKey || (store.apiKeys && store.apiKeys.length > 0);
  const hasCookie =
    !!store.googleStudioCookie ||
    (store.googleStudioCookies && store.googleStudioCookies.length > 0);
  const hasOpenAiKey =
    !!store.openaiApiKey || (store.openaiApiKeys && store.openaiApiKeys.length > 0);
  const hasGrokKey = !!store.grokApiKey || (store.grokApiKeys && store.grokApiKeys.length > 0);
  if (store.imageProvider === 'openai') return !!hasOpenAiKey;
  if (store.imageProvider === 'grok') return !!hasGrokKey;
  return !!(hasApiKey || hasCookie);
}
