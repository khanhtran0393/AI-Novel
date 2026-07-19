import { API } from '@/contracts';
import type { NavGatewayAction } from './navPythonBridge';

export type { NavGatewayAction };

export interface NavGatewayClientResponse<T = unknown> {
  success: boolean;
  error?: string;
  result?: T;
  formatted?: string;
  scenes?: unknown[];
  data?: unknown;
  output_path?: string;
  [key: string]: unknown;
}

export async function callNavApi<T = unknown>(
  action: NavGatewayAction,
  payload: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<NavGatewayClientResponse<T>> {
  const res = await fetch(API.navtools.gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload, timeoutMs }),
  });
  const data = (await res.json().catch(() => ({}))) as NavGatewayClientResponse<T>;
  if (!res.ok && data.success !== false) {
    return { success: false, error: data.error || `HTTP ${res.status}` };
  }
  return data;
}

export async function getNavPresets() {
  return callNavApi('list_presets');
}

export async function getNavCapabilities() {
  return callNavApi('capabilities', {}, 30_000);
}

export async function runScript2Prompt(payload: {
  text: string;
  model: string;
  num_scenes?: number;
  style_preset?: string;
  gemini_api_key?: string;
  auto_detect_scenes?: boolean;
}) {
  return callNavApi('script2prompt', payload, 600_000);
}

export async function runStoryboard(payload: {
  idea: string;
  model: string;
  num_scenes?: number;
  style?: string;
  gemini_api_key?: string;
}) {
  return callNavApi('storyboard', payload, 300_000);
}

export async function runYoutubeAnalyze(payload: {
  url: string;
  model: string;
  gemini_api_key?: string;
}) {
  return callNavApi('youtube_analyze', payload, 900_000);
}

export async function runYoutubeSeo(payload: {
  text: string;
  model: string;
  novel_title?: string;
  gemini_api_key?: string;
}) {
  return callNavApi('youtube_seo', payload, 120_000);
}

export async function runColorGrade(payload: {
  video_path: string;
  output_path?: string;
  preset: string;
}) {
  return callNavApi('color_grade', payload, 600_000);
}

export async function runDelogo(payload: { video_path: string; output_path?: string }) {
  return callNavApi('delogo', payload, 300_000);
}

export async function runExtractFrames(payload: {
  video_path: string;
  output_dir?: string;
  mode?: string;
  value?: number;
  format?: string;
}) {
  return callNavApi('extract_frames', payload, 600_000);
}

export async function runMakeGif(payload: {
  video_path: string;
  output_path?: string;
  start?: number;
  duration?: number;
  width?: number;
  fps?: number;
}) {
  return callNavApi('make_gif', payload, 300_000);
}

export async function runConcatVideos(payload: {
  input_paths: string[];
  output_path?: string;
  re_encode?: boolean;
}) {
  return callNavApi('concat_videos', payload, 900_000);
}

export async function runResizeVideo(payload: {
  video_path: string;
  output_path?: string;
  ratio: string;
  alignment: 'fit' | 'fill';
}) {
  return callNavApi('resize_video', payload, 600_000);
}

export async function runComposeTimeline(payload: {
  clips: Array<Record<string, unknown>>;
  output_path?: string;
}) {
  return callNavApi('compose_timeline', payload, 900_000);
}

export async function runSchedulerList() {
  return callNavApi('scheduler_list', {}, 30_000);
}

export async function runSchedulerSave(job: Record<string, unknown>) {
  return callNavApi('scheduler_save', job, 30_000);
}

export async function runSchedulerDelete(id: string) {
  return callNavApi('scheduler_delete', { id }, 30_000);
}

export async function runProbeVideo(video_path: string) {
  return callNavApi('probe_video', { video_path }, 60_000);
}

export async function runFlowStatus(cookie?: string) {
  return callNavApi('flow_status', { cookie: cookie || '' }, 30_000);
}
