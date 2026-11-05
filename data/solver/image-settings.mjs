// Display-only settings. The solver's logical colors and editor palette stay intact.
export const IMAGE_DEFAULTS=Object.freeze({contrast:100,saturation:100,brightness:100,gamma:1,sharpness:0,glow:40});
const RANGES={contrast:[70,150],saturation:[0,180],brightness:[70,130],gamma:[.7,1.3],sharpness:[0,100],glow:[0,100]};

export function normalizeImageSettings(value,previous=IMAGE_DEFAULTS){
  const result={...IMAGE_DEFAULTS};
  for(const [key,[min,max]] of Object.entries(RANGES)){
    const old=typeof previous?.[key]==='number'&&Number.isFinite(previous[key])?previous[key]:IMAGE_DEFAULTS[key];
    const number=typeof value?.[key]==='number'&&Number.isFinite(value[key])?value[key]:old;
    const bounded=Math.max(min,Math.min(max,number));
    result[key]=key==='gamma'?Math.round(bounded*100)/100:Math.round(bounded);
  }
  return result;
}

export function readImageSettings(json){
  try{return normalizeImageSettings(JSON.parse(json));}catch{return {...IMAGE_DEFAULTS};}
}

// Work in display RGB, then convert to the renderer's linear color space.
// Identity settings preserve every original channel exactly.
export function imageColor(hex,settings=IMAGE_DEFAULTS){
  const value=parseInt(hex.replace('#',''),16),rgb=[value>>16&255,value>>8&255,value&255].map(x=>x/255);
  const luma=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  return rgb.map(channel=>{
    const saturated=luma+(channel-luma)*settings.saturation/100;
    const contrasted=(saturated-.5)*settings.contrast/100+.5;
    return Math.pow(Math.max(0,Math.min(1,contrasted*settings.brightness/100)),1/settings.gamma);
  });
}
