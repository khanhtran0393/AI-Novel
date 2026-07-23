/**
 * Offline unit: dual-hook dedupe + Phần grouping.
 *   npx tsx scripts/smoke-scene-workspace-groups.mts
 */
import assert from 'assert';
import {
  bodySceneIndicesForWorkspace,
  findColdOpenSceneIndex,
  groupScenesIntoPhan,
  isBodyColdOpenScene,
  resolveHookDisplayContent,
} from '../src/lib/sceneWorkspaceGroups.ts';
import { parseScenes } from '../src/lib/storyWriting.ts';

const sample = `
[CẢNH 0: COLD OPEN - HOOK]
Tiếng chuông vỡ. Máu trên kính.

[CẢNH 1: NỘI - PHÒNG]
A bước vào.

[CẢNH 2: NGOẠI - PHỐ]
B chạy.

[CẢNH 3: NỘI - XE]
C thở.

[CẢNH 4: NGOẠI - SÂN]
D nhìn.

[CẢNH 5: NỘI - MÁY]
E gõ.
`.trim();

const scenes = parseScenes(sample);
assert.ok(scenes.length >= 5, `scenes ${scenes.length}`);
assert.ok(isBodyColdOpenScene(scenes[0]), 'first is cold open');
assert.equal(findColdOpenSceneIndex(scenes), 0);

const body = bodySceneIndicesForWorkspace(scenes);
assert.ok(!body.includes(0), 'CẢNH 0 not in body list');
assert.ok(body.length >= 4, `body ${body.length}`);

const groups = groupScenesIntoPhan(body, scenes, 3);
assert.ok(groups.length >= 2, `phan groups ${groups.length}`);
assert.ok(groups[0].label.includes('Phần 1'), groups[0].label);

const hook = resolveHookDisplayContent('', scenes);
assert.ok(hook.includes('chuông') || hook.includes('Máu') || hook.length > 10, hook);

const hookStore = resolveHookDisplayContent('Hook từ store riêng', scenes);
assert.equal(hookStore, 'Hook từ store riêng');

// Collapse model (mirrors ContentTab phanOpenMap): default closed; toggle independent
const map: Record<number, boolean> = {};
const isOpen = (p: number) => map[p] === true;
const toggle = (p: number) => {
  map[p] = map[p] !== true;
};
assert.equal(isOpen(1), false, 'default collapsed');
toggle(1);
assert.equal(isOpen(1), true, 'open after toggle');
toggle(1);
assert.equal(isOpen(1), false, 'close after second toggle');
// Independent: open P2 while P1 closed
toggle(2);
assert.equal(isOpen(1), false);
assert.equal(isOpen(2), true);

console.log(
  JSON.stringify(
    {
      sceneCount: scenes.length,
      bodyIndices: body,
      phan: groups.map((g) => g.label),
      hookLen: hook.length,
      collapseModel: 'independent-default-closed',
    },
    null,
    2,
  ),
);
console.log('[smoke-scene-workspace-groups] PASS');
