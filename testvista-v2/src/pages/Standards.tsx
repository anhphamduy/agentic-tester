import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Sidebar } from "@/components/layout/sidebar";
import { 
  Search, 
  BookOpen, 
  Plus, 
  Calendar,
  User,
  Edit,
  Eye,
  Trash2,
  FileText,
  Download,
  Save,
  X
} from "lucide-react";

interface StandardTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  createdBy: string;
  createdAt: string;
  lastModified: string;
  tags: string[];
}

const mockTemplates: StandardTemplate[] = [
  {
    id: "1",
    name: "Test Case Prompt Template.md",
    description: "Standard template for generating comprehensive test cases with steps, expected results, and validation criteria",
    category: "test-case",
    content: `# Test Case Generation Template

## Context
- **Feature/Module**: [Specify the feature or module being tested]
- **User Story**: [Reference to user story or requirement]
- **Test Objective**: [What are we trying to validate]

## Test Case Structure
### Test Case ID: TC-[XXX]
### Title: [Descriptive test case title]
### Priority: [High/Medium/Low]
### Category: [Functional/Non-functional/Integration/etc.]

### Preconditions:
- [List any setup requirements]
- [System state requirements]
- [Data prerequisites]

### Test Steps:
1. [Step 1 - Action to perform]
2. [Step 2 - Action to perform]
3. [Step 3 - Action to perform]

### Expected Results:
- [Expected outcome for each step]
- [Final expected state]
- [Success criteria]

### Test Data:
- [Required test data]
- [Input values]
- [Configuration settings]

## Additional Considerations
- **Edge Cases**: [List edge cases to consider]
- **Negative Scenarios**: [Invalid inputs, error conditions]
- **Performance Criteria**: [If applicable]
- **Security Aspects**: [If applicable]`,
    createdBy: "John Doe",
    createdAt: "2024-01-15",
    lastModified: "2024-01-20",
    tags: ["test-case", "template", "standard"]
  },
  {
    id: "2",
    name: "Domain Common Viewpoint.md", 
    description: "Template for defining common viewpoints across different domains and business contexts",
    category: "viewpoint",
    content: `# Domain Common Viewpoint Template

## Viewpoint Definition
- **Viewpoint ID**: VP-[XXX]
- **Domain**: [Business domain - Banking, E-commerce, Healthcare, etc.]
- **Focus Area**: [Specific area within domain]

## Intent & Purpose
- **Testing Intent**: [What we're trying to achieve]
- **Business Impact**: [Why this viewpoint matters]
- **Risk Mitigation**: [What risks this viewpoint addresses]

## Data Variations
### Valid Data Scenarios:
- [Normal operational data]
- [Boundary conditions]
- [Business rule compliance]

### Invalid Data Scenarios:
- [Format violations]
- [Business rule violations]
- [Security violations]

## Test Conditions
- [Condition 1: Description]
- [Condition 2: Description]
- [Condition 3: Description]

## Domain-Specific Considerations
- [Regulatory requirements]
- [Industry standards]
- [Compliance requirements]
- [Security protocols]`,
    createdBy: "Jane Smith",
    createdAt: "2024-01-12",
    lastModified: "2024-01-18",
    tags: ["viewpoint", "domain", "business"]
  },
  {
    id: "3",
    name: "Test Scenario Template.md",
    description: "Template for defining test scenarios with specific context and conditions",
    category: "test-scenario",
    content: `# Test Scenario Template

## Scenario Overview
- **Scenario ID**: TS-[XXX]
- **Feature Area**: [Specify the feature or module]
- **Business Context**: [Real-world context this scenario represents]
- **Priority**: [High/Medium/Low]

## Scenario Description
### Background:
- [Context and setup for this scenario]
- [Business conditions that trigger this scenario]
- [User personas involved]

### Scenario Steps:
1. [Given: Initial conditions]
2. [When: Actions taken]
3. [Then: Expected outcomes]

## Test Conditions
### Positive Scenarios:
- [Valid business flow 1]
- [Valid business flow 2]
- [Edge case handling]

### Negative Scenarios:
- [Invalid input handling]
- [Error condition responses]
- [System failure recovery]

## Acceptance Criteria
- [Specific measurable outcome 1]
- [Specific measurable outcome 2]
- [Performance expectations]

## Dependencies & Prerequisites
- [System dependencies]
- [Data requirements]
- [External service availability]`,
    createdBy: "Mike Johnson",
    createdAt: "2024-01-10",
    lastModified: "2024-01-16",
    tags: ["test-scenario", "business", "context"]
  }
];

const defaultCategories = ["viewpoint", "test-case", "test-scenario"];

