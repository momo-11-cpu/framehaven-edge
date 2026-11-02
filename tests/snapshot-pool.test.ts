import {afterEach,expect,it,vi} from 'vitest';
import {SnapshotPool} from '../src/engine/snapshot-pool';
function setup(bytes=96*1024*1024){
  vi.stubGlobal('GPUTextureUsage',{COPY_DST:1,TEXTURE_BINDING:2});
  const made:{destroy:ReturnType<typeof vi.fn>}[]=[];
  const device={createTexture:vi.fn(()=>{const texture={destroy:vi.fn()};made.push(texture);return texture;})};
  return {pool:new SnapshotPool(device as unknown as GPUDevice,bytes),made};
}
afterEach(()=>vi.unstubAllGlobals());
it('never reuses a leased snapshot and reuses released snapshots with correct byte accounting',()=>{
  const {pool,made}=setup();const a=pool.acquire(100,100,'rgba16float');const b=pool.acquire(100,100,'rgba16float');
  expect(a).not.toBe(b);pool.release(a);expect(pool.stats).toEqual({leased:1,idle:1,idleBytes:80000});
  expect(pool.acquire(100,100,'rgba16float')).toBe(a);expect(pool.stats).toEqual({leased:2,idle:0,idleBytes:0});
  pool.release(a);pool.release(a);pool.release(b);expect(pool.stats.idle).toBe(2);expect(made).toHaveLength(2);
  pool.dispose();expect(made.every(t=>t.destroy.mock.calls.length===1)).toBe(true);
});
it('bounds idle bytes and destroys surplus resources instead of retaining video-sized allocations',()=>{
  const {pool,made}=setup(100000);const textures=Array.from({length:3},()=>pool.acquire(100,100,'rgba16float'));
  textures.forEach(t=>pool.release(t));expect(pool.stats).toEqual({leased:0,idle:1,idleBytes:80000});
  expect(made.filter(t=>t.destroy.mock.calls.length===1)).toHaveLength(2);pool.dispose();
});
it('keeps sizes and formats distinct and destroys outstanding leases on shutdown',()=>{
  const {pool,made}=setup();const a=pool.acquire(100,100,'rgba16float');pool.release(a);
  const b=pool.acquire(100,100,'bgra8unorm');const c=pool.acquire(200,100,'rgba16float');
  expect(b).not.toBe(a);expect(c).not.toBe(a);pool.dispose();pool.release(b);pool.dispose();
  expect(made.every(t=>t.destroy.mock.calls.length===1)).toBe(true);expect(()=>pool.acquire(1,1,'rgba16float')).toThrow('关闭');
});
it('caps the number of idle textures even within the byte budget',()=>{
  const {pool,made}=setup();const textures=Array.from({length:5},()=>pool.acquire(10,10,'rgba16float'));
  textures.forEach(t=>pool.release(t));expect(pool.stats.idle).toBe(2);expect(made.filter(t=>t.destroy.mock.calls.length===1)).toHaveLength(3);pool.dispose();
});
it('evicts old video sizes so a new resolution can reuse snapshots within the same budget',()=>{
  const {pool,made}=setup(100000);const old=pool.acquire(100,100,'rgba16float');pool.release(old);
  const current=pool.acquire(150,100,'bgra8unorm');pool.release(current);
  expect(made[0].destroy).toHaveBeenCalledOnce();expect(pool.stats.idleBytes).toBe(60000);
  expect(pool.acquire(150,100,'bgra8unorm')).toBe(current);expect(pool.stats.idleBytes).toBe(0);pool.dispose();
});
