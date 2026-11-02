import {expect,it} from 'vitest';
import {alignedSize,classifyStats,FramegenSession} from '../src/engine/framegen';
import {normalize,preset,stages} from '../src/core/config';
it('pads without shrinking odd and full HD frames',()=>{
  expect(alignedSize(1920,1080)).toEqual([1920,1088]);expect(alignedSize(853,480)).toEqual([864,480]);
  expect(()=>alignedSize(1920,2160)).toThrow();
});
it('uses upstream duplicate and cut thresholds including the maximum-change guard',()=>{
  expect(classifyStats(2,44)).toEqual({duplicate:true,cut:false});
  expect(classifyStats(2,45).duplicate).toBe(false);expect(classifyStats(2.5,10).duplicate).toBe(false);
  expect(classifyStats(91,255).cut).toBe(true);
});
it.each(['live','anime'] as const)('migrates legacy %s without changing spatial settings',mode=>{
  const before=preset(mode);before.stages.denoise.enabled=false;before.stages.sharpen.strength=.73;
  before.stages.interpolation.algorithm=mode==='anime'?'interp-gmfss-fortuna-webgpu':'interp-rife426-webgpu';
  const after=normalize(before);expect(after.mode).toBe(mode);expect(after.stages.interpolation.algorithm).toBe('interp-framegen-'+mode);
  for(const s of stages.filter(s=>s!=='interpolation'))expect(after.stages[s]).toEqual(before.stages[s]);
});
it('preserves a custom disabled temporal stage while migrating its algorithm',()=>{
  const c=preset('custom');c.stages.interpolation={enabled:false,algorithm:'interp-gmfss-fortuna-webgpu',strength:.3};
  expect(normalize(c).stages.interpolation).toEqual({enabled:false,algorithm:'interp-framegen-anime',strength:.3});
});
it('rejects corrupted weights before requesting a GPU',async()=>{
  const session=new FramegenSession(new URL('https://example.test/'));
  const bytes=(s:string)=>new TextEncoder().encode(s).buffer;
  await expect(session.init('framegen-live',1920,1080,undefined,async name=>bytes(name==='manifest.json'?'{"files":{}}':'corrupt'))).rejects.toThrow('校验失败');
  await session.dispose();
});
