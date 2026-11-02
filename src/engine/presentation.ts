/** Bounded presentation queue. All timestamps are monotonic milliseconds. */
export interface TimedFrame<T> {at:number;resource:T;kind:'original'|'generated';epoch:number}
export class PresentationQueue<T> {
  private pending:TimedFrame<T>[]=[];private shown?:TimedFrame<T>;private lastAt=-Infinity;
  epoch=0;dropped=0;
  constructor(private release:(resource:T)=>void,readonly capacity=8){}
  enqueue(frame:TimedFrame<T>,now:number){
    if(frame.epoch!==this.epoch||frame.at<now-8||frame.at<=this.lastAt){this.release(frame.resource);this.dropped++;return false;}
    this.pending.push(frame);this.pending.sort((a,b)=>a.at-b.at);
    while(this.pending.length>this.capacity){this.release(this.pending.shift()!.resource);this.dropped++;}
    return true;
  }
  due(now:number){
    let latest:TimedFrame<T>|undefined;
    while(this.pending.length&&this.pending[0].at<=now){
      if(latest){this.release(latest.resource);this.dropped++;}latest=this.pending.shift();
    }
    if(!latest)return undefined;
    if(this.shown)this.release(this.shown.resource);
    this.shown=latest;this.lastAt=latest.at;return latest;
  }
  reset(){
    this.epoch++;for(const frame of this.pending)this.release(frame.resource);this.pending=[];
    if(this.shown)this.release(this.shown.resource);this.shown=undefined;this.lastAt=-Infinity;
  }
  get size(){return this.pending.length;}
}
export interface SourceStamp {mediaTime:number;displayTime:number;rate:number}
/** Decode cadence, including frames skipped between accepted input messages. */
export function sourceFrameRate(previous:SourceStamp&{frameNumber?:number},current:SourceStamp&{frameNumber?:number}){
  const delta=current.mediaTime-previous.mediaTime;
  if(delta<=0||delta>1||!Number.isFinite(delta)||current.rate!==previous.rate)return undefined;
  const count=current.frameNumber!==undefined&&previous.frameNumber!==undefined?current.frameNumber-previous.frameNumber:1;
  const fps=count/delta;return count>0&&fps>=1&&fps<=240?fps:undefined;
}
/** A fixed shared A/V offset, independent of inference throughput. */
export function syncLatency(profileMs:number){
  if(!Number.isFinite(profileMs)||profileMs<0)throw Error('无效的模型耗时');
  return Math.min(800,Math.max(200,Math.ceil((profileMs+60)/10)*10));
}
export function presentationCapacity(latencyMs:number,factor:2|4=2){return Math.ceil(latencyMs*60*factor/1000)+4;}
export function interpolationTimes(factor:2|4){return factor===4?[.25,.5,.75]:[.5];}
export function pairTiming(previous:SourceStamp,current:SourceStamp,latencyMs:number){
  const delta=current.mediaTime-previous.mediaTime;
  if(!Number.isFinite(delta)||delta<=0||delta>.1||current.rate!==previous.rate||current.rate!==1)return undefined;
  const observed=current.displayTime-previous.displayTime;
  if(observed<=0||Math.abs(observed-delta*1000)>12)return undefined;
  return {originalAt:current.displayTime+latencyMs,middleAt:(previous.displayTime+current.displayTime)/2+latencyMs,intervalMs:delta*1000};
}
