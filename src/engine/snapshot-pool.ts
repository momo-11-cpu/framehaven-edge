/** Queue-ordered snapshots: only explicitly released textures can be reused. */
export class SnapshotPool {
  private idle=new Map<string,{texture:GPUTexture;bytes:number}[]>();
  private leased=new Map<GPUTexture,{key:string;bytes:number}>();
  private idleBytes=0;private stopped=false;
  constructor(private device:GPUDevice,private maxIdleBytes=96*1024*1024,private maxIdlePerSize=2){}
  acquire(width:number,height:number,format:GPUTextureFormat){
    if(this.stopped)throw Error('快照池已关闭');
    if(format!=='rgba16float'&&format!=='bgra8unorm'&&format!=='rgba8unorm')throw Error('不支持的快照格式');
    const bytes=width*height*(format==='rgba16float'?8:4),key=`${width}x${height}:${format}`;
    const cached=this.idle.get(key)?.pop();
    if(cached)this.idleBytes-=cached.bytes;
    const texture=cached?.texture??this.device.createTexture({size:[width,height],format,usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
    if(this.idle.has(key)&&this.idle.get(key)!.length===0)this.idle.delete(key);
    this.leased.set(texture,{key,bytes});return texture;
  }
  release(texture:GPUTexture){
    const record=this.leased.get(texture);if(!record)return;
    this.leased.delete(texture);
    const list=this.idle.get(record.key)??[];
    if(this.stopped||list.length>=this.maxIdlePerSize||record.bytes>this.maxIdleBytes){texture.destroy();return;}
    // Retire old video sizes instead of letting them permanently prevent reuse
    // after a resolution switch. Map order tracks the most recent release.
    while(this.idleBytes+record.bytes>this.maxIdleBytes){
      const oldest=this.idle.entries().next().value;if(!oldest)break;
      const [key,textures]=oldest,evicted=textures.shift()!;evicted.texture.destroy();this.idleBytes-=evicted.bytes;
      if(!textures.length)this.idle.delete(key);
    }
    const current=this.idle.get(record.key)??[];
    current.push({texture,bytes:record.bytes});this.idle.delete(record.key);this.idle.set(record.key,current);this.idleBytes+=record.bytes;
  }
  dispose(){
    this.stopped=true;
    for(const textures of this.idle.values())for(const {texture} of textures)texture.destroy();
    this.idle.clear();this.idleBytes=0;
    for(const texture of this.leased.keys())texture.destroy();this.leased.clear();
  }
  get stats(){return {leased:this.leased.size,idle:[...this.idle.values()].reduce((sum,list)=>sum+list.length,0),idleBytes:this.idleBytes};}
}
