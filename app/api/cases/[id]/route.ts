import { getChatGPTUser } from "../../../chatgpt-auth";
import { getCase,saveCase } from "../../../../lib/store";
import { CaseError } from "../../../../lib/domain";
import { orchestrate } from "../../../../lib/agents";
import { executeLcAction, LcActionError, lcAssessmentRequest, lcFollowUp } from '../../../../lib/lc-update-actions';
import { z } from "zod";
import { body,docSchema,failure } from "../route";
const revision=z.number().int().min(0);
const legacyAction=z.object({type:z.enum(["investigate","approve","reply","recheck","evidence","correspondence","reassess"]),revision,reply:z.enum(["available","delayed","waiver"]).optional(),sender:z.enum(["exporter","carrier","other"]).optional(),text:z.string().max(8000).optional(),docs:z.array(docSchema).optional(),evidence:z.object({neatlogs:z.string(),entire:z.string(),checkpoint:z.string(),business:z.string()}).optional()});
const note=z.string().trim().min(1).max(1000);
const token=z.string().regex(/^[a-f0-9]{64}$/);
const bindings={revision,assessmentId:z.string().min(1).max(120),assessmentBinding:token,baseBinding:token,candidateBinding:token};
const action=z.union([
 legacyAction,
 z.object({type:z.literal('stage_lc'),revision,candidate:z.object({name:z.string().trim().min(1).max(120),text:z.string().min(1).max(16000).refine(text=>!!text.trim())}).strict(),assertion:z.object({completeText:z.literal(true),note}).strict()}).strict(),
 z.object({type:z.literal('select_lc'),...bindings,assertion:z.object({completeText:z.literal(true),selectForCoveredChecks:z.literal(true),outsideCoverageReviewed:z.literal(true),note}).strict()}).strict(),
 z.object({type:z.literal('dismiss_lc'),...bindings}).strict(),
]);
export async function GET(_req:Request,ctx:{params:Promise<{id:string}>}) {
 try {const user=await getChatGPTUser();if(!user)throw new CaseError('Sign in required.',401);const {id}=await ctx.params;const c=await getCase(user.userId,id);return Response.json({case:c,lcAssessmentRequest:await lcAssessmentRequest(c),followUp:lcFollowUp(c)});}catch(e){return failure(e);}
}
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}) {
 try {
  const user=await getChatGPTUser();if(!user)throw new CaseError('Sign in required.',401);
  const {id}=await ctx.params;const a=action.parse(await body(req));
  const c=await getCase(user.userId,id); // Ownership is established before any execution or export.
  if(a.type==='stage_lc'||a.type==='select_lc'||a.type==='dismiss_lc')return Response.json(await executeLcAction(c,a,user.userId,{save:(n,previous)=>saveCase(user.userId,n,previous),read:()=>getCase(user.userId,id)}));
  if(a.revision!==c.revision)throw new CaseError('Case changed. Refresh before continuing.',409);
  const normalized={...a,docs:a.docs?.map(d=>({...d,version:1,synthetic:false}))};
  const n=await orchestrate(c,normalized);await saveCase(user.userId,n,c.revision);
  return Response.json({case:n,lcAssessmentRequest:await lcAssessmentRequest(n),followUp:lcFollowUp(n)});
 } catch(e) {
  if(e instanceof LcActionError)return Response.json({error:e.message,code:e.code,...(e.documents?{freshInvestigationRequired:e.documents}:{}),...(e.savedCase?{case:e.savedCase}:{})},{status:e.status});
  return failure(e);
 }
}
