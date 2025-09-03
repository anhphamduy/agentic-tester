import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Sidebar } from "@/components/layout/sidebar";
import { supabase } from "@/supabase_client";
import { useToast } from "@/components/ui/use-toast";
import { 
  Upload, 
  Search, 
  FileText, 
  Trash2, 
  Eye,
  Calendar,
  User,
  ArrowLeft
} from "lucide-react";

interface ReferenceFile {
  id: string;
  name: string;
  type: string;
  category: "system-description" | "design-pattern" | "domain-glossary" | "other";
  uploadedBy: string;
  uploadedAt: string;
  size: string;
  analyzed: boolean;
  path?: string;
}

const mockFiles: ReferenceFile[] = [
  {
    id: "1",
    name: "Banking System Architecture.pdf",
    type: "pdf",
    category: "system-description",
    uploadedBy: "John Doe",
    uploadedAt: "2024-01-15",
    size: "2.3 MB",
    analyzed: true
  },
  {
    id: "2", 
    name: "API Design Patterns.docx",
    type: "docx",
    category: "design-pattern",
    uploadedBy: "Jane Smith",
    uploadedAt: "2024-01-12",
    size: "1.8 MB",
    analyzed: true
  },
  {
    id: "3",
    name: "Financial Domain Glossary.xlsx",
    type: "xlsx", 
    category: "domain-glossary",
    uploadedBy: "Mike Johnson",
    uploadedAt: "2024-01-10",
    size: "945 KB",
    analyzed: false
  },
  {
    id: "4",
    name: "User Authentication Flow.pdf",
    type: "pdf",
    category: "system-description",
    uploadedBy: "Sarah Wilson",
    uploadedAt: "2024-01-20",
    size: "1.5 MB",
    analyzed: true
  },
  {
    id: "5",
    name: "Microservices Design Patterns.pdf",
    type: "pdf",
    category: "design-pattern",
    uploadedBy: "David Chen",
    uploadedAt: "2024-01-18",
    size: "3.2 MB",
    analyzed: true
  },
  {
    id: "6",
    name: "Payment Processing Glossary.docx",
    type: "docx",
    category: "domain-glossary",
    uploadedBy: "Emily Rodriguez",
    uploadedAt: "2024-01-17",
    size: "875 KB",
    analyzed: false
  },
  {
    id: "7",
    name: "Database Schema Design.sql",
    type: "sql",
    category: "system-description",
    uploadedBy: "Alex Thompson",
    uploadedAt: "2024-01-16",
    size: "1.2 MB",
    analyzed: true
  },
  {
    id: "8",
    name: "REST API Guidelines.md",
    type: "md",
    category: "design-pattern",
    uploadedBy: "Maria Garcia",
    uploadedAt: "2024-01-14",
    size: "425 KB",
    analyzed: true
  },
  {
    id: "9",
    name: "Security Requirements.pdf",
    type: "pdf",
    category: "other",
    uploadedBy: "Robert Lee",
    uploadedAt: "2024-01-13",
    size: "2.8 MB",
    analyzed: false
  },
  {
    id: "10",
    name: "Business Process Diagram.vsdx",
    type: "vsdx",
    category: "system-description",
    uploadedBy: "Lisa Anderson",
    uploadedAt: "2024-01-11",
    size: "1.9 MB",
    analyzed: true
  },
  {
    id: "11",
    name: "Event-Driven Architecture.pptx",
    type: "pptx",
    category: "design-pattern",
    uploadedBy: "Kevin Zhang",
    uploadedAt: "2024-01-09",
    size: "4.1 MB",
    analyzed: false
  },
  {
    id: "12",
    name: "Healthcare Domain Terms.xlsx",
    type: "xlsx",
    category: "domain-glossary",
    uploadedBy: "Jennifer Brown",
    uploadedAt: "2024-01-08",
    size: "1.1 MB",
    analyzed: true
  },
  {
    id: "13",
    name: "CI-CD Pipeline Configuration.yaml",
    type: "yaml",
    category: "other",
    uploadedBy: "Michael Davis",
    uploadedAt: "2024-01-07",
    size: "156 KB",
    analyzed: true
  },
  {
    id: "14",
    name: "CQRS Implementation Guide.pdf",
    type: "pdf",
    category: "design-pattern",
    uploadedBy: "Angela White",
    uploadedAt: "2024-01-06",
    size: "2.7 MB",
    analyzed: false
  },
  {
    id: "15",
    name: "E-commerce System Overview.docx",
    type: "docx",
    category: "system-description",
    uploadedBy: "Thomas Miller",
    uploadedAt: "2024-01-05",
    size: "1.6 MB",
    analyzed: true
  },
  {
    id: "16",
    name: "Retail Business Glossary.pdf",
    type: "pdf",
    category: "domain-glossary",
    uploadedBy: "Rachel Green",
    uploadedAt: "2024-01-04",
    size: "987 KB",
    analyzed: false
  },
  {
    id: "17",
    name: "Container Orchestration Guide.md",
    type: "md",
    category: "other",
    uploadedBy: "Daniel Kim",
    uploadedAt: "2024-01-03",
    size: "678 KB",
    analyzed: true
  },
  {
    id: "18",
    name: "Observer Pattern Examples.java",
    type: "java",
    category: "design-pattern",
    uploadedBy: "Sophie Taylor",
    uploadedAt: "2024-01-02",
    size: "234 KB",
    analyzed: true
  }
];

