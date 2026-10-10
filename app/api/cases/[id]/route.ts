import { getChatGPTUser } from "../../../chatgpt-auth";
import { getCase,saveCase } from "../../../../lib/store";
import { CaseError,transition } from "../../../../lib/domain";
import { orchestrate } from "../../../../lib/agents";
import { z } from "zod";
import { body,docSchema,failure } from "../route";
const action=z.object({type:z.enum(["investigate","approve","reply","recheck","evidence"]),revision:z.number().int().min(0),reply:z.enum(["available","delayed","waiver"]).optional(),docs:z.array(docSchema).optional(),evidence:z.object({neatlogs:z.string(),entire:z.string(),checkpoint:z.string(),business:z.string()}).optional()});
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){try{const user=await getChatGPTUser();if(!user)throw new CaseError("Sign in required.",401);const {id}=await ctx.params;const a=action.parse(await body(req));const c=await getCase(user.userId,id);if(a.revision!==c.revision)throw new CaseError("Case changed. Refresh before continuing.",409);const normalized={...a,docs:a.docs?.map(d=>({...d,version:1,synthetic:false}))};const n=await orchestrate(c,normalized);await saveCase(user.userId,n,c.revision);return Response.json({case:n});}catch(e){return failure(e);}}
