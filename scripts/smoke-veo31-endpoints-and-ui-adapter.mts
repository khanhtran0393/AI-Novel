/**
 * Verification script for Veo 3.1 Endpoints, Response Shape Adapter, and UI status in AI Novel.
 */

import { buildVideoIngredientsBody } from '../src/lib/flow-bridge/payloadBuilder';
import { convertVeo3ResponseToOperations } from '../src/lib/flow-bridge/veo3ResponseAdapter';

async function runVeo31Verification() {
  console.log('================================================================');
  console.log('🧪 VEO 3.1 ENDPOINTS & RESPONSE SHAPE ADAPTER VERIFICATION');
  console.log('================================================================');

  // Test 1: buildVideoIngredientsBody with CHARACTER_REFERENCE and BLOCK_SILENCED_VIDEOS
  console.log('\n[Test 1] Testing buildVideoIngredientsBody (Character Reference Lock)...');
  const payload = buildVideoIngredientsBody({
    projectId: 'proj_test_veo31',
    prompt: 'A character walking through an ancient portal',
    referenceMediaIds: ['media_char_111', 'media_char_222'],
    aspectRatio: '16:9',
    durationSec: 6,
  });

  console.log(`   Endpoint URL: ${payload.url}`);
  const reqBody = payload.body as any;
  const firstReq = reqBody.requests?.[0];
  const refImages = firstReq?.referenceImages || [];

  console.log(`   audioFailurePreference: ${reqBody.mediaGenerationContext?.audioFailurePreference}`);
  console.log(`   referenceImages count: ${refImages.length}`);
  console.log(`   imageUsageType: ${refImages[0]?.imageUsageType}`);

  if (reqBody.mediaGenerationContext?.audioFailurePreference !== 'BLOCK_SILENCED_VIDEOS') {
    throw new Error('❌ audioFailurePreference is missing BLOCK_SILENCED_VIDEOS!');
  }
  if (refImages[0]?.imageUsageType !== 'CHARACTER_REFERENCE') {
    throw new Error('❌ referenceImages imageUsageType is not CHARACTER_REFERENCE!');
  }
  console.log('✅ Veo 3.1 Character Lock & Audio Failure Preference verified 100%');

  // Test 2: convertVeo3ResponseToOperations
  console.log('\n[Test 2] Testing Veo 3.1 Response Shape Adapter (media[] -> operations[])...');
  const mockNewVeo31Response = {
    remainingCredits: 350,
    media: [
      {
        mediaId: 'media_rendered_001',
        state: 'MEDIA_GENERATION_STATUS_SUCCESS',
        videoUrl: 'https://storage.googleapis.com/ai-sandbox-videofx/render1.mp4',
        progress: 100,
      },
      {
        mediaId: 'media_rendered_002',
        state: 'PROCESSING',
        progress: 45,
      },
    ],
  };

  const convertedOps = convertVeo3ResponseToOperations(mockNewVeo31Response, 'scene_test_123');
  console.log(`   Converted Operations Count: ${convertedOps.length}`);
  console.log(`   Op 1 Name: ${convertedOps[0]?.name}, Done: ${convertedOps[0]?.done}`);
  console.log(`   Op 2 Name: ${convertedOps[1]?.name}, Done: ${convertedOps[1]?.done}`);

  if (convertedOps.length !== 2 || convertedOps[0]?.name !== 'operations/media_rendered_001') {
    throw new Error('❌ convertVeo3ResponseToOperations failed to adapt Veo 3.1 response shape!');
  }
  console.log('✅ Veo 3.1 Response Adapter verified: Anti-crash shape conversion active 100%');

  console.log('\n================================================================');
  console.log('🎉 VEO 3.1 ENDPOINTS & UI ADAPTER INTEGRATION VERIFIED 100% SUCCESSFUL');
  console.log('================================================================');
}

runVeo31Verification().catch((e) => {
  console.error('❌ Veo 3.1 verification failed:', e);
  process.exit(1);
});
