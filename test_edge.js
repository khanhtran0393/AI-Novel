const edge = require('node-edge-tts');
console.log(Object.keys(edge));
if (edge.EdgeTTS) {
  console.log(Object.keys(edge.EdgeTTS.prototype));
}
