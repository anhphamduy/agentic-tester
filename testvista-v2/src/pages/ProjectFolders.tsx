import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sidebar } from "@/components/layout/sidebar";
import { CreateSuiteModal } from "@/components/ui/create-suite-modal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { FolderOpen, CheckSquare, Plus, Search, MoreHorizontal, Calendar, ArrowLeft, FileText, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/supabase_client";
import { useToast } from "@/hooks/use-toast";
import { mockProjects } from "@/data/mockProjects";
interface TestSuite {
  id: string;
  name: string;
  description: string;
  status: "active" | "completed" | "draft";
  testCases: number;
  coverage: number;
  lastActivity: string;
  folderId: string;
}
interface Folder {
  id: string;
  name: string;
  description: string;
  suites: TestSuite[];
  lastActivity: string;
}

// Mock folder data for all projects
const getProjectFolders = (projectId: string): Folder[] => {
  if (projectId === "my-space") {
    return [{
      id: "1",
      name: "Personal Projects",
      description: "My individual testing projects and experiments",
      lastActivity: "2 hours ago",
      suites: [{
        id: "s1",
        name: "Core Testing Suite",
        description: "Main application functionality tests",
        status: "active",
        testCases: 47,
        coverage: 89,
        lastActivity: "2 hours ago",
        folderId: "1"
      }, {
        id: "s2",
        name: "User Interface Tests",
        description: "UI component and interaction validation",
        status: "completed",
        testCases: 123,
        coverage: 95,
        lastActivity: "1 day ago",
        folderId: "1"
      }]
    }, {
      id: "2",
      name: "Learning & Practice",
      description: "Educational testing projects and skill development",
      lastActivity: "1 day ago",
      suites: [{
        id: "s3",
        name: "API Testing Practice",
        description: "Learning REST API testing techniques",
        status: "active",
        testCases: 67,
        coverage: 78,
        lastActivity: "6 hours ago",
        folderId: "2"
      }]
    }, {
      id: "3",
      name: "Security Testing",
      description: "Security-focused test cases and vulnerability testing",
      lastActivity: "3 days ago",
      suites: [{
        id: "s4",
        name: "Authentication Security",
        description: "User authentication and authorization tests",
        status: "draft",
        testCases: 23,
        coverage: 45,
        lastActivity: "1 week ago",
        folderId: "3"
      }]
    }];
  }

  // Project A folders
  if (projectId === "p1") {
    return [{
      id: "f1",
      name: "Core Features",
      description: "Main application functionality",
      lastActivity: "2 hours ago",
      suites: [{
        id: "s10",
        name: "User Management",
        description: "User account and profile testing",
        status: "active",
        testCases: 45,
        coverage: 92,
        lastActivity: "2 hours ago",
        folderId: "f1"
      }, {
        id: "s11",
        name: "Data Processing",
        description: "Core data handling and validation",
        status: "active",
        testCases: 38,
        coverage: 87,
        lastActivity: "4 hours ago",
        folderId: "f1"
      }]
    }, {
      id: "f2",
      name: "User Interface",
      description: "Frontend components and interactions",
      lastActivity: "1 day ago",
      suites: [{
        id: "s12",
        name: "Navigation Tests",
        description: "Menu and routing functionality",
        status: "completed",
        testCases: 28,
        coverage: 98,
        lastActivity: "1 day ago",
        folderId: "f2"
      }, {
        id: "s13",
        name: "Form Validation",
        description: "Input validation and error handling",
        status: "active",
        testCases: 35,
        coverage: 85,
        lastActivity: "1 day ago",
        folderId: "f2"
      }]
    }, {
      id: "f3",
      name: "Integration",
      description: "External service integrations",
      lastActivity: "3 days ago",
      suites: [{
        id: "s14",
        name: "API Connections",
        description: "Third-party API integration tests",
        status: "draft",
        testCases: 10,
        coverage: 60,
        lastActivity: "3 days ago",
        folderId: "f3"
      }]
    }];
  }

  // Project B folders
  if (projectId === "p2") {
    return [{
      id: "f4",
      name: "Authentication",
      description: "User login and security features",
      lastActivity: "1 day ago",
      suites: [{
        id: "s15",
        name: "Login Flow",
        description: "User authentication process",
        status: "completed",
        testCases: 32,
        coverage: 96,
        lastActivity: "1 day ago",
        folderId: "f4"
      }, {
        id: "s16",
        name: "Password Security",
        description: "Password policies and security",
        status: "completed",
        testCases: 25,
        coverage: 94,
        lastActivity: "2 days ago",
        folderId: "f4"
      }]
    }, {
      id: "f5",
      name: "User Experience",
      description: "UI/UX testing and usability",
      lastActivity: "2 days ago",
      suites: [{
        id: "s17",
        name: "Accessibility Tests",
        description: "WCAG compliance and accessibility",
        status: "completed",
        testCases: 18,
        coverage: 100,
        lastActivity: "2 days ago",
        folderId: "f5"
      }, {
        id: "s18",
        name: "Responsive Design",
        description: "Mobile and desktop compatibility",
        status: "completed",
        testCases: 14,
        coverage: 89,
        lastActivity: "3 days ago",
        folderId: "f5"
      }]
    }];
  }

  // Project C folders
  if (projectId === "p3") {
    return [{
      id: "f6",
      name: "API Testing",
      description: "REST API and endpoint testing",
      lastActivity: "1 week ago",
      suites: [{
        id: "s19",
        name: "Endpoint Validation",
        description: "API endpoint functionality tests",
        status: "draft",
        testCases: 20,
        coverage: 45,
        lastActivity: "1 week ago",
        folderId: "f6"
      }]
    }, {
      id: "f7",
      name: "Security",
      description: "Security testing and vulnerability assessment",
      lastActivity: "2 weeks ago",
      suites: [{
        id: "s20",
        name: "Data Security",
        description: "Data protection and encryption tests",
        status: "draft",
        testCases: 14,
        coverage: 30,
        lastActivity: "2 weeks ago",
        folderId: "f7"
      }]
    }];
  }

  // Default mock data for shared projects
  return [{
    id: "f1",
    name: "Core Features",
    description: "Main functionality testing",
    lastActivity: "1 hour ago",
    suites: [{
      id: "s10",
      name: "Feature Testing",
      description: "Core feature validation",
      status: "active",
      testCases: 34,
      coverage: 87,
      lastActivity: "1 hour ago",
      folderId: "f1"
    }]
  }, {
    id: "f2",
    name: "User Interface",
    description: "Frontend and user experience testing",
    lastActivity: "3 hours ago",
    suites: [{
      id: "s11",
      name: "UI Components",
      description: "Component library testing",
      status: "active",
      testCases: 28,
      coverage: 92,
      lastActivity: "3 hours ago",
      folderId: "f2"
    }]
  }];
};
export default function ProjectFolders() {
  const {
    projectId
  } = useParams<{
    projectId: string;
  }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["1", "f1"]));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<{
    id?: string;
    name?: string;
  }>({});
  const project = mockProjects.find(p => p.id === projectId);
  const folders = getProjectFolders(projectId || "");

  // Pagination state for Personal Projects (my-space)
  const [personalSuites, setPersonalSuites] = useState<TestSuite[]>([]);
  const [totalSuites, setTotalSuites] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const pageSize = 10;
  const [loadingSuites, setLoadingSuites] = useState<boolean>(false);
  const totalPages = Math.max(1, Math.ceil(totalSuites / pageSize));

  useEffect(() => {
    // Reset page when navigating between projects
    setPage(1);
  }, [projectId]);

  useEffect(() => {
    const loadSuites = async () => {
      if (projectId !== "my-space") return;
      try {
        setLoadingSuites(true);
        const from = (page - 1) * pageSize;
        const to = page * pageSize - 1;
        const { data, error, count } = await supabase
          .from("test_suites")
          .select("id, name, description, status, updated_at, created_at", { count: "exact" })
          .eq("project_id", projectId)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .range(from, to);

        if (error) throw error;

        const mapped: TestSuite[] = (data || []).map((row: any) => ({
          id: row.id,
          name: row.name || "Untitled Suite",
          description: row.description || "",
          status: (row.status as "active" | "completed" | "draft") || "draft",
          testCases: 0,
          coverage: 0,
          lastActivity: row.updated_at || row.created_at || "",
          folderId: "1",
        }));

        setPersonalSuites(mapped);
        setTotalSuites(count || 0);
      } catch (err: any) {
        toast({ title: "Failed to load suites", description: err.message, variant: "destructive" });
      } finally {
        setLoadingSuites(false);
      }
    };

    loadSuites();
  }, [projectId, page]);

  // Merge fetched suites into Personal Projects folder when in my-space
  const mergedFolders = projectId === "my-space"
    ? folders.map(f => f.id === "1" ? { ...f, suites: personalSuites } : f)
    : folders;
  const toggleFolder = (folderId: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };
  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-success text-success-foreground";
      case "completed":
        return "bg-muted text-muted-foreground";
      case "draft":
        return "bg-warning text-warning-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };
  const handleCreateSuite = async (suiteName: string, folderId?: string) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;

      const { data, error } = await supabase
        .from("test_suites")
        .insert({
          name: suiteName,
          description: "",
          status: "draft",
          folder_id: folderId || null,
          project_id: projectId || "global",
          created_by: userId,
        })
        .select("id")
        .single();

      if (error) throw error;

      const suiteId = data?.id;
      navigate(`/create-suite?name=${encodeURIComponent(suiteName)}&folder=${folderId || ''}&project=${projectId}${suiteId ? `&suiteId=${suiteId}` : ''}`);
    } catch (err: any) {
      toast({ title: "Failed to create suite", description: err.message, variant: "destructive" });
    }
  };
  const openModalForFolder = (folderId?: string, folderName?: string) => {
    setSelectedFolder({
      id: folderId,
      name: folderName
    });
    setIsModalOpen(true);
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      // Here you would typically call an API to create the folder
      console.log("Creating folder:", newFolderName);
      setIsFolderDialogOpen(false);
      setNewFolderName("");
      // You could show a toast notification here
    }
  };

  const filteredFolders = mergedFolders.filter(folder => folder.name.toLowerCase().includes(searchQuery.toLowerCase()) || folder.suites.some(suite => suite.name.toLowerCase().includes(searchQuery.toLowerCase())));
  const startItem = totalSuites === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalSuites);
  if (!project) {
    return <div className="flex h-screen bg-workspace-bg">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground mb-2">Project Not Found</h2>
            <Button onClick={() => navigate('/projects')}>Back to Projects</Button>
          </div>
        </div>
      </div>;
  }
  return <div className="flex h-screen bg-workspace-bg">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="p-6 bg-background border-b border-border/50">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/projects')} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </Button>
            
            <div className="border-l border-border/50 h-6" />
            
            <div className="flex-1">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/projects">All Projects</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="font-semibold">{project.name}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Search and Actions Bar */}
            <div className="flex items-center justify-between gap-4 bg-background/50 p-4 rounded-lg border border-border/50">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search folders and suites..." className="pl-10 bg-background border-border/50 focus:border-primary/50" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
              
              <Button onClick={() => openModalForFolder()} className="gap-2 bg-gradient-to-r from-primary to-secondary hover:from-primary-hover hover:to-secondary-hover shadow-sm">
                <Plus className="h-4 w-4" />
                New Test Suite
              </Button>
            </div>

            {/* Quick Access Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <Card className="border-border/50 hover:border-primary/20 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">Uploaded Files</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    Access your uploaded reference files and documents
                  </p>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/reference-files?from=${projectId}`)} className="w-full">
                    View Files
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border/50 hover:border-primary/20 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <BookOpen className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">Prompt Templates</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    Manage your reusable prompt templates
                  </p>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/standards?from=${projectId}`)} className="w-full">
                    View Templates
                  </Button>
                </CardContent>
              </Card>
            </div>
            {filteredFolders.length === 0 && <div className="text-center py-12">
                <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">No folders found</h3>
                <p className="text-muted-foreground">Try adjusting your search or create a new test suite</p>
              </div>}

            {filteredFolders.map(folder => <Card key={folder.id} className="border-border/50 shadow-sm">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 cursor-pointer flex-1" onClick={() => toggleFolder(folder.id)}>
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-5 w-5 text-primary" />
                        <div>
                          <h3 className="font-semibold text-lg text-card-foreground">{folder.name}</h3>
                          <p className="text-sm text-muted-foreground">{folder.description}</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-6 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <CheckSquare className="h-4 w-4" />
                          <span>{projectId === 'my-space' && folder.id === '1' ? totalSuites : folder.suites.length} suites</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>{folder.lastActivity}</span>
                        </div>
                      </div>
                      
                      <Dialog open={isFolderDialogOpen} onOpenChange={setIsFolderDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                          <DialogHeader>
                            <DialogTitle>Create New Folder</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <label htmlFor="folder-name" className="text-sm font-medium">
                                Folder Name
                              </label>
                              <Input
                                id="folder-name"
                                placeholder="Enter folder name..."
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleCreateFolder();
                                  }
                                }}
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="outline" 
                                onClick={() => {
                                  setIsFolderDialogOpen(false);
                                  setNewFolderName("");
                                }}
                              >
                                Cancel
                              </Button>
                              <Button 
                                onClick={handleCreateFolder}
                                disabled={!newFolderName.trim()}
                              >
                                Create Folder
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardHeader>

                {expandedFolders.has(folder.id) && <CardContent className="pt-0">
                    <div className="grid gap-3">
                      {loadingSuites && projectId === 'my-space' && folder.id === '1' && (
                        <div className="text-sm text-muted-foreground">Loading suites...</div>
                      )}
                      {folder.suites.map(suite => <div key={suite.id} className="flex items-center justify-between p-4 rounded-lg border border-border/30 hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => navigate(`/suite/${suite.id}`)}>
                          <div className="flex items-center gap-4">
                            <CheckSquare className="h-4 w-4 text-secondary" />
                            <div>
                              <h4 className="font-medium text-card-foreground">{suite.name}</h4>
                              <p className="text-sm text-muted-foreground">{suite.description}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4">
                            <div className="text-right text-sm">
                              <div className="font-medium">{suite.testCases} test cases</div>
                              <div className="text-muted-foreground">{suite.coverage}% coverage</div>
                            </div>
                            
                            <Badge className={getStatusColor(suite.status)}>
                              {suite.status}
                            </Badge>
                          </div>
                        </div>)}
                      
                      <Button variant="outline" className="mt-2 gap-2 border-dashed" onClick={() => openModalForFolder(folder.id, folder.name)}>
                        <Plus className="h-4 w-4" />
                        Add New Suite to {folder.name}
                      </Button>

                      {projectId === 'my-space' && folder.id === '1' && (
                        <div className="mt-2 flex items-center justify-between">
                          <div className="text-sm text-muted-foreground">
                            {loadingSuites ? 'Loading…' : `Showing ${startItem}-${endItem} of ${totalSuites}`}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPage(p => Math.max(1, p - 1))}
                              disabled={page <= 1 || loadingSuites}
                            >
                              Previous
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                              disabled={page >= totalPages || loadingSuites}
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>}
              </Card>)}
          </div>
        </main>
      </div>

      <CreateSuiteModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onCreateSuite={handleCreateSuite} selectedFolderId={selectedFolder.id} selectedFolderName={selectedFolder.name} />
    </div>;
}