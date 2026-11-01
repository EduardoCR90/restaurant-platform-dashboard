import { templateReleaseSchema, websiteStateSchema } from '../../shared/platform-contract';
import { publicationSchema } from '../../shared/publications';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { roles, moduleKey } from '../../shared/access';
import {
  sanityProvisioningJob,
  sanityProvisioningRequest,
  type SanityProvisioningRequest,
} from '../../shared/sanity-provisioning';
import {
  snapshotSchema,
  contentItemSchema,
  discardResultSchema,
  type ContentRequest,
} from '../../shared/content';
const env = z.object({ url: z.url(), key: z.string().min(1) }).safeParse({
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
export const configurationError = env.success
  ? null
  : 'Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY. Consulta .env.example.';
export const supabase = createClient(
  env.success ? env.data.url : 'http://127.0.0.1:54321',
  env.success ? env.data.key : 'not-configured',
  {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);
const restaurantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'pending', 'suspended']),
});
const profileSchema = z.object({
  id: z.uuid(),
  display_name: z.string(),
  status: z.literal('active'),
});
const membershipSchema = z.object({
  restaurant_id: z.uuid(),
  user_id: z.uuid(),
  role: z.enum(roles),
  status: z.enum(['invited', 'active', 'suspended']),
});
const moduleSchema = z.object({
  restaurant_id: z.uuid(),
  module_key: moduleKey,
  enabled: z.boolean(),
});
const entitlementSchema = z.object({
  restaurant_id: z.uuid(),
  module_key: moduleKey,
  granted: z.boolean(),
});
const integrationSchema = z.object({
  id: z.uuid(),
  restaurant_id: z.uuid(),
  provider: z.literal('sanity'),
  external_project_id: z.string(),
  external_dataset: z.string(),
});
export type Restaurant = z.infer<typeof restaurantSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Workspace = Awaited<ReturnType<typeof loadWorkspace>>;
export async function loadProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,display_name,status')
    .eq('id', userId)
    .single();
  if (error)
    throw new Error('Perfil no disponible o acceso suspendido. Contacta con el administrador.');
  return profileSchema.parse(data);
}
export async function loadWorkspace() {
  const results = await Promise.all([
    supabase.from('restaurants').select('id,name,slug,status').order('name'),
    supabase.from('restaurant_memberships').select('restaurant_id,user_id,role,status'),
    supabase.from('restaurant_modules').select('restaurant_id,module_key,enabled'),
    supabase.from('restaurant_module_entitlements').select('restaurant_id,module_key,granted'),
    supabase
      .from('restaurant_integrations')
      .select('id,restaurant_id,provider,external_project_id,external_dataset'),
    supabase.rpc('is_platform_admin'),
  ]);
  if (results.some((r) => r.error))
    throw new Error(
      'No se pudo cargar el espacio. Comprueba la conexión y la configuración de la base de datos.',
    );
  return {
    restaurants: z.array(restaurantSchema).parse(results[0].data),
    memberships: z.array(membershipSchema).parse(results[1].data),
    modules: z.array(moduleSchema).parse(results[2].data),
    entitlements: z.array(entitlementSchema).parse(results[3].data),
    integrations: z.array(integrationSchema).parse(results[4].data),
    admin: results[5].data === true,
  };
}
export async function updateName(id: string, name: string) {
  const { data, error } = await supabase
    .from('restaurants')
    .update({ name: z.string().trim().min(1).max(120).parse(name) })
    .eq('id', id)
    .select('id');
  if (error || !data?.length)
    throw new Error('No tienes permiso o el restaurante dejó de estar activo.');
}
export async function updateProfile(id: string, name: string) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: z.string().trim().max(120).parse(name) })
    .eq('id', id)
    .select('id');
  if (error || !data?.length) throw new Error('No se pudo guardar el perfil.');
}
export async function toggleModule(restaurantId: string, module: string, enabled: boolean) {
  await adminOperation({
    operation: 'module_activation',
    payload: {
      restaurant_id: restaurantId,
      module_key: module,
      enabled,
    },
  });
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function invoke(name: string, body: unknown): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(name, {
    body: body as Record<string, unknown>,
  });
  if (error) {
    let message = 'No se pudo completar la operación. Revisa conexión, sesión y permisos.';
    let status = 500;
    if (error.context instanceof Response) {
      status = error.context.status;
      try {
        const json: unknown = await error.context.json();
        const parsed = z.object({ error: z.string() }).safeParse(json);
        if (parsed.success) message = parsed.data.error;
      } catch {
        /* No exponer respuestas internas. */
      }
    }
    throw new ApiError(message, status);
  }
  return data as unknown;
}
export const contentApi = {
  async list(body: Extract<ContentRequest, { action: 'list' }>) {
    return z.array(contentItemSchema).parse(await invoke('content', body));
  },
  async document(body: Exclude<ContentRequest, { action: 'list' | 'upload' | 'discard' }>) {
    return snapshotSchema.parse(await invoke('content', body));
  },
  async discard(body: Extract<ContentRequest, { action: 'discard' }>) {
    return discardResultSchema.parse(await invoke('content', body));
  },
  async upload(restaurantId: string, file: File) {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    )
      throw new Error('Solo JPEG, PNG o WebP; máximo 8 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return z.object({ _id: z.string(), url: z.url() }).parse(
      await invoke('content', {
        action: 'upload',
        restaurantId,
        mime: file.type,
        data: btoa(binary),
      }),
    );
  },
};
export async function adminOperation(input: unknown) {
  return invoke('platform-admin', input);
}

export async function provisionSanity(input: SanityProvisioningRequest) {
  return sanityProvisioningJob.parse(
    await invoke('sanity-provisioning', sanityProvisioningRequest.parse(input)),
  );
}

export async function listPublications(restaurantId: string, documentId?: string) {
  return z.array(publicationSchema).parse(
    await invoke('publications', {
      action: 'list',
      restaurantId,
      ...(documentId ? { documentId } : {}),
    }),
  );
}

export async function loadWebsiteVersions(restaurantId: string) {
  z.uuid().parse(restaurantId);
  const [releases, website] = await Promise.all([
    supabase
      .from('template_releases')
      .select(
        'template_key,version,source_commit,distribution_hash,configuration_contract,content_contract,visual_contract',
      ),
    supabase
      .from('restaurant_websites')
      .select(
        'restaurant_id,installed_template_key,installed_version,desired_template_key,desired_version,revision,verified_run_id,verified_at',
      )
      .eq('restaurant_id', restaurantId)
      .maybeSingle(),
  ]);
  if (releases.error || website.error) throw new Error('Versión no disponible');
  const catalog = z.array(templateReleaseSchema).parse(releases.data);
  const row = website.data;
  const release = (key: unknown, version: unknown) =>
    catalog.find((item) => item.template_key === key && item.version === version) ?? null;
  return {
    releases: catalog,
    website: row
      ? websiteStateSchema.parse({
          ...row,
          installed_release: release(row.installed_template_key, row.installed_version),
          desired_release: release(row.desired_template_key, row.desired_version),
        })
      : null,
  };
}
