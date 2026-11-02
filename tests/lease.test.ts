import {expect,it} from 'vitest';
import {updateLease} from '../src/core/lease';
it('preserves exclusive ownership across frames and tabs',()=>{
  const a=updateLease(undefined,{tab:1,frame:0},100);
  expect(a.granted).toBe(true);
  expect(updateLease(a.lease,{tab:1,frame:2},200).granted).toBe(false);
  expect(updateLease(a.lease,{tab:2,frame:0},200).granted).toBe(false);
});
it('renews only for owner and allows expired lease takeover',()=>{
  const a=updateLease(undefined,{tab:1,frame:0},0);
  const renewal=updateLease(a.lease,{tab:1,frame:0},4000);
  expect(renewal.lease?.expires).toBe(9000);
  expect(updateLease(renewal.lease,{tab:2,frame:0},9000).granted).toBe(true);
});
it('does not release another frame lease',()=>{
  const a=updateLease(undefined,{tab:1,frame:1},0);
  expect(updateLease(a.lease,{tab:1,frame:0,release:true},100).lease).toEqual(a.lease);
  expect(updateLease(a.lease,{tab:1,frame:1,release:true},100).lease).toBeUndefined();
});
it('can resume ownership from persisted session state after worker restart',()=>{
  const persisted=JSON.parse(JSON.stringify(updateLease(undefined,{tab:7,frame:3},100).lease));
  expect(updateLease(persisted,{tab:8,frame:0},200).granted).toBe(false);
  expect(updateLease(persisted,{tab:7,frame:3},200).granted).toBe(true);
});
