// Unified project types for consistent data structure
export interface Project {
  id: string;
  name: string;
  description: string;
  type: 'private' | 'shared';
  status: 'active' | 'completed' | 'draft' | 'archived';
  role?: 'owner' | 'admin' | 'collaborator' | 'viewer';
  testSuites: number;
  testCases: number;
  coverage: number;
  lastActivity: string;
  isFavorite?: boolean;
  tags?: string[];
  owner?: {
    name: string;
    avatar?: string;
    initials: string;
  };
  members?: Array<{
    name: string;
    avatar?: string;
    initials: string;
    role: string;
  }>;
  memberCount: number;
  recentActivity?: Array<{
    user: string;
    action: string;
    timestamp: string;
  }>;
  folders?: Array<{
    id: string;
    name: string;
    description: string;
    suites: number;
    lastActivity: string;
  }>;
}

export interface ProjectFolder {
  id: string;
  name: string;
  description: string;
  projects: Project[];
  type: 'private' | 'shared';
  lastActivity: string;
  memberCount: number;
}

export type ProjectFilter = 'all' | 'my-projects' | 'shared-projects' | 'recent' | 'favorites';
export type ProjectSort = 'name' | 'lastActivity' | 'coverage' | 'testCases';