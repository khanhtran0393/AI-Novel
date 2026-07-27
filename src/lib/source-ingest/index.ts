/**
 * Multi-source content ingest (YouTube + Web).
 * SERVER-ONLY for channel fetch (youtubeSource uses child_process).
 * Client-safe helpers: detectSourcePlatform, isLikelySourceUrl (via sourceIngestId).
 */

export type {
  SourceChannel,
  SourceFetchOpts,
  SourceIngestFailCode,
  SourceIngestResult,
  SourcePlatform,
} from './types';
export { MAX_SOURCE_TEXT_CHARS, MAX_WEB_DESC_CHARS, MAX_WEB_HTML_BYTES } from './types';
export { detectSourcePlatform, fetchSourceIngest, fetchMultiSourceIngest, pickChannel, SOURCE_CHANNELS } from './router';
export { assertSafePublicHttpUrl, isYoutubeHost } from './ssrf';
export { extractArticleFromHtml, truncateSourceText, wordCountOf } from './htmlExtract';
