export const stages = ['deblock','dering','denoise','deband','interpolation','sharpen','upscale'] as const;
export type Stage = typeof stages[number];
export type Mode = 'off' | 'live' | 'anime' | 'custom';
export interface Setting { enabled: boolean; algorithm: string; strength: number }
export interface Config {
  schemaVersion: 1; mode: Mode; stages: Record<Stage, Setting>;
  compare: boolean; maxSourceHeight: number;
  interpolationFactor:2|4;
}
export interface Algorithm { id: string; stage: Stage; label: string; ready: boolean; note?: string }
export const algorithms: Algorithm[] = [
  {id:'deblock-ffmpeg-weak',stage:'deblock',label:'FFmpeg weak deblock · GPU 适配',ready:true},
  {id:'dering-postproc',stage:'dering',label:'FFmpeg dering · GPU 适配',ready:true},
  {id:'denoise-bilateral',stage:'denoise',label:'FFmpeg fast bilateral · GPU 适配',ready:true},
  {id:'deband-libplacebo',stage:'deband',label:'libplacebo deband · GPU 适配',ready:true},
  {id:'interp-framegen-live',stage:'interpolation',label:'Framegen v7s · 真人',ready:true,note:'本地 FP16 WebGPU；权重限个人及非商业研究'},
  {id:'interp-framegen-anime',stage:'interpolation',label:'Framegen v7s · 动画去重',ready:true,note:'共用 v7s 模型，识别重复画面'},
  {id:'sharpen-cas',stage:'sharpen',label:'AMD CAS',ready:true},
  {id:'restore-anime4k-s',stage:'sharpen',label:'Anime4K Restore S',ready:true},
  {id:'upscale-fsrcnnx-x2',stage:'upscale',label:'FSRCNNX 2×',ready:true},
  {id:'upscale-anime4k-x2-s',stage:'upscale',label:'Anime4K CNN 2× S',ready:true}
];
export const labels: Record<Stage,string> = {
  deblock:'去块',dering:'去振铃',denoise:'降噪',deband:'去色带',
  interpolation:'补帧',sharpen:'锐化 / 线条修复',upscale:'AI 放大'
};
export const modeLabels: Record<Mode,string>={off:'关闭',live:'真人',anime:'动画',custom:'自定义'};
const core:Stage[]=['interpolation','sharpen','upscale'];
export function preset(mode: Mode = 'live'):Config {
  const anime=mode==='anime';
  const ids=[
    'deblock-ffmpeg-weak','dering-postproc','denoise-bilateral','deband-libplacebo',
    anime?'interp-framegen-anime':'interp-framegen-live',
    anime?'restore-anime4k-s':'sharpen-cas',
    anime?'upscale-anime4k-x2-s':'upscale-fsrcnnx-x2'
  ];
  return {schemaVersion:1, mode, compare:false,maxSourceHeight:1080,interpolationFactor:2,
    stages:Object.fromEntries(stages.map((stage,i)=>[stage,{enabled:mode!=='off',algorithm:ids[i],strength:stage==='sharpen'?0.35:0.2}])) as Record<Stage,Setting>};
}
export function normalize(value: unknown):Config {
  if(!value || typeof value!=='object') return preset();
  const raw=value as Partial<Config>;
  const mode:Mode=['off','live','anime','custom'].includes(raw.mode??'')?raw.mode!:'live';
  const result=preset(mode);
  result.compare=raw.compare===true;
  result.interpolationFactor=raw.interpolationFactor===4?4:2;
  result.maxSourceHeight=raw.maxSourceHeight===720?720:1080;
  for(const stage of stages){
    const input=raw.stages?.[stage];
    if(!input) continue;
    if(typeof input.enabled==='boolean') result.stages[stage].enabled=input.enabled;
    const migrated=stage==='interpolation'?({'interp-rife426-webgpu':'interp-framegen-live','interp-gmfss-fortuna-webgpu':'interp-framegen-anime'} as Record<string,string>)[input.algorithm]??input.algorithm:input.algorithm;
    if(algorithms.some(a=>a.stage===stage&&a.id===migrated)) result.stages[stage].algorithm=migrated;
    if(Number.isFinite(input.strength)) result.stages[stage].strength=Math.min(1,Math.max(0,input.strength));
  }
  if(mode==='off') for(const stage of stages) result.stages[stage].enabled=false;
  if(mode==='live'||mode==='anime'){
    const expected=preset(mode);
    if(stages.some(s=>result.stages[s].algorithm!==expected.stages[s].algorithm)||
      core.some(s=>!result.stages[s].enabled||result.stages[s].strength<=0))result.mode='custom';
  }
  return result;
}
export function edit(config:Config,stage:Stage,patch:Partial<Setting>):Config {
  const next=structuredClone(config);
  if(next.mode==='off') next.mode='custom';
  next.stages[stage]={...next.stages[stage],...patch};
  if(next.mode==='live'||next.mode==='anime'){
    if((patch.algorithm!==undefined&&patch.algorithm!==config.stages[stage].algorithm)||
      (core.includes(stage)&&(patch.enabled===false||patch.strength===0)))next.mode='custom';
  }
  return normalize(next);
}
export interface CapabilityResult { active:Stage[]; missing:Stage[]; status:'off'|'ready'|'degraded'|'unavailable' }
export function capabilities(config:Config):CapabilityResult {
  if(config.mode==='off') return {active:[],missing:[],status:'off'};
  const enabled=stages.filter(s=>config.stages[s].enabled&&config.stages[s].strength>0);
  const active=enabled.filter(s=>algorithms.find(a=>a.id===config.stages[s].algorithm)?.ready);
  const missing=enabled.filter(s=>!active.includes(s));
  return {active,missing,status:!enabled.length?'off':!active.length?'unavailable':missing.length?'degraded':'ready'};
}
export interface RuntimeStatus {
  state:'idle'|'off'|'warming'|'active'|'degraded'|'unsupported'|'error'|'suspended';
  message:string; source?:string; sourceFps?:number; outputFps?:number;
  processingMs?:number; frames?:number; active?:Stage[]; missing?:Stage[];
  generatedFps?:number;lateFrames?:number;queueDepth?:number;
  stages?:Partial<Record<Stage,StageRuntime>>;
  generatedTotal?:number;duplicatePairs?:number;cutPairs?:number;busyPairs?:number;displayDropped?:number;
  displayHz?:number;targetFps?:number;interpolationFactor?:2|4;
}
export interface StageRuntime {state:'running'|'waiting'|'disabled'|'suspended'|'error';completed:number;detail?:string;algorithm?:string}
