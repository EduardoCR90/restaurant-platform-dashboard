// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { publicationJournal } from '../supabase/functions/_shared/publications';

declare global {
  // Deno is a runtime namespace in the Edge bundle; this test only supplies its type.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Deno {
    const env: { get(name: string): string | undefined };
  }
}

type Row = Record<string, unknown> | null;

function database(options: { managed: boolean }) {
  const updates: Record<string, unknown>[] = [];
  const rpc = vi.fn(async () => ({ error: null }));

  const query = (row: Row) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: row, error: null }),
    };
    return chain;
  };

  const update = (values: Record<string, unknown>) => {
    updates.push(values);
    const chain = {
      eq: () => chain,
      then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
    };
    return chain;
  };

  const client = {
    from(table: string) {
      if (table === 'website_deployments')
        return query({
          id: 'deployment-id',
          project_id: 'project',
          dataset: 'production',
          repository: 'owner/restaurant',
        });
      if (table === 'astro_provisioning_jobs')
        return query(options.managed ? { request_id: 'request-id' } : null);
      if (table === 'publication_operations')
        return {
          insert: async () => ({ error: null }),
          update,
        };
      throw new Error(`Unexpected table ${table}`);
    },
    rpc,
  };
  return { client, updates, rpc };
}

const input = {
  operationId: 'operation-id',
  restaurantId: 'restaurant-id',
  integrationId: 'integration-id',
  actorId: 'actor-id',
  projectId: 'project',
  dataset: 'production',
  documentId: 'page-test-one',
  action: 'publish' as const,
  previousRev: null,
};

describe('publication deployment dispatch', () => {
  it('dispatches once after accepting content for a platform-provisioned website', async () => {
    const db = database({ managed: true });
    const dispatch = vi.fn(async () => {});
    const journal = await publicationJournal(db.client as never, input, dispatch);

    await journal.begin();
    await journal.accept('a'.repeat(64));

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith('owner/restaurant');
    expect(db.rpc).toHaveBeenCalledWith('reconcile_publications', {
      target: 'deployment-id',
    });
  });

  it('does not add a second trigger to externally managed sites such as Salitre', async () => {
    const db = database({ managed: false });
    const dispatch = vi.fn(async () => {});
    const journal = await publicationJournal(db.client as never, input, dispatch);

    await journal.accept('a'.repeat(64));

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps the Sanity publication and exposes a safe error when GitHub rejects dispatch', async () => {
    const db = database({ managed: true });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const journal = await publicationJournal(db.client as never, input, async () => {
      throw new Error('private provider response');
    });

    await expect(journal.accept('a'.repeat(64))).resolves.toBeUndefined();

    expect(db.updates).toContainEqual({
      state: 'deployment_error',
      error_code: 'dispatch_failed',
    });
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'publication_workflow_dispatch_failed',
        deploymentId: 'deployment-id',
        category: 'github_dispatch',
      }),
    );
    expect(log.mock.calls.flat().join(' ')).not.toContain('private provider response');
    log.mockRestore();
  });
});
