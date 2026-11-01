import { careerOpsRoot } from '@/lib/career-ops';
import { runDemoWorkflow } from '@/lib/demo-workflow.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (process.env.CAREER_OPS_ISOLATED_DEMO !== '1') return Response.json({error:'Isolated demo server required.'},{status:403});
  try { return Response.json(await runDemoWorkflow(careerOpsRoot(),req.signal)); }
  catch (error) { return Response.json({error:error instanceof Error ? error.message : 'Demo failed'},{status:409}); }
}
