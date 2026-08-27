// Điểm vào bundle Nova Remotion. Đăng ký 2 composition:
//   NovaScene    — 1 cảnh, thời lượng lấy ĐÚNG từ spec (giải bài toán mẫu không khớp giây).
//   NovaSequence — nối nhiều cảnh thành cả video, mỗi cảnh giữ nguyên spec riêng.
const React = require('react');
const { registerRoot, Composition, Sequence, AbsoluteFill, useVideoConfig } = require('remotion');
const { TransitionSeries, linearTiming } = require('@remotion/transitions');
const { NovaScene } = require('./NovaScene');
const { presentationFor, durationFor } = require('./transitions');

const h = React.createElement;
const FPS = 30;
const secToFrames = (sec, fps) => Math.max(1, Math.round((Number(sec) || 3) * fps));

// Chuyển cảnh ĂN LẤN vào hai cảnh kề nhau (đó là bản chất của TransitionSeries),
// nên tổng thời lượng ngắn lại đúng bằng tổng thời gian chuyển. Ghim mỗi mối nối
// tối đa 1/3 cảnh ngắn hơn để cảnh 1,2s không bị chuyển cảnh nuốt mất.
function transFrames(sp, prevFrames, nextFrames, fps) {
  const name = (sp && (sp.trans || sp.transition)) || '';
  if (!name || name === 'none' || name === 'cut') return 0;
  const want = secToFrames(sp.transDur || durationFor(name, 0.5), fps);
  const cap = Math.floor(Math.min(prevFrames, nextFrames) / 3);
  return Math.max(0, Math.min(want, cap));
}

// Lớp TOÀN CỤC: thời gian tính theo cả video, vẽ ĐÈ LÊN toàn bộ chuỗi cảnh.
// Khác lớp trong cảnh (bị cắt ở mép cảnh) — cái này bắc cầu qua nhiều cảnh được.
function GlobalLayers({ layers }) {
  const { fps } = useVideoConfig();
  const list = Array.isArray(layers) ? layers : [];
  if (!list.length) return null;
  return h(AbsoluteFill, { style: { pointerEvents: 'none' } }, list.map((g, i) => {
    const from = Math.max(0, Math.round((Number(g.start) || 0) * fps));
    const dur = Math.max(1, Math.round((Number(g.dur) || 3) * fps));
    // Dựng như một cảnh 1 lớp: tái dùng NovaScene nên mọi mẫu/hiệu ứng chạy y hệt.
    // Nền PHẢI trong suốt: NovaScene luôn tô backgroundColor theo theme, mà lớp toàn cục
    // là lớp PHỦ — để nguyên theme thì nó thành tấm nền đục che sạch mọi cảnh bên dưới.
    const spec = { durationSec: dur / fps, theme: Object.assign({}, g.theme || {}, { bg: 'transparent' }), layers: [g.layer] };
    return h(Sequence, { key: g.id || ('G' + i), from, durationInFrames: dur, layout: 'none' },
      h(AbsoluteFill, null, h(NovaScene, { spec })));
  }));
}

function NovaSequence({ scenes, globals }) {
  const { fps } = useVideoConfig();
  const list = Array.isArray(scenes) ? scenes : [];
  const frames = list.map(sp => secToFrames(sp && sp.durationSec, fps));
  const anyTrans = list.some((sp, i) => i > 0 && transFrames(sp, frames[i - 1], frames[i], fps) > 0);

  // Không cảnh nào dùng chuyển cảnh → giữ nguyên đường Sequence cũ (rẻ hơn, thời lượng khớp tuyệt đối).
  if (!anyTrans) {
    let cursor = 0;
    const seq = list.map((sp, i) => {
      const from = cursor; cursor += frames[i];
      return h(Sequence, { key: (sp && sp.id) || ('S' + i), from, durationInFrames: frames[i] },
        h(NovaScene, { spec: sp }));
    });
    return h(React.Fragment, null, seq, h(GlobalLayers, { layers: globals }));
  }

  const kids = [];
  list.forEach((sp, i) => {
    const tf = i > 0 ? transFrames(sp, frames[i - 1], frames[i], fps) : 0;
    if (tf > 0) {
      kids.push(h(TransitionSeries.Transition, {
        key: 'T' + i,
        presentation: presentationFor(sp.trans || sp.transition),
        timing: linearTiming({ durationInFrames: tf }),
      }));
    }
    // CỘNG BÙ phần bị ăn lấn: TransitionSeries lấy tổng = Σ cảnh − Σ chuyển cảnh.
    // Không bù thì 192 cảnh × ~0,5s mất gần 95 giây, video ngắn hơn giọng đọc → lệch tiếng.
    kids.push(h(TransitionSeries.Sequence, {
      key: (sp && sp.id) || ('S' + i),
      durationInFrames: frames[i] + tf,
    }, h(NovaScene, { spec: sp })));
  });
  return h(React.Fragment, null, h(TransitionSeries, null, kids), h(GlobalLayers, { layers: globals }));
}

// Đã cộng bù ở mỗi cảnh nên tổng đúng bằng tổng thời lượng cảnh — khớp giọng đọc.
function totalFrames(list, fps) {
  const t = list.reduce((sum, sp) => sum + secToFrames(sp && sp.durationSec, fps), 0);
  return Math.max(1, t);
}

const Root = () => h(React.Fragment, null,
  h(Composition, {
    id: 'NovaScene',
    component: NovaScene,
    durationInFrames: 90, fps: FPS, width: 1920, height: 1080,
    defaultProps: { spec: { durationSec: 3, theme: {}, layers: [] } },
    // Thời lượng LUÔN bám spec → mẫu không bao giờ lệch giây cảnh.
    calculateMetadata: ({ props }) => ({
      durationInFrames: secToFrames(props && props.spec && props.spec.durationSec, FPS),
      props,
    }),
  }),
  h(Composition, {
    id: 'NovaSequence',
    component: NovaSequence,
    durationInFrames: 90, fps: FPS, width: 1920, height: 1080,
    defaultProps: { scenes: [], globals: [] },
    calculateMetadata: ({ props }) => {
      const list = (props && Array.isArray(props.scenes)) ? props.scenes : [];
      return { durationInFrames: totalFrames(list, FPS), props };
    },
  })
);

registerRoot(Root);
