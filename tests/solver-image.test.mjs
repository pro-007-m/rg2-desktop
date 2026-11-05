import assert from 'node:assert/strict';
import {IMAGE_DEFAULTS,normalizeImageSettings,readImageSettings,imageColor} from '../data/solver/image-settings.mjs';

assert.deepEqual(readImageSettings('{bad json'),IMAGE_DEFAULTS);
assert.deepEqual(readImageSettings('null'),IMAGE_DEFAULTS);
assert.deepEqual(normalizeImageSettings({contrast:999,saturation:-1,brightness:Infinity,gamma:.723,sharpness:'100',glow:NaN}),{...IMAGE_DEFAULTS,contrast:150,saturation:0,gamma:.72});
assert.deepEqual(normalizeImageSettings({saturation:null,contrast:NaN},{...IMAGE_DEFAULTS,saturation:50,contrast:130}),{...IMAGE_DEFAULTS,saturation:50,contrast:130});
for(const hex of ['#F8F8F8','#F52A32','#00C853','#FFE600','#FF7A00','#1565E8']){
  const value=parseInt(hex.slice(1),16),expected=[value>>16&255,value>>8&255,value&255].map(x=>x/255);
  imageColor(hex).forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-12,'Neutral display settings must preserve net colors'));
  const grey=imageColor(hex,{...IMAGE_DEFAULTS,saturation:0});
  assert.ok(Math.max(...grey)-Math.min(...grey)<1e-12,'Zero saturation produces equal channels');
  for(const saturation of [0,180])for(const contrast of [70,150])for(const brightness of [70,130])for(const gamma of [.7,1.3]){
    assert.ok(imageColor(hex,{...IMAGE_DEFAULTS,saturation,contrast,brightness,gamma}).every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  }
}
assert.ok(imageColor('#808080',{...IMAGE_DEFAULTS,brightness:130})[0]>imageColor('#808080')[0]);
assert.ok(imageColor('#808080',{...IMAGE_DEFAULTS,gamma:1.3})[0]>imageColor('#808080')[0]);
console.log('Image settings: reference palette, grayscale, all range extremes, invalid persistence passed');
