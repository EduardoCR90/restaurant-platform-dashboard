import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('automatic rollout uses only green same-repository current main and the pinned validated SHA', async () => {
  const text = await readFile('.github/workflows/rollout-template-governance.yml', 'utf8');
  for (const guard of [
    "conclusion == 'success'",
    "head_branch == 'main'",
    'head_repository.full_name == github.repository',
    'head_sha == github.sha',
    'validated_sha: ${{ github.event.workflow_run.head_sha }}',
    'needs: configure',
    'cancel-in-progress: false',
  ])
    assert.ok(text.includes(guard), guard);
  assert.ok(!text.includes('pull_request_target'));
  assert.ok(text.includes('contents: read'));
  for (const file of ['configure-template-governance.yml', 'deploy-supabase.yml']) {
    const source = await readFile('.github/workflows/' + file, 'utf8');
    assert.ok(source.includes('workflow_dispatch:'));
    assert.ok(source.includes('ref: ${{ inputs.validated_sha || github.sha }}'));
    assert.ok(source.includes("github.ref == 'refs/heads/main'"));
  }
});