const categoryLabels: Record<string, string> = {
  "viewpoint": "Viewpoint",
  "test-case": "Test Case", 
  "test-scenario": "Test Scenario"
};

export default function Standards() {
  const [templates, setTemplates] = useState<StandardTemplate[]>(mockTemplates);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddCategoryDialogOpen, setIsAddCategoryDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<StandardTemplate | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<StandardTemplate | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newTemplate, setNewTemplate] = useState({
    name: "",
    description: "",
    category: "viewpoint",
    content: ""
  });

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         template.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === "all" || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const allCategories = [...defaultCategories, ...customCategories];

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "viewpoint": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "test-case": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "test-scenario": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const getCategoryLabel = (category: string) => {
    return categoryLabels[category] || category.charAt(0).toUpperCase() + category.slice(1);
  };

  const handleAddCategory = () => {
    if (newCategoryName.trim() && !allCategories.includes(newCategoryName.toLowerCase())) {
      const categoryKey = newCategoryName.toLowerCase().replace(/\s+/g, '-');
      setCustomCategories([...customCategories, categoryKey]);
      categoryLabels[categoryKey] = newCategoryName;
      setNewCategoryName("");
      setIsAddCategoryDialogOpen(false);
    }
  };

  const handleCreateTemplate = () => {
    if (newTemplate.name && newTemplate.content) {
      const template: StandardTemplate = {
        id: Date.now().toString(),
        ...newTemplate,
        name: newTemplate.name.endsWith('.md') ? newTemplate.name : `${newTemplate.name}.md`,
        createdBy: "Current User",
        createdAt: new Date().toISOString().split('T')[0],
        lastModified: new Date().toISOString().split('T')[0],
        tags: []
      };
      setTemplates([...templates, template]);
      setNewTemplate({ name: "", description: "", category: "viewpoint", content: "" });
      setIsCreateDialogOpen(false);
    }
  };

  const handleViewTemplate = (template: StandardTemplate) => {
    setSelectedTemplate(template);
    setIsViewDialogOpen(true);
  };

  const handleEditTemplate = (template: StandardTemplate) => {
    setEditingTemplate({ ...template });
    setIsEditDialogOpen(true);
    setIsViewDialogOpen(false); // Close view dialog if open
  };

  const handleSaveTemplate = () => {
    if (editingTemplate) {
      setTemplates(templates.map(t => 
        t.id === editingTemplate.id 
          ? { ...editingTemplate, lastModified: new Date().toISOString().split('T')[0] }
          : t
      ));
      setIsEditDialogOpen(false);
      setEditingTemplate(null);
    }
  };

  const handleCancelEdit = () => {
    setIsEditDialogOpen(false);
    setEditingTemplate(null);
  };

  const handleRemoveTemplate = (templateId: string) => {
    setTemplates(templates.filter(t => t.id !== templateId));
  };

  // Simple markdown to HTML converter for preview
  const markdownToHtml = (markdown: string) => {
    return markdown
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^\- (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[h|u|l])/gm, '<p>')
      .replace(/(?<![>])$/gm, '</p>');
  };

  return (
    <div className="flex h-screen bg-workspace-bg">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b border-border/50 bg-background h-20">
          <div className="flex items-start justify-between px-6 py-5">
            <div className="flex-1">
              <h1 className="text-2xl font-semibold text-foreground leading-tight">Prompt Templates</h1>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                Manage prompt templates and standardized documentation
              </p>
            </div>
            
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 self-start">
                  <Plus className="h-4 w-4" />
                  New Template
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Template</DialogTitle>
                  <DialogDescription>
                    Create a new prompt template for standardized documentation
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Template Name</label>
                    <Input
                      placeholder="e.g., API Testing Template.md"
                      value={newTemplate.name}
                      onChange={(e) => setNewTemplate({...newTemplate, name: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <Input
                      placeholder="Brief description of the template purpose"
                      value={newTemplate.description}
                      onChange={(e) => setNewTemplate({...newTemplate, description: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Category</label>
                    <select
                      value={newTemplate.category}
                      onChange={(e) => {
                        if (e.target.value === "add-new") {
                          setIsAddCategoryDialogOpen(true);
                        } else {
                          setNewTemplate({...newTemplate, category: e.target.value});
                        }
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {defaultCategories.map(cat => (
                        <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                      ))}
                      {customCategories.map(cat => (
                        <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                      ))}
                      <option value="add-new">+ Add New Category...</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Template Content (Markdown)</label>
                    <Textarea
                      placeholder="Enter your template content in Markdown format..."
                      value={newTemplate.content}
                      onChange={(e) => setNewTemplate({...newTemplate, content: e.target.value})}
                      className="min-h-[300px] font-mono"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateTemplate}>
                      Create Template
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Search and Filters */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
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
              {defaultCategories.map(cat => (
                <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
              ))}
              {customCategories.map(cat => (
                <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
              ))}
            </select>
          </div>

          {/* Templates Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((template) => (
              <Card key={template.id} className="group relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <FileText className="h-8 w-8 text-primary" />
                    <Badge className={`text-xs ${getCategoryColor(template.category)}`}>
                      {getCategoryLabel(template.category)}
                    </Badge>
                  </div>
                  
                  <div>
                    <CardTitle className="text-sm font-medium leading-tight">
                      {template.name}
                    </CardTitle>
                    <CardDescription className="text-xs mt-1 line-clamp-2">
                      {template.description}
                    </CardDescription>
                  </div>
                </CardHeader>
                
                <CardContent className="pt-0">
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <User className="h-3 w-3" />
                      <span>{template.createdBy}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3 w-3" />
                      <span>Modified: {new Date(template.lastModified).toLocaleDateString()}</span>
                    </div>
                  </div>
                  
                  <div className="mt-4 flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => handleViewTemplate(template)}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      View
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleEditTemplate(template)}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive-foreground hover:bg-destructive">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove Template</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to remove "{template.name}"? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => handleRemoveTemplate(template.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="text-center py-12">
              <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No templates found</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm || selectedCategory !== "all" 
                  ? "Try adjusting your search or filters"
                  : "Create your first template to get started"
                }
              </p>
              {(!searchTerm && selectedCategory === "all") && (
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Template
                </Button>
              )}
            </div>
          )}
        </div>
      </main>

      {/* View Template Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedTemplate?.name}</DialogTitle>
            <DialogDescription>
              {selectedTemplate?.description}
            </DialogDescription>
          </DialogHeader>
          {selectedTemplate && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <Badge className={`${getCategoryColor(selectedTemplate.category)}`}>
                  {getCategoryLabel(selectedTemplate.category)}
                </Badge>
                <span>Created by {selectedTemplate.createdBy}</span>
                <span>Last modified: {new Date(selectedTemplate.lastModified).toLocaleDateString()}</span>
              </div>
              <div className="border rounded-md p-6 bg-muted/20 max-h-96 overflow-y-auto">
                <div 
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ 
                    __html: markdownToHtml(selectedTemplate.content || '') 
                  }}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => handleEditTemplate(selectedTemplate)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button variant="outline">
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button onClick={() => setIsViewDialogOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Template Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Edit Template: {editingTemplate?.name}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveTemplate}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </DialogTitle>
            <DialogDescription>
              Edit template information and content with live preview
            </DialogDescription>
          </DialogHeader>
          {editingTemplate && (
            <div className="flex flex-col space-y-4 h-[calc(90vh-120px)]">
              {/* Template Info */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Template Name</label>
                  <Input
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      name: e.target.value
                    })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={editingTemplate.description}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      description: e.target.value
                    })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Category</label>
                  <select
                    value={editingTemplate.category}
                    onChange={(e) => {
                      if (e.target.value === "add-new") {
                        setIsAddCategoryDialogOpen(true);
                      } else {
                        setEditingTemplate({
                          ...editingTemplate,
                          category: e.target.value
                        });
                      }
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {defaultCategories.map(cat => (
                      <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                    ))}
                    {customCategories.map(cat => (
                      <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                    ))}
                    <option value="add-new">+ Add New Category...</option>
                  </select>
                </div>
              </div>

              {/* Side-by-side Editor */}
              <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
                {/* Editor Panel */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">Markdown Editor</h3>
                    <Badge variant="outline" className="text-xs">
                      Live editing
                    </Badge>
                  </div>
                  <Textarea
                    value={editingTemplate.content}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      content: e.target.value
                    })}
                    className="flex-1 font-mono text-sm resize-none"
                    placeholder="Enter your template content in Markdown format..."
                  />
                </div>

                {/* Preview Panel */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">Live Preview</h3>
                    <Badge variant="outline" className="text-xs">
                      Rendered
                    </Badge>
                  </div>
                  <div className="flex-1 border rounded-md p-4 bg-muted/20 overflow-y-auto">
                    <div 
                      className="prose prose-sm max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{ 
                        __html: markdownToHtml(editingTemplate.content || '') 
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={isAddCategoryDialogOpen} onOpenChange={setIsAddCategoryDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Category</DialogTitle>
            <DialogDescription>
              Create a new category for organizing your templates
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Category Name</label>
              <Input
                placeholder="e.g., Performance Testing"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => {
                setNewCategoryName("");
                setIsAddCategoryDialogOpen(false);
              }}>
                Cancel
              </Button>
              <Button onClick={handleAddCategory} disabled={!newCategoryName.trim()}>
                Add Category
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}