import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, PaginationEllipsis } from "@/components/ui/pagination";
import { Sidebar } from "@/components/layout/sidebar";
import { 
  Search, 
  CheckSquare, 
  Plus, 
  Calendar,
  User,
  Play,
  Settings,
  MoreVertical,
  CheckCircle,
  XCircle,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from "lucide-react";
import { Link } from "react-router-dom";

interface TestSuite {
  id: string;
  name: string;
  description: string;
  project: string;
  projectId: string;
  folder: string;
  status: "active" | "draft" | "archived" | "completed";
  testCases: number;
  coverage: number;
  lastRun: string;
  lastModified: string;
  createdBy: string;
  createdAt: string;
}

const mockTestSuites: TestSuite[] = [
  {
    id: "1",
    name: "User Management",
    description: "User account and profile testing",
    project: "Project A",
    projectId: "p1",
    folder: "Core Features",
    status: "active",
    testCases: 45,
    coverage: 92,
    lastRun: "2024-01-20",
    lastModified: "2024-01-20",
    createdBy: "You",
    createdAt: "2024-01-15"
  },
  {
    id: "2", 
    name: "Navigation Tests",
    description: "Menu and routing functionality",
    project: "Project A",
    projectId: "p1",
    folder: "User Interface",
    status: "active",
    testCases: 28,
    coverage: 98,
    lastRun: "2024-01-19",
    lastModified: "2024-01-19",
    createdBy: "You",
    createdAt: "2024-01-12"
  },
  {
    id: "3",
    name: "Login Flow",
    description: "User authentication process",
    project: "Project B",
    projectId: "p2",
    folder: "Authentication",
    status: "active",
    testCases: 32,
    coverage: 96,
    lastRun: "2024-01-18",
    lastModified: "2024-01-18",
    createdBy: "You",
    createdAt: "2024-01-10"
  },
  {
    id: "4",
    name: "Endpoint Validation",
    description: "API endpoint functionality tests",
    project: "Project C",
    projectId: "p3",
    folder: "API Testing",
    status: "draft",
    testCases: 20,
    coverage: 45,
    lastRun: "2024-01-05",
    lastModified: "2024-01-05",
    createdBy: "You",
    createdAt: "2024-01-01"
  },
  {
    id: "5",
    name: "Feature Testing",
    description: "Core feature validation",
    project: "Project D",
    projectId: "sp1",
    folder: "Core Features",
    status: "active",
    testCases: 34,
    coverage: 87,
    lastRun: "2024-01-21",
    lastModified: "2024-01-21",
    createdBy: "John Doe",
    createdAt: "2024-01-14"
  },
  {
    id: "6",
    name: "UI Components",
    description: "Component library testing",
    project: "Project E",
    projectId: "sp2",
    folder: "User Interface",
    status: "active",
    testCases: 28,
    coverage: 92,
    lastRun: "2024-01-20",
    lastModified: "2024-01-20",
    createdBy: "Emma Davis",
    createdAt: "2024-01-08"
  },
  {
    id: "7",
    name: "Core Testing Suite",
    description: "Main application functionality tests",
    project: "My Space",
    projectId: "my-space",
    folder: "Personal Projects",
    status: "active",
    testCases: 47,
    coverage: 89,
    lastRun: "2024-01-21",
    lastModified: "2024-01-21",
    createdBy: "You",
    createdAt: "2024-01-10"
  },
  {
    id: "8",
    name: "API Testing Practice",
    description: "Learning REST API testing techniques",
    project: "My Space",
    projectId: "my-space",
    folder: "Learning & Practice",
    status: "active",
    testCases: 67,
    coverage: 78,
    lastRun: "2024-01-20",
    lastModified: "2024-01-20",
    createdBy: "You",
    createdAt: "2024-01-05"
  },
  {
    id: "9",
    name: "Authentication Security",
    description: "User authentication and authorization tests",
    project: "My Space",
    projectId: "my-space",
    folder: "Security Testing",
    status: "draft",
    testCases: 23,
    coverage: 45,
    lastRun: "2024-01-15",
    lastModified: "2024-01-15",
    createdBy: "You",
    createdAt: "2024-01-01"
  },
  {
    id: "10",
    name: "Database Testing",
    description: "Database operations and integrity tests",
    project: "Project F",
    projectId: "sp3",
    folder: "Database Testing",
    status: "completed",
    testCases: 89,
    coverage: 96,
    lastRun: "2024-01-18",
    lastModified: "2024-01-18",
    createdBy: "David Rodriguez",
    createdAt: "2024-01-01"
  },
  {
    id: "11",
    name: "Component Validation",
    description: "Component library testing and validation",
    project: "Project G",
    projectId: "sp4",
    folder: "UI Components",
    status: "active",
    testCases: 56,
    coverage: 84,
    lastRun: "2024-01-21",
    lastModified: "2024-01-21",
    createdBy: "Maria Garcia",
    createdAt: "2024-01-08"
  },
  {
    id: "12",
    name: "iOS Functionality",
    description: "iOS specific functionality testing",
    project: "Project E",
    projectId: "sp2",
    folder: "iOS Testing",
    status: "active",
    testCases: 43,
    coverage: 91,
    lastRun: "2024-01-20",
    lastModified: "2024-01-20",
    createdBy: "Alex Kumar",
    createdAt: "2024-01-06"
  }
];

export default function TestSuites() {
  const [testSuites] = useState<TestSuite[]>(mockTestSuites);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<keyof TestSuite>("lastModified");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const filteredAndSortedSuites = testSuites
    .filter(suite => {
      const matchesSearch = suite.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           suite.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           suite.project.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           suite.folder.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    })
    .sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];
      
      if (sortDirection === "asc") {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

  // Pagination logic
  const totalPages = Math.ceil(filteredAndSortedSuites.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedSuites = filteredAndSortedSuites.slice(startIndex, endIndex);

  // Reset to first page when search changes
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleSort = (field: keyof TestSuite) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (field: keyof TestSuite) => {
    if (sortField !== field) return <ArrowUpDown className="h-4 w-4" />;
    return sortDirection === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "draft": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "completed": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "archived": return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active": return <CheckCircle className="h-3 w-3" />;
      case "draft": return <Clock className="h-3 w-3" />;
      case "completed": return <CheckCircle className="h-3 w-3" />;
      case "archived": return <XCircle className="h-3 w-3" />;
      default: return <Clock className="h-3 w-3" />;
    }
  };

  const getCoverageColor = (coverage: number) => {
    if (coverage >= 80) return "text-green-600 dark:text-green-400";
    if (coverage >= 60) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getProjectLink = (projectId: string) => {
    if (projectId === "my-space") {
      return "/project/my-space/folders";
    }
    return `/project/${projectId}/folders`;
  };

  return (
    <div className="flex h-screen bg-workspace-bg">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b border-border/50 bg-background h-20">
          <div className="flex items-start justify-between px-6 py-5">
            <div className="flex-1">
              <h1 className="text-2xl font-semibold text-foreground leading-tight">Test Suites</h1>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                Manage and execute your test suites across all projects
              </p>
            </div>
            
            <Button asChild className="self-start">
              <Link to="/create-suite" className="gap-2">
                <Plus className="h-4 w-4" />
                New Test Suite
              </Link>
            </Button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Search and Filters */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search test suites..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Test Suites Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort("name")}
                  >
                    <div className="flex items-center gap-2">
                      Name
                      {getSortIcon("name")}
                    </div>
                  </TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Folder</TableHead>
                  <TableHead className="text-center">Test Cases</TableHead>
                  <TableHead className="text-center">Coverage</TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort("lastModified")}
                  >
                    <div className="flex items-center gap-2">
                      Last Modified
                      {getSortIcon("lastModified")}
                    </div>
                  </TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSuites.map((suite) => (
                  <TableRow key={suite.id} className="hover:bg-muted/50">
                    <TableCell>
                      <div>
                        <div className="font-medium">{suite.name}</div>
                        <div className="text-sm text-muted-foreground line-clamp-1">
                          {suite.description}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link 
                        to={getProjectLink(suite.projectId)} 
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {suite.project}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{suite.folder}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-medium">{suite.testCases}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`font-medium ${getCoverageColor(suite.coverage)}`}>
                        {suite.coverage}%
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {new Date(suite.lastModified).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{suite.createdBy}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/suite/${suite.id}`}>
                            Open
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex justify-center">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  
                  {/* Page numbers */}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNumber;
                    if (totalPages <= 5) {
                      pageNumber = i + 1;
                    } else if (currentPage <= 3) {
                      pageNumber = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNumber = totalPages - 4 + i;
                    } else {
                      pageNumber = currentPage - 2 + i;
                    }
                    
                    return (
                      <PaginationItem key={pageNumber}>
                        <PaginationLink
                          onClick={() => setCurrentPage(pageNumber)}
                          isActive={currentPage === pageNumber}
                          className="cursor-pointer"
                        >
                          {pageNumber}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}
                  
                  {totalPages > 5 && currentPage < totalPages - 2 && (
                    <>
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationLink
                          onClick={() => setCurrentPage(totalPages)}
                          className="cursor-pointer"
                        >
                          {totalPages}
                        </PaginationLink>
                      </PaginationItem>
                    </>
                  )}
                  
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}

          {filteredAndSortedSuites.length === 0 && (
            <div className="text-center py-12">
              <CheckSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No test suites found</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm 
                  ? "Try adjusting your search"
                  : "Create your first test suite to get started"
                }
              </p>
              {!searchTerm && (
                <Button asChild>
                  <Link to="/create-suite">
                    <Plus className="h-4 w-4 mr-2" />
                    New Test Suite
                  </Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}