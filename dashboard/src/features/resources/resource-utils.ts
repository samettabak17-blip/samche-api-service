import type { QueryClient } from '@tanstack/react-query';
import type { Assistant } from '../../types/api';
import { tenantKeys } from '../dashboard/dashboard-api';

export type TenantResource = 'assistants' | 'channels' | 'knowledge-base';

export function selectTenantAssistants(assistants: Assistant[], tenantId: string): Assistant[] {
  return assistants.filter((assistant) => assistant.tenant_id === tenantId);
}

export async function invalidateTenantResource(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  tenantId: string,
  resource: TenantResource,
): Promise<void> {
  const key = resource === 'assistants'
    ? tenantKeys.assistants(tenantId)
    : resource === 'channels'
      ? tenantKeys.channels(tenantId)
      : tenantKeys.knowledgeBase(tenantId);
  await queryClient.invalidateQueries({ queryKey: key });
}

