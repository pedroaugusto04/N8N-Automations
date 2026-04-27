export class QueryRequestDto {
  query = '';
  mode: 'search' | 'answer' = 'answer';
  workspaceSlug = '';
  projectSlug = '';
  limit = 5;
}

export class MarkRemindersDto {
  ids: string[] = [];
}
