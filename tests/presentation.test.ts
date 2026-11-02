import {expect,it} from 'vitest';
import {PresentationQueue,pairTiming,syncLatency,presentationCapacity,sourceFrameRate} from '../src/engine/presentation';
it('retains source cadence when the renderer accepted only every fourth decoded frame',()=>{
  const a={mediaTime:1,displayTime:1000,rate:1,frameNumber:30};
  expect(sourceFrameRate(a,{...a,mediaTime:1+4/30,frameNumber:34})).toBeCloseTo(30);
  expect(sourceFrameRate(a,{...a,mediaTime:1+1/30,frameNumber:31})).toBeCloseTo(30);
});
it('rejects discontinuities rather than reporting a misleading source frame rate',()=>{
  const a={mediaTime:5,displayTime:1000,rate:1,frameNumber:150};
  expect(sourceFrameRate(a,{...a,mediaTime:2,frameNumber:60})).toBeUndefined();
  expect(sourceFrameRate(a,{...a,mediaTime:5.1,frameNumber:1})).toBeUndefined();
  expect(sourceFrameRate(a,{...a,mediaTime:5.1,rate:2,frameNumber:153})).toBeUndefined();
});
it('presents generated frames in media order even when inference finishes after native processing',()=>{
  const released:string[]=[];const q=new PresentationQueue<string>(x=>released.push(x));
  q.enqueue({at:200,resource:'A',kind:'original',epoch:0},0);
  q.enqueue({at:242,resource:'B',kind:'original',epoch:0},42);
  q.enqueue({at:221,resource:'middle',kind:'generated',epoch:0},80);
  expect(q.due(200)?.resource).toBe('A');expect(q.due(221)?.resource).toBe('middle');expect(released).toEqual(['A']);
  expect(q.due(242)?.resource).toBe('B');q.reset();expect(released).toEqual(['A','middle','B']);
});
it('rejects late and stale inference instead of showing backwards motion after seeking',()=>{
  const released:string[]=[];const q=new PresentationQueue<string>(x=>released.push(x));
  expect(q.enqueue({at:100,resource:'late',kind:'generated',epoch:0},120)).toBe(false);
  q.reset();expect(q.enqueue({at:200,resource:'old-epoch',kind:'generated',epoch:0},150)).toBe(false);
  expect(q.size).toBe(0);expect(released).toEqual(['late','old-epoch']);
});
it('bounds resources, closes skipped frames, and never releases the current frame twice',()=>{
  const released:number[]=[];const q=new PresentationQueue<number>(x=>released.push(x),3);
  for(let i=0;i<20;i++)q.enqueue({at:200+i,resource:i,kind:'original',epoch:0},0);
  expect(q.size).toBe(3);expect(q.due(300)?.resource).toBe(19);q.reset();q.reset();
  expect(released).toHaveLength(20);expect(new Set(released).size).toBe(20);
});
it('accepts source clock pairs and rejects gaps, duplicates, seeks and unsupported rates',()=>{
  const a={mediaTime:1,displayTime:100,rate:1},b={mediaTime:1+1/24,displayTime:100+1000/24,rate:1};
  const pair=pairTiming(a,b,200)!;expect(pair.middleAt).toBeCloseTo(300+500/24);
  expect(pairTiming(a,a,200)).toBeUndefined();expect(pairTiming(b,a,200)).toBeUndefined();
  expect(pairTiming(a,{...b,rate:2},200)).toBeUndefined();expect(pairTiming(a,{...b,displayTime:300},200)).toBeUndefined();
});

it('uses a shared bounded sync delay instead of rejecting 130-140 ms inference',()=>{
  expect(syncLatency(130)).toBe(200);expect(syncLatency(140)).toBe(200);
  expect(syncLatency(280)).toBe(340);expect(syncLatency(2000)).toBe(800);
  expect(()=>syncLatency(NaN)).toThrow();
});
for(const fps of [24,30,60])it(`preserves ${fps} fps source timestamps with 140 ms sparse interpolation`,()=>{
  const latency=syncLatency(140),q=new PresentationQueue<string>(()=>{},presentationCapacity(latency));
  const interval=1000/fps;let nextSource=0,busyUntil=-1,generatedAt=0,sequence=0;
  const outputs:{at:number;resource:string}[]=[];const future:{done:number;at:number;resource:string}[]=[];
  for(let clock=0;clock<2400;clock++){
    if(nextSource<1800&&clock>=nextSource){
      const time=nextSource;const id=sequence++;
      q.enqueue({at:time+latency,resource:`source-${id}`,kind:'original',epoch:0},clock);
      if(id>0&&clock>=busyUntil){busyUntil=clock+140;future.push({done:busyUntil,at:time-interval/2+latency,resource:`middle-${id}`});generatedAt++;}
      nextSource+=interval;
    }
    while(future.length&&future[0].done<=clock){const frame=future.shift()!;q.enqueue({at:frame.at,resource:frame.resource,kind:'generated',epoch:0},clock);}
    const frame=q.due(clock);if(frame)outputs.push({at:frame.at,resource:frame.resource});
  }
  expect(outputs.filter(f=>f.resource.startsWith('source-'))).toHaveLength(sequence);
  expect(outputs.filter(f=>f.resource.startsWith('middle-'))).toHaveLength(generatedAt);
  expect(outputs.every((f,i)=>i===0||f.at>outputs[i-1].at)).toBe(true);
  expect(q.dropped).toBe(0);q.reset();
});

it('4x presents all temporal phases at 165 Hz but reports display drops at 60 Hz',()=>{
 const simulate=(hz:number)=>{
  const q=new PresentationQueue<string>(()=>{},presentationCapacity(200,4));let source=0,shown=0;
  for(let clock=0;clock<2100;clock+=1000/hz){
   while(source<1600&&source<=clock){
    q.enqueue({at:source+200,resource:'original',kind:'original',epoch:0},clock);
    if(source>0)for(const phase of [.25,.5,.75])q.enqueue({at:source-40+phase*40+200,resource:String(phase),kind:'generated',epoch:0},clock);
    source+=40;
   }
   if(q.due(clock))shown++;
  }
  const result={shown,dropped:q.dropped};q.reset();return result;
 };
 expect(simulate(165)).toEqual({shown:157,dropped:0});expect(simulate(60).dropped).toBeGreaterThan(0);
});
