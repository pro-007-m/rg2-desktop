/* Small, deterministic quality policy. No timers or persistent/global settings. */
export const QUALITY_NAMES = Object.freeze(['low', 'medium', 'high']);
export function qualityProfile({size=3,quality='auto',devicePixelRatio=1,mobile=false,deviceMemory=8,hardwareConcurrency=8,width=640,height=640}={}) {
  const lowEnd=mobile&&(deviceMemory<=4||hardwareConcurrency<=4);
  let level=quality==='auto'?(size>16||lowEnd&&size>7?'low':size>7||lowEnd?'medium':'high'):QUALITY_NAMES.includes(quality)?quality:'medium';
  const pixelsPerTile=Math.min(width,height)*.58/Math.max(2,size);
  if(quality==='auto'&&pixelsPerTile<12)level='low';
  const rank=QUALITY_NAMES.indexOf(level);
  return {quality:level,requested:quality,auto:quality==='auto',lowEnd,
    dpr:Math.min(Math.max(1,devicePixelRatio||1),lowEnd&&quality==='auto'?1.15:rank===0?1.25:rank===1?1.5:1.75),
    capSegments:rank===2?3:rank===1?2:0,
    bloom:rank>0&&(!lowEnd||quality==='high'),antialias:!lowEnd||quality==='high',pixelsPerTile,
    maxTriangles:size*size*6*(rank===2?160:rank===1?96:12)+(6*size*size-12*size+8)*12+Math.max(96,size*12)};
}

/** Changes DPR only after enough *render-cost* samples, never from idle frame gaps. */
export function createAdaptiveQuality(profile,{minimumDpr=.85,sampleCount=24}={}) {
  let current={...profile},costs=[],slowBatches=0,fastBatches=0;
  return {
    sample(milliseconds){
      if(!current.auto||!Number.isFinite(milliseconds)||milliseconds<0)return null;
      costs.push(milliseconds);if(costs.length<sampleCount)return null;
      const sorted=costs.sort((a,b)=>a-b),p75=sorted[Math.floor(sorted.length*.75)];costs=[];
      slowBatches=p75>19?slowBatches+1:0;fastBatches=p75<7?fastBatches+1:0;
      if(slowBatches>=2&&current.dpr>minimumDpr){current.dpr=Math.max(minimumDpr,Math.round((current.dpr-.15)*100)/100);slowBatches=0;fastBatches=0;return {...current};}
      if(fastBatches>=6&&current.dpr<profile.dpr){current.dpr=Math.min(profile.dpr,Math.round((current.dpr+.1)*100)/100);fastBatches=0;return {...current};}
      return null;
    },
    get current(){return {...current};},
    reset(next){current={...next};profile={...next};costs=[];slowBatches=0;fastBatches=0;},
  };
}
