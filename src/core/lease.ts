export interface Lease { tab:number;frame:number;expires:number }
export interface LeaseRequest { tab:number;frame:number;release?:boolean }
export function updateLease(current:Lease|undefined,request:LeaseRequest,now:number):{lease:Lease|undefined;granted:boolean}{
  const owner=current?.tab===request.tab&&current.frame===request.frame;
  if(request.release)return {lease:owner?undefined:current,granted:false};
  if(!current||current.expires<=now||owner)return {lease:{tab:request.tab,frame:request.frame,expires:now+5000},granted:true};
  return {lease:current,granted:false};
}
