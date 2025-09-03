import { StatsCard } from "@/components/dashboard/stats-card";
import { FolderCard } from "@/components/dashboard/folder-card";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Sidebar } from "@/components/layout/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  FolderOpen, 
  CheckSquare, 
  Target, 
  TrendingUp, 
  Clock,
  CheckCircle,
  AlertCircle,
  Plus
} from "lucide-react";

const mockFolders = [
  {
    id: "1",
    name: "E-commerce Platform Testing",
    description: "Comprehensive testing suite for the new e-commerce platform including checkout flow, user authentication, and payment processing.",
    status: "active" as const,
    suites: 12,
    testCases: 247,
    coverage: 89,
    lastActivity: "2 hours ago",
    members: 5
  },
  {
    id: "2", 
    name: "Mobile App Security Testing",
    description: "Security-focused testing for the mobile application with emphasis on authentication and data protection.",
    status: "active" as const,
    suites: 8,
    testCases: 156,
    coverage: 92,
    lastActivity: "1 day ago",
    members: 3
  },
  {
    id: "3",
    name: "API Integration Testing",
    description: "Testing suite for third-party API integrations and microservices communication.",
    status: "completed" as const,
    suites: 15,
    testCases: 389,
    coverage: 95,
    lastActivity: "3 days ago",
    members: 7
  },
  {
    id: "4",
    name: "Performance Testing Suite",
    description: "Load and performance testing for critical user journeys and system bottlenecks.",
    status: "draft" as const,
    suites: 3,
    testCases: 67,
    coverage: 45,
    lastActivity: "1 week ago", 
    members: 2
  }
];

const recentActivity = [
  { id: "1", type: "suite_completed", message: "E-commerce Checkout Suite completed", time: "2 hours ago" },
  { id: "2", type: "test_case_added", message: "15 new test cases added to Security Testing", time: "4 hours ago" },
  { id: "3", type: "coverage_improved", message: "API Testing coverage increased to 95%", time: "6 hours ago" },
  { id: "4", type: "folder_created", message: "New Performance Testing folder created", time: "1 day ago" }
];

export default function Dashboard() {
  return (
    <div className="flex h-screen bg-workspace-bg">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader />
        
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatsCard
              title="Total Folders"
              value="24"
              description="4 active folders"
              icon={FolderOpen}
              trend={{ value: 12, label: "this month" }}
            />
            <StatsCard
              title="Test Suites"
              value="156"
              description="38 suites running"
              icon={CheckSquare}
              trend={{ value: 8, label: "this week" }}
            />
            <StatsCard
              title="Test Cases"
              value="2,847"
              description="859 cases generated"
              icon={Target}
              trend={{ value: 23, label: "this month" }}
            />
            <StatsCard
              title="Avg Coverage"
              value="87%"
              description="↑ 5% from last month"
              icon={TrendingUp}
              trend={{ value: 5, label: "improvement" }}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Projects Grid */}
          <div className="lg:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-foreground">Recent Folders</h2>
                <Button variant="outline" size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  View All
                </Button>
              </div>
              
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {mockFolders.map((folder) => (
                  <FolderCard key={folder.id} folder={folder} />
                ))}
              </div>
            </div>

            {/* Activity Feed */}
            <div className="space-y-6">
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {recentActivity.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-3">
                      <div className="mt-1">
                        {activity.type === "suite_completed" && <CheckCircle className="h-4 w-4 text-success" />}
                        {activity.type === "test_case_added" && <Plus className="h-4 w-4 text-primary" />}
                        {activity.type === "coverage_improved" && <TrendingUp className="h-4 w-4 text-secondary" />}
                        {activity.type === "folder_created" && <FolderOpen className="h-4 w-4 text-warning" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-card-foreground">{activity.message}</p>
                        <p className="text-xs text-muted-foreground">{activity.time}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-warning" />
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <Plus className="h-4 w-4" />
                    Create New Folder
                  </Button>
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <CheckSquare className="h-4 w-4" />
                    Start Test Suite
                  </Button>
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <Target className="h-4 w-4" />
                    Generate Test Cases
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}