import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
function setup(resume:()=>Promise<void>=async()=>{}){
 const destination={};const sources:{connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>}[]=[];const delays:{connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;delayTime:{value:number}}[]=[];
 class MockContext {
  state='running';destination=destination;resume=resume;
  createMediaElementSource=vi.fn(()=>{const node={connect:vi.fn(),disconnect:vi.fn()};sources.push(node);return node;});
  createDelay=vi.fn(()=>{const node={connect:vi.fn(),disconnect:vi.fn(),delayTime:{value:0}};delays.push(node);return node;});
 }
 const context=new MockContext();vi.stubGlobal('AudioContext',class {constructor(){return context;}});
 return {context,destination,sources,delays,video:{muted:false,volume:1} as HTMLVideoElement};
}
it('reuses the permanent MediaElementSource and restores a direct route on every stop',async()=>{
 const {context,destination,sources,delays,video}=setup();const {AudioDelay}=await import('../src/engine/audio');const audio=new AudioDelay(video);
 await audio.start(200);expect(delays[0].delayTime.value).toBe(.2);audio.stop();expect(sources[0].connect).toHaveBeenLastCalledWith(destination);
 await audio.start(200);audio.stop();audio.stop();expect(context.createMediaElementSource).toHaveBeenCalledOnce();expect(delays.every(d=>d.disconnect.mock.calls.length===1)).toBe(true);
});
it('never intercepts audio when context resume is rejected',async()=>{
 const {context,video}=setup(async()=>{throw Error('blocked');});const {AudioDelay}=await import('../src/engine/audio');
 await expect(new AudioDelay(video).start(200)).rejects.toThrow('blocked');expect(context.createMediaElementSource).not.toHaveBeenCalled();
});
it('cancels a pending resume without attaching an audio source',async()=>{
 let release!:()=>void;const {context,video}=setup(()=>new Promise<void>(r=>release=r));const {AudioDelay}=await import('../src/engine/audio');const audio=new AudioDelay(video);
 const pending=audio.start(200);audio.stop();release();await pending;expect(context.createMediaElementSource).not.toHaveBeenCalled();
});
it('keeps muted native playback untouched and prevents competing delay owners',async()=>{
 const {context,video}=setup();const {AudioDelay}=await import('../src/engine/audio');video.muted=true;await new AudioDelay(video).start(200);expect(context.createMediaElementSource).not.toHaveBeenCalled();
 video.muted=false;const first=new AudioDelay(video),second=new AudioDelay(video);await first.start(200);await expect(second.start(200)).rejects.toThrow('另一');first.stop();await second.start(200);second.stop();
});

it('detects suspension of the shared audio clock',async()=>{
 const {context,video}=setup();const {AudioDelay}=await import('../src/engine/audio');const audio=new AudioDelay(video);
 await audio.start(200);expect(audio.healthy).toBe(true);context.state='suspended';expect(audio.healthy).toBe(false);audio.stop();expect(audio.healthy).toBe(true);
});
