import { Badge } from '@/components/ui/badge';
import type { ProjectStatus } from '@/lib/projects';
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {planned:'Planned', in_progress:'In progress', on_hold:'On hold', completed:'Completed'};
export function ProjectStatusBadge({status, archived}: {status:ProjectStatus; archived?:boolean}) {
  return <Badge variant={status === 'completed' ? 'default' : 'secondary'}>{archived ? 'Archived' : PROJECT_STATUS_LABELS[status]}</Badge>;
}
