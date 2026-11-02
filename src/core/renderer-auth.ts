/** Short-lived, one-use renderer capabilities are issued only to a current lease owner. */
import type {Lease} from './lease';
export interface RendererGrant {tab:number;frame:number;expires:number}
export function canIssueRenderer(lease:Lease|undefined,tab:number,frame:number,now:number){return !!lease&&lease.tab===tab&&lease.frame===frame&&lease.expires>now;}
export function canUseRenderer(grant:RendererGrant|undefined,lease:Lease|undefined,tab:number,now:number){return !!grant&&grant.expires>now&&grant.tab===tab&&canIssueRenderer(lease,grant.tab,grant.frame,now);}
