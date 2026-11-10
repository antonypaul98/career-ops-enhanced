/** Non-submittable test output is never input to ordinary application workflows. */
export const EVALUATION_ONLY_MARKER = '<!-- career-ops:evaluation-only:v1 -->';
export function assertNotEvaluationOnly(value) {
  if (typeof value === 'string') {
    if (value.includes(EVALUATION_ONLY_MARKER)) throw new Error('Evaluation-only output cannot enter the application, PDF, or tracker workflow.');
    if (value.trimStart().startsWith('{')) {
      let parsed; try { parsed=JSON.parse(value); } catch { return; }
      assertNotEvaluationOnly(parsed);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (value.purpose==='evaluation_only' || value.evaluation_only===true || value.status==='evaluation-only' || value.type==='preview-report')
    throw new Error('Evaluation-only output cannot enter the application, PDF, or tracker workflow.');
  if (typeof value.reportMarkdown==='string') assertNotEvaluationOnly(value.reportMarkdown);
}
