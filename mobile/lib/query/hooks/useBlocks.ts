import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type BlockPublic = components['schemas']['BlockPublic'];

/** `GET /me/blocks` — the authors the caller has blocked, for Me > Blocked users. */
export function useMyBlocks() {
  return useQuery({
    queryKey: queryKeys.me.blocks(),
    queryFn: ({ signal }) => api.get('/me/blocks', { init: { signal } }),
  });
}

/**
 * `DELETE /me/blocks/{block_id}` — also what the post-block Undo calls. Optimistic removal
 * from the list, restored on failure; on settle both the block list and every comment
 * thread refetch, since unblocking makes that author's comments visible again.
 */
export function useUnblock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockId: string) =>
      api.delete('/me/blocks/{block_id}', { params: { path: { block_id: blockId } } }),
    onMutate: async (blockId) => {
      const key = queryKeys.me.blocks();
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BlockPublic[]>(key);
      queryClient.setQueryData<BlockPublic[]>(key, (current) => current?.filter((block) => block.id !== blockId));
      return { key, previous };
    },
    onError: (_err, _blockId, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.blocks() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.all });
    },
  });
}
