export function shouldShowConversationWorkspaceSkeleton({
  isLoading,
  hasData,
  search,
}: {
  isLoading: boolean;
  hasData: boolean;
  search: string;
}): boolean {
  return isLoading && !hasData && search.trim().length === 0;
}
