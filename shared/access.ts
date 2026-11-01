import { z } from 'zod';
import { templateReleaseSchema } from './platform-contract.ts';
export const moduleKeys = [
  'content_management',
  'reservations',
  'staff_scheduling',
  'qr_menu',
  'events',
  'analytics',
] as const;
export const moduleKey = z.enum(moduleKeys);
export type ModuleKey = z.infer<typeof moduleKey>;
export const roles = ['restaurant_owner', 'restaurant_manager', 'restaurant_staff'] as const;
export type Role = (typeof roles)[number];
export const modules = moduleKeys.map((key, i) => ({
  key,
  name: ['Contenido y carta', 'Reservas', 'Turnos de personal', 'Carta QR', 'Eventos', 'Analítica'][
    i
  ],
  description: [
    'Páginas, bloques, imágenes y propuestas gastronómicas.',
    'Gestiona la disponibilidad de mesas.',
    'Organiza al equipo.',
    'La carta siempre a mano.',
    'Experiencias y encuentros.',
    'Entiende la actividad del negocio.',
  ][i],
  implemented: key === 'content_management',
  roles: ['restaurant_owner', 'restaurant_manager'] as readonly Role[],
  routes: key === 'content_management' ? ['/content', '/menu'] : [],
}));
export function canUseContent(
  role: Role | null,
  admin: boolean,
  granted: boolean,
  enabled: boolean,
) {
  return (
    (admin || role === 'restaurant_owner' || role === 'restaurant_manager') && granted && enabled
  );
}
const restaurantId = z.uuid();
export const adminRequest = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('module_activation'),
      payload: z
        .object({ restaurant_id: restaurantId, module_key: moduleKey, enabled: z.boolean() })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('select_template'),
      payload: z
        .object({
          restaurant_id: restaurantId,
          template_key: templateReleaseSchema.shape.template_key,
          version: templateReleaseSchema.shape.version,
          expected_revision: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    })
    .strict(),
  z.object({
    operation: z.literal('restaurant'),
    payload: z.object({
      name: z.string().min(1).max(120),
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      status: z.enum(['pending', 'active', 'suspended']),
    }),
  }),
  z.object({
    operation: z.literal('entitlement'),
    payload: z.object({ restaurant_id: restaurantId, module_key: moduleKey, granted: z.boolean() }),
  }),
  z.object({
    operation: z.literal('membership'),
    payload: z.object({
      restaurant_id: restaurantId,
      user_id: z.uuid(),
      role: z.enum(roles),
      status: z.enum(['invited', 'active', 'suspended']),
    }),
  }),
  z.object({
    operation: z.literal('integration'),
    payload: z.object({
      restaurant_id: restaurantId,
      project_id: z.string().regex(/^[a-z0-9]{1,32}$/),
      dataset: z.string().regex(/^[a-z0-9_-]{1,64}$/),
    }),
  }),
  z.object({
    operation: z.literal('restaurant_status'),
    payload: z.object({
      restaurant_id: restaurantId,
      status: z.enum(['pending', 'active', 'suspended']),
    }),
  }),
  z.object({
    operation: z.literal('user_status'),
    payload: z.object({ user_id: z.uuid(), status: z.enum(['active', 'suspended']) }),
  }),
  z.object({
    operation: z.literal('invite'),
    payload: z.object({ restaurant_id: restaurantId, email: z.email(), role: z.enum(roles) }),
  }),
]);
