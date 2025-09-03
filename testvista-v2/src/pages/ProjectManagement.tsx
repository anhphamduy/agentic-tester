import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/layout/sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectFilters } from "@/components/project/project-filters";
import { UnifiedProjectCard } from "@/components/project/unified-project-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, CheckSquare, Users, Target, TrendingUp, Clock, Zap, Calendar, Star, Shield, Eye, UserCheck, Crown, ArrowRight } from "lucide-react";
import { ProjectFilter, ProjectSort, Project } from "@/types/project";
import { mockProjects, recentActivity, projectRecommendations } from "@/data/mockProjects";
import { toast } from "@/hooks/use-toast";
export default function ProjectManagement() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<ProjectFilter>("all");
  const [sortBy, setSortBy] = useState<ProjectSort>("lastActivity");
  const navigate = useNavigate();

  // Filter and sort projects
  const filteredAndSortedProjects = useMemo(() => {
    let filtered = [...mockProjects];

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(project => project.name.toLowerCase().includes(searchQuery.toLowerCase()) || project.description.toLowerCase().includes(searchQuery.toLowerCase()) || project.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())));
    }

    // Apply category filter
    switch (activeFilter) {
      case "my-projects":
        filtered = filtered.filter(p => p.type === "private");
        break;
      case "shared-projects":
        filtered = filtered.filter(p => p.type === "shared");
        break;
      case "recent":
        // Show projects with activity in last 24 hours
        filtered = filtered.filter(p => p.lastActivity.includes("hour") || p.lastActivity === "1 day ago");
        break;
      case "favorites":
        filtered = filtered.filter(p => p.isFavorite);
        break;
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "coverage":
          return b.coverage - a.coverage;
        case "testCases":
          return b.testCases - a.testCases;
        case "lastActivity":
        default:
          // Simple sorting by last activity (would need proper date parsing in real app)
          const getActivityWeight = (activity: string) => {
            if (activity.includes("hour")) return 1;
            if (activity.includes("day")) return 2;
            if (activity.includes("week")) return 3;
            return 4;
          };
          return getActivityWeight(a.lastActivity) - getActivityWeight(b.lastActivity);
      }
    });
    return filtered;
  }, [searchQuery, activeFilter, sortBy]);

  // Project actions
  const handleToggleFavorite = (projectId: string) => {
    toast({
      title: "Favorite updated",
      description: "Project favorite status has been updated."
    });
  };
  const handleShareProject = (projectId: string) => {
    toast({
      title: "Share project",
      description: "Project sharing dialog would open here."
    });
  };
  const handleCloneProject = (projectId: string) => {
    toast({
      title: "Project cloned",
      description: "Project has been cloned to your private space."
    });
  };
  const handleArchiveProject = (projectId: string) => {
    toast({
      title: "Project archived",
      description: "Project has been moved to archived projects."
    });
  };
  const handleDeleteProject = (projectId: string) => {
    toast({
      title: "Project deleted",
      description: "Project has been permanently deleted.",
      variant: "destructive"
    });
  };
  const handleCreateProject = () => {
    navigate("/create-suite");
  };

  // Separate projects by type for better organization
  const mySharedProjects = useMemo(() => {
    if (activeFilter === "my-projects") {
      return filteredAndSortedProjects.filter(p => p.id === "my-space");
    }
    return filteredAndSortedProjects.filter(p => p.type === "private" || p.type === "shared" && (p.role === "owner" || p.role === "admin" || p.role === "collaborator"));
  }, [filteredAndSortedProjects, activeFilter]);
  const otherAccessibleProjects = useMemo(() => {
    return filteredAndSortedProjects.filter(p => p.type === "shared" && p.role === "viewer");
  }, [filteredAndSortedProjects]);
  const getRoleIcon = (role?: string) => {
    switch (role) {
      case "owner":
        return Crown;
      case "admin":
        return Shield;
      case "collaborator":
        return UserCheck;
      case "viewer":
        return Eye;
      default:
        return Users;
    }
  };
  const getRoleBadgeColor = (role?: string) => {
    switch (role) {
      case "owner":
        return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
      case "admin":
        return "bg-red-500/10 text-red-600 border-red-500/20";
      case "collaborator":
        return "bg-blue-500/10 text-blue-600 border-blue-500/20";
      case "viewer":
        return "bg-gray-500/10 text-gray-600 border-gray-500/20";
      default:
        return "bg-primary/10 text-primary border-primary/20";
    }
  };
  return <div className="flex h-screen bg-workspace-bg">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader />
        
        <main className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Page Header */}
            


            {/* Recent Activity */}
            {activeFilter === "recent" && !searchQuery && <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-primary" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {recentActivity.map((activity, index) => <div key={index} className="flex items-center gap-3 p-3 bg-card/50 rounded-lg">
                        <div className="h-2 w-2 bg-primary rounded-full" />
                        <div className="flex-1">
                          <p className="text-sm">
                            <span className="font-medium">{activity.user}</span> {activity.action} in{" "}
                            <span className="font-medium">{activity.projectName}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">{activity.timestamp}</p>
                        </div>
                      </div>)}
                  </div>
                </CardContent>
              </Card>}

            {/* Project Filters */}
            <Card className="border-border/50">
              <CardContent className="p-6">
                <ProjectFilters searchQuery={searchQuery} onSearchChange={setSearchQuery} activeFilter={activeFilter} onFilterChange={setActiveFilter} sortBy={sortBy} onSortChange={setSortBy} totalCount={mockProjects.filter(p => p.type === "shared").length} filteredCount={filteredAndSortedProjects.filter(p => p.type === "shared").length} />
              </CardContent>
            </Card>

            {/* My Shared Projects */}
            {mySharedProjects.length > 0 && <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {activeFilter === "all" && <><FolderOpen className="h-5 w-5 text-primary" />All Projects</>}
                    {activeFilter === "my-projects" && <><FolderOpen className="h-5 w-5 text-primary" />My Space</>}
                    {activeFilter === "shared-projects" && <><Users className="h-5 w-5 text-primary" />Shared Projects</>}
                    <Badge variant="secondary" className="ml-2">
                      {mySharedProjects.length}
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {activeFilter === "my-projects" 
                      ? "Your personal workspace and private projects"
                      : activeFilter === "shared-projects"
                      ? "Projects shared with your team where you have access"
                      : "Your workspace and projects where you have ownership or collaboration access"
                    }
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-6">
                    {mySharedProjects.map(project => {
                  const RoleIcon = getRoleIcon(project.role);
                  return <div key={project.id} className="relative">
                          <UnifiedProjectCard project={project} onToggleFavorite={handleToggleFavorite} onShareProject={handleShareProject} onCloneProject={handleCloneProject} onArchiveProject={handleArchiveProject} onDeleteProject={handleDeleteProject} />
                          <Badge variant="outline" className={`absolute top-3 right-3 gap-1 ${getRoleBadgeColor(project.role)}`}>
                            <RoleIcon className="h-3 w-3" />
                            {project.role}
                          </Badge>
                        </div>;
                })}
                  </div>
                </CardContent>
              </Card>}

            {/* Other Accessible Projects */}
            {otherAccessibleProjects.length > 0 && <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5 text-muted-foreground" />
                    Other Accessible Projects
                    <Badge variant="outline" className="ml-2">
                      {otherAccessibleProjects.length}
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Projects where you have viewing access only
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-6">
                    {otherAccessibleProjects.map(project => <div key={project.id} className="relative opacity-80">
                        <UnifiedProjectCard project={project} onToggleFavorite={handleToggleFavorite} onShareProject={handleShareProject} onCloneProject={handleCloneProject} onArchiveProject={handleArchiveProject} onDeleteProject={handleDeleteProject} />
                        <Badge variant="outline" className={`absolute top-3 right-3 gap-1 ${getRoleBadgeColor(project.role)}`}>
                          <Eye className="h-3 w-3" />
                          View Only
                        </Badge>
                      </div>)}
                  </div>
                </CardContent>
              </Card>}

            {/* Empty State */}
            {filteredAndSortedProjects.filter(p => p.type === "shared").length === 0 && <Card className="border-border/50">
                <CardContent className="text-center py-12">
                  <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No shared projects found</h3>
                  <p className="text-muted-foreground mb-4">
                    {searchQuery || activeFilter !== "all" ? "Try adjusting your search or filters." : "You don't have access to any shared projects yet."}
                  </p>
                  {!searchQuery && activeFilter === "all" && <div className="space-y-3">
                      <Button onClick={handleCreateProject} className="gap-2">
                        <CheckSquare className="h-4 w-4" />
                        Create Your First Project
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Or ask your team admin to invite you to existing projects
                      </p>
                    </div>}
                </CardContent>
              </Card>}
          </div>
        </main>
      </div>
    </div>;
}