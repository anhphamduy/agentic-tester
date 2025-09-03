import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Search,
  Users,
  CheckSquare,
  Target,
  Clock,
  UserPlus,
  Settings,
  MoreHorizontal,
  Crown,
  Shield,
  Eye
} from "lucide-react";

interface SharedProject {
  id: string;
  name: string;
  description: string;
  role: 'owner' | 'admin' | 'collaborator' | 'viewer';
  status: 'active' | 'completed' | 'archived';
  members: number;
  testSuites: number;
  testCases: number;
  coverage: number;
  lastActivity: string;
  owner: {
    name: string;
    avatar?: string;
    initials: string;
  };
  recentCollaborators: Array<{
    name: string;
    avatar?: string;
    initials: string;
  }>;
}

const mockSharedProjects: SharedProject[] = [
  {
    id: "sp1",
    name: "E-commerce Platform",
    description: "Comprehensive testing for the main e-commerce application",
    role: "admin",
    status: "active",
    members: 8,
    testSuites: 15,
    testCases: 342,
    coverage: 87,
    lastActivity: "1 hour ago",
    owner: {
      name: "Sarah Chen",
      initials: "SC"
    },
    recentCollaborators: [
      { name: "John Doe", initials: "JD" },
      { name: "Mike Johnson", initials: "MJ" },
      { name: "Lisa Wang", initials: "LW" }
    ]
  },
  {
    id: "sp2",
    name: "Mobile App Testing",
    description: "Cross-platform mobile application testing suite",
    role: "collaborator",
    status: "active",
    members: 5,
    testSuites: 8,
    testCases: 156,
    coverage: 92,
    lastActivity: "3 hours ago",
    owner: {
      name: "Alex Kumar",
      initials: "AK"
    },
    recentCollaborators: [
      { name: "Emma Davis", initials: "ED" },
      { name: "Tom Wilson", initials: "TW" }
    ]
  },
  {
    id: "sp3",
    name: "API Integration Tests",
    description: "Testing suite for microservices and API endpoints",
    role: "viewer",
    status: "completed",
    members: 12,
    testSuites: 22,
    testCases: 445,
    coverage: 95,
    lastActivity: "2 days ago",
    owner: {
      name: "David Rodriguez",
      initials: "DR"
    },
    recentCollaborators: [
      { name: "Anna Lee", initials: "AL" },
      { name: "Chris Brown", initials: "CB" }
    ]
  }
];

export function SharedProjectsContent() {
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "owner":
        return <Crown className="h-3 w-3" />;
      case "admin":
        return <Shield className="h-3 w-3" />;
      case "collaborator":
        return <Users className="h-3 w-3" />;
      case "viewer":
        return <Eye className="h-3 w-3" />;
      default:
        return <Users className="h-3 w-3" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-warning text-warning-foreground";
      case "admin":
        return "bg-primary text-primary-foreground";
      case "collaborator":
        return "bg-secondary text-secondary-foreground";
      case "viewer":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-success text-success-foreground";
      case "completed":
        return "bg-primary text-primary-foreground";
      case "archived":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const filteredProjects = mockSharedProjects.filter(project =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Search and Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search shared projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" className="gap-2">
          <UserPlus className="h-4 w-4" />
          Join Project
        </Button>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredProjects.map((project) => (
          <Card 
            key={project.id} 
            className="border-border/50 hover:border-primary/20 transition-colors cursor-pointer"
            onClick={() => navigate(`/suite/${project.id}`)}
          >
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    <Badge className={getStatusColor(project.status)} variant="secondary">
                      {project.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{project.description}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Project Stats */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="flex items-center justify-center gap-1 text-sm font-medium">
                    <CheckSquare className="h-3 w-3" />
                    {project.testSuites}
                  </div>
                  <p className="text-xs text-muted-foreground">Suites</p>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1 text-sm font-medium">
                    <Target className="h-3 w-3" />
                    {project.testCases}
                  </div>
                  <p className="text-xs text-muted-foreground">Cases</p>
                </div>
                <div>
                  <div className="text-sm font-medium">{project.coverage}%</div>
                  <p className="text-xs text-muted-foreground">Coverage</p>
                </div>
              </div>

              {/* Coverage Progress */}
              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-muted-foreground">Test Coverage</span>
                  <span>{project.coverage}%</span>
                </div>
                <Progress value={project.coverage} className="h-2" />
              </div>

              {/* Team and Role Info */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    <Avatar className="h-6 w-6 border-2 border-background">
                      <AvatarFallback className="text-xs">{project.owner.initials}</AvatarFallback>
                    </Avatar>
                    {project.recentCollaborators.slice(0, 3).map((collaborator, index) => (
                      <Avatar key={index} className="h-6 w-6 border-2 border-background">
                        <AvatarFallback className="text-xs">{collaborator.initials}</AvatarFallback>
                      </Avatar>
                    ))}
                    {project.members > 4 && (
                      <div className="h-6 w-6 bg-muted border-2 border-background rounded-full flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">+{project.members - 4}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{project.members} members</span>
                </div>

                <Badge className={getRoleColor(project.role)} variant="secondary">
                  <span className="flex items-center gap-1">
                    {getRoleIcon(project.role)}
                    {project.role}
                  </span>
                </Badge>
              </div>

              {/* Last Activity */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border/50">
                <Clock className="h-3 w-3" />
                Last activity {project.lastActivity}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredProjects.length === 0 && (
        <div className="text-center py-12">
          <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium mb-2">No shared projects found</h3>
          <p className="text-muted-foreground mb-4">
            {searchQuery ? "Try adjusting your search query." : "You haven't joined any shared projects yet."}
          </p>
          {!searchQuery && (
            <Button variant="outline" className="gap-2">
              <UserPlus className="h-4 w-4" />
              Join a Project
            </Button>
          )}
        </div>
      )}
    </div>
  );
}