const categoryLabels = {
  "system-description": "System Description",
  "design-pattern": "Design Pattern",
  "domain-glossary": "Domain Glossary",
  "other": "Other"
};

export default function ReferenceFiles() {
  const { toast } = useToast();
  const [files, setFiles] = useState<ReferenceFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const BUCKET = "test";
  const FOLDER = "upload";

  const formatBytes = (bytes?: number) => {
    if (!bytes || Number.isNaN(bytes)) return "-";
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(1)} ${sizes[i]}`;
  };

  const refreshList = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .storage
        .from(BUCKET)
        .list(FOLDER, { limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });

      if (error) throw error;

      const mapped: ReferenceFile[] = (data || []).filter((it) => it.name).map((it) => {
        const name = it.name as string;
        const ext = name.includes(".") ? (name.split(".").pop() || "").toLowerCase() : "";
        const size = (it.metadata as any)?.size as number | undefined;
        const updatedAt = (it.updated_at as string) || new Date().toISOString();
        return {
          id: `${FOLDER}/${name}`,
          name,
          type: ext,
          category: "other",
          uploadedBy: "Test Account",
          uploadedAt: updatedAt,
          size: formatBytes(size),
          analyzed: false,
          path: `${FOLDER}/${name}`,
        };
      });

      setFiles(mapped);
    } catch (err: any) {
      toast({ title: "Failed to load files", description: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshList();
  }, []);

  const onUploadClick = () => fileInputRef.current?.click();

  const handleUpload: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setIsUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const filePath = `${FOLDER}/${file.name}`;
        const { error } = await supabase
          .storage
          .from(BUCKET)
          .upload(filePath, file, { upsert: true, contentType: file.type || undefined });
        if (error) throw error;
      }
      toast({ title: "Upload complete" });
      await refreshList();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const viewFile = async (path: string) => {
    try {
      const { data, error } = await supabase
        .storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60);
      if (error) throw error;
      const url = data?.signedUrl;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({ title: "Unable to open file", description: err.message });
    }
  };

  const deleteFile = async (path: string) => {
    if (!confirm("Delete this file?")) return;
    try {
      const { error } = await supabase
        .storage
        .from(BUCKET)
        .remove([path]);
      if (error) throw error;
      toast({ title: "Deleted" });
      await refreshList();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message });
    }
  };
  
  // Determine which project context we came from
  const fromProject = searchParams.get('from') || 'my-space';
  const getProjectName = (projectId: string) => {
    switch (projectId) {
      case 'my-space': return 'My Space';
      case 'p1': return 'Project A';
      case 'p2': return 'Project B'; 
      case 'p3': return 'Project C';
      case 'p4': return 'Project D';
      default: return 'My Space';
    }
  };
  
  const getBackUrl = () => {
    return `/project/${fromProject}/folders`;
  };

  const filteredFiles = files.filter(file => {
    const matchesSearch = file.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         file.uploadedBy.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || file.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "system-description": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "design-pattern": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "domain-glossary": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  return (
    <div className="flex h-screen bg-workspace-bg">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b border-border/50 bg-background">
          <div className="px-6 py-4">
            {/* Breadcrumb Navigation */}
            <div className="flex items-center gap-4 mb-4">
              <Button variant="ghost" size="sm" onClick={() => navigate(getBackUrl())} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to {getProjectName(fromProject)}
              </Button>
              
              <div className="border-l border-border/50 h-6" />
              
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink asChild>
                        <Link to="/projects">All Projects</Link>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbLink asChild>
                        <Link to={getBackUrl()}>{getProjectName(fromProject)}</Link>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage className="font-semibold">Uploaded Files</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
            </div>

            {/* Page Title */}
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h1 className="text-2xl font-semibold text-foreground leading-tight">Uploaded Files</h1>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  Upload and manage system documentation for AI-powered testing insights
                </p>
              </div>
              
              <Button className="gap-2 self-start" onClick={onUploadClick} disabled={isUploading}>
                <Upload className="h-4 w-4" />
                {isUploading ? "Uploading..." : "Upload Files"}
              </Button>
              <input ref={fileInputRef} type="file" multiple onChange={handleUpload} className="hidden" />
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Search and Filters */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search files..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All Categories</option>
              <option value="system-description">System Description</option>
              <option value="design-pattern">Design Pattern</option>
              <option value="domain-glossary">Domain Glossary</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Files Table */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                )}
                {!isLoading && filteredFiles.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-primary flex-shrink-0" />
                        <div>
                          <div className="font-medium">{file.name}</div>
                          <div className="text-sm text-muted-foreground">{file.type.toUpperCase()}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${getCategoryColor(file.category)}`}>
                        {categoryLabels[file.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{file.size}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{file.uploadedBy}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{new Date(file.uploadedAt).toLocaleDateString()}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={file.analyzed ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {file.analyzed ? "Analyzed" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => void viewFile(file.path || file.id)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void deleteFile(file.path || file.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {!isLoading && filteredFiles.length === 0 && (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No files found</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm || selectedCategory !== "all" 
                  ? "Try adjusting your search or filters"
                  : "Upload your first reference file to get started"
                }
              </p>
              {(!searchTerm && selectedCategory === "all") && (
                <Button onClick={onUploadClick} disabled={isUploading}>
                  <Upload className="h-4 w-4 mr-2" />
                  {isUploading ? "Uploading..." : "Upload Files"}
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}