import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sidebar } from "@/components/layout/sidebar";
import { CreateSuiteModal } from "@/components/ui/create-suite-modal";
import { 
  FolderOpen, 
  CheckSquare, 
  Plus, 
  Search,
  MoreHorizontal,
  Calendar,
  Users
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { supabase } from "@/supabase_client";
import { useToast } from "@/hooks/use-toast";

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

const mockFolders: Folder[] = [
  {
    id: "1",
    name: "E-commerce Platform",
    description: "Testing suite for the main e-commerce application",
    lastActivity: "2 hours ago",
    suites: [
      {
        id: "s1",
        name: "Authentication & Login",
        description: "User authentication and login functionality tests",
        status: "active",
        testCases: 47,
        coverage: 89,
        lastActivity: "2 hours ago",
        folderId: "1"
      },
      {
        id: "s2", 
        name: "Checkout Flow",
        description: "End-to-end checkout process validation",
        status: "completed",
        testCases: 123,
        coverage: 95,
        lastActivity: "1 day ago",
        folderId: "1"
      }
    ]
  },
  {
    id: "2",
    name: "Mobile App Testing",
    description: "Testing suite for mobile applications",
    lastActivity: "1 day ago",
    suites: [
      {
        id: "s3",
        name: "Security Testing",
        description: "Security-focused testing for mobile app",
        status: "active",
        testCases: 67,
        coverage: 78,
        lastActivity: "6 hours ago",
        folderId: "2"
      }
    ]
  },
  {
    id: "3",
    name: "API Integration",
    description: "Third-party API and microservices testing",
    lastActivity: "3 days ago",
    suites: [
      {
        id: "s4",
        name: "Payment Gateway",
        description: "Payment processing API tests",
        status: "draft",
        testCases: 23,
        coverage: 45,
        lastActivity: "1 week ago",
        folderId: "3"
      }
    ]
  }
];

export default function MySpace() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["1"]));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<{ id?: string; name?: string }>({});

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
      case "active": return "bg-success text-success-foreground";
      case "completed": return "bg-muted text-muted-foreground";
      case "draft": return "bg-warning text-warning-foreground";
      default: return "bg-muted text-muted-foreground";
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
          project_id: "global",
          created_by: userId,
        })
        .select("id")
        .single();

      if (error) throw error;

      const suiteId = data?.id;
      navigate(`/create-suite?name=${encodeURIComponent(suiteName)}&folder=${folderId || ''}${suiteId ? `&suiteId=${suiteId}` : ''}`);
    } catch (err: any) {
      toast({ title: "Failed to create suite", description: err.message, variant: "destructive" });
    }
  };

  const openModalForFolder = (folderId?: string, folderName?: string) => {
    setSelectedFolder({ id: folderId, name: folderName });
    setIsModalOpen(true);
  };

  const filteredFolders = mockFolders.filter(folder =>
    folder.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    folder.suites.some(suite => suite.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex h-screen bg-workspace-bg">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="p-6 bg-background border-b border-border/50">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Space</h1>
            <p className="text-muted-foreground">Your private folders and test suites</p>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Search and Actions Bar */}
            <div className="flex items-center justify-between gap-4 bg-background/50 p-4 rounded-lg border border-border/50">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search folders and suites..." 
                  className="pl-10 bg-background border-border/50 focus:border-primary/50"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              
              <Button 
                onClick={() => openModalForFolder()}
                className="gap-2 bg-gradient-to-r from-primary to-secondary hover:from-primary-hover hover:to-secondary-hover shadow-sm"
              >
                <Plus className="h-4 w-4" />
                New Test Suite
              </Button>
            </div>
            {filteredFolders.length === 0 && (
              <div className="text-center py-12">
                <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">No folders found</h3>
                <p className="text-muted-foreground">Try adjusting your search or create a new test suite</p>
              </div>
            )}

            {filteredFolders.map((folder) => (
              <Card key={folder.id} className="border-border/50 shadow-sm">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div 
                      className="flex items-center gap-4 cursor-pointer flex-1"
                      onClick={() => toggleFolder(folder.id)}
                    >
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
                          <span>{folder.suites.length} suites</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>{folder.lastActivity}</span>
                        </div>
                      </div>
                      
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {expandedFolders.has(folder.id) && (
                  <CardContent className="pt-0">
                    <div className="grid gap-3">
                      {folder.suites.map((suite) => (
                        <div
                          key={suite.id}
                          className="flex items-center justify-between p-4 rounded-lg border border-border/30 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => navigate(`/suite/${suite.id}`)}
                        >
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
                        </div>
                      ))}
                      
                      <Button 
                        variant="outline" 
                        className="mt-2 gap-2 border-dashed"
                        onClick={() => openModalForFolder(folder.id, folder.name)}
                      >
                        <Plus className="h-4 w-4" />
                        Add New Suite to {folder.name}
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </main>
      </div>

      <CreateSuiteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateSuite={handleCreateSuite}
        selectedFolderId={selectedFolder.id}
        selectedFolderName={selectedFolder.name}
      />
    </div>
  );
}