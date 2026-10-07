import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';

/**
 * `GET /api/v1/catalog/sermons/prophets-catalog` — Home's "Prophet's Catalog" shelf.
 * Public, like every other `/catalog` read: sermons an editor has manually flagged via
 * the admin editor's "Prophet's Catalog" switch (`content_service.list_prophets_catalog_sermons`).
 * Purely editorial curation, no algorithmic selection.
 */
export function useProphetsCatalog() {
  return useQuery({
    queryKey: queryKeys.sermons.prophetsCatalog(),
    queryFn: ({ signal }) => api.get('/catalog/sermons/prophets-catalog', { init: { signal } }),
  });
}
