import {it,expect,vi} from 'vitest';
import {FramegenSession} from '../src/engine/framegen';
it('4x shares one trunk and awaits consumption before overwriting its output',async()=>{
 const session=new FramegenSession(new URL('https://example.test/'));
 const prepPair=vi.fn(),runT=vi.fn();let release!:()=>void;
 const gate=new Promise<void>(r=>release=r),seen:number[]=[];
 Object.assign(session,{rt:{prepPair,runT},inputs:[{},{}],output:{},cropped:{},width:1920,height:1080,device:{createCommandEncoder:()=>({copyTextureToTexture:vi.fn(),finish:()=>({})}),queue:{submit:vi.fn(),onSubmittedWorkDone:async()=>{}}}});
 const run=session.generate(0,1,4,async(_image,t)=>{seen.push(t);if(t===.25)await gate;});
 await vi.waitFor(()=>expect(seen).toEqual([.25]));expect(prepPair).toHaveBeenCalledOnce();expect(runT).toHaveBeenCalledTimes(1);
 expect(()=>session.generate(0,1,2,()=>{})).toThrow('堆积');release();await run;
 expect(seen).toEqual([.25,.5,.75]);expect(prepPair).toHaveBeenCalledOnce();expect(runT.mock.calls.map(c=>c[0])).toEqual([.25,.5,.75]);
});
