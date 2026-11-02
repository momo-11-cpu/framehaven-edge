import {it,expect} from 'vitest';
import {preset,normalize,type RuntimeStatus} from '../src/core/config';
import {stageStates,displayStage} from '../src/core/stage-status';
it('does not equate enabled with running before a completed GPU batch',()=>{
 const c=preset();expect(stageStates(c,{}).deblock?.state).toBe('waiting');
 const status:RuntimeStatus={state:'active',message:'',stages:stageStates(c,{deblock:12})};
 expect(displayStage(c,status,'deblock')).toMatchObject({state:'running',completed:12});
 expect(displayStage(c,status,'denoise').state).toBe('waiting');
});
it('does not retain stale running badges during errors, suspension or temporal fallback',()=>{
 const c=preset();const stages=stageStates(c,{sharpen:10},{completed:3,detail:'ready'});
 expect(displayStage(c,{state:'error',message:'device lost',stages},'sharpen').state).toBe('error');
 expect(displayStage(c,{state:'suspended',message:'hidden',stages},'sharpen').state).toBe('suspended');
 expect(displayStage(c,{state:'degraded',message:'audio',missing:['interpolation'],stages},'interpolation').state).toBe('suspended');
});
it('defaults old configurations to 2x and allows 4x without changing preset identity',()=>{
 const c=preset('anime');expect(normalize({...c,interpolationFactor:undefined}).interpolationFactor).toBe(2);
 expect(normalize({...c,interpolationFactor:3}).interpolationFactor).toBe(2);
 expect(normalize({...c,interpolationFactor:4})).toMatchObject({mode:'anime',interpolationFactor:4});
});
