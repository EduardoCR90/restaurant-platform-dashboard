import { createClient } from '@supabase/supabase-js';
import { adminRequest } from '../../../shared/access.ts';
import { HttpError } from '../../../shared/editor-service.ts';
import { authenticate } from '../_shared/auth.ts';
import { handler, limitedJson } from '../_shared/http.ts';
Deno.serve(
  handler(async (request) => {
    const { client, user } = await authenticate(request);
    const { data: allowed, error: authError } = await client.rpc('is_platform_admin');
    if (authError || allowed !== true)
      throw new HttpError(403, 'Requiere administrador global activo');
    const input = adminRequest.parse(await limitedJson(request));
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!secret) throw new HttpError(503, 'Administración no configurada');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (input.operation === 'invite') {
      const redirect = Deno.env.get('INVITE_REDIRECT_URL');
      if (!redirect?.startsWith('https://'))
        throw new HttpError(503, 'Configura el destino seguro de invitaciones');
      const { data: restaurant, error: rError } = await admin
        .from('restaurants')
        .select('id,status')
        .eq('id', input.payload.restaurant_id)
        .single();
      if (rError || restaurant?.status !== 'active')
        throw new HttpError(422, 'Restaurante no activo');
      const { data: invitation, error: recordError } = await admin
        .from('restaurant_invitations')
        .insert({
          restaurant_id: restaurant.id,
          email: input.payload.email,
          role: input.payload.role,
          invited_by: user.id,
        })
        .select('id')
        .single();
      if (recordError) throw new HttpError(502, 'No se pudo registrar la invitación');
      const { data, error } = await admin.auth.admin.inviteUserByEmail(input.payload.email, {
        redirectTo: redirect,
      });
      if (error || !data.user) {
        await admin
          .from('restaurant_invitations')
          .update({ status: 'failed' })
          .eq('id', invitation.id);
        throw new HttpError(
          409,
          'Invitación no enviada. Revisa el usuario y el correo configurado antes de reintentar.',
        );
      }
      const { error: membershipError } = await admin.rpc('admin_configure', {
        actor: user.id,
        operation: 'membership',
        payload: {
          restaurant_id: restaurant.id,
          user_id: data.user.id,
          role: input.payload.role,
          status: 'active',
        },
      });
      if (membershipError) {
        await admin
          .from('restaurant_invitations')
          .update({ status: 'failed', user_id: data.user.id })
          .eq('id', invitation.id);
        throw new HttpError(
          502,
          'Usuario invitado; membresía pendiente. Un administrador debe revisarla.',
        );
      }
      await admin
        .from('restaurant_invitations')
        .update({ status: 'sent', user_id: data.user.id })
        .eq('id', invitation.id);
      return { id: invitation.id };
    }
    const { data, error } = await admin.rpc('admin_configure', {
      actor: user.id,
      operation: input.operation,
      payload: input.payload,
    });
    if (error)
      throw new HttpError(
        422,
        'Operación rechazada. Revisa los datos y los conflictos de unicidad.',
      );
    return { id: data };
  }),
);
