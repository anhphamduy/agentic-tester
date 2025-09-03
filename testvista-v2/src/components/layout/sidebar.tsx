import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { 
  LayoutDashboard, 
  FolderOpen, 
  CheckSquare, 
  Settings, 
  Users, 
  BookOpen,
  Plus,
  Bell,
  FileText,
  User,
  ChevronDown,
  ChevronRight,
  Share2
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

interface SidebarProps {
  className?: string;
}

interface NavigationItem {
  name: string;
  href: string;
  icon: any;
  children?: NavigationItem[];
}

const navigation: NavigationItem[] = [
  { 
    name: "All Projects", 
    href: "", // Pure container, not clickable
    icon: Users,
    children: [
      { name: "My Space", href: "/project/my-space/folders", icon: User },
      { 
        name: "Shared Projects", 
        href: "", // Pure container, not clickable
        icon: Share2,
        children: [
          { name: "Project A", href: "/project/p1/folders", icon: FolderOpen },
          { name: "Project B", href: "/project/p2/folders", icon: FolderOpen },
          { name: "Project C", href: "/project/p3/folders", icon: FolderOpen },
          { name: "Project D", href: "/project/p4/folders", icon: FolderOpen },
        ]
      },
    ]
  },
];

export function Sidebar({ className }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>(["All Projects"]);
  const location = useLocation();

  const toggleExpanded = (itemName: string) => {
    setExpandedItems(prev => 
      prev.includes(itemName) 
        ? prev.filter(name => name !== itemName)
        : [...prev, itemName]
    );
  };

  const isItemActive = (item: NavigationItem): boolean => {
    // For leaf items (no children), check exact match or extended path
    if (!item.children || item.children.length === 0) {
      if (!item.href) return false; // Empty href items are never active
      if (location.pathname === item.href) return true;
      if (item.href === "/project/my-space/folders" && location.pathname.startsWith("/project/my-space")) return true;
      return false;
    }
    
    // For parent items with children, never highlight them - only highlight leaf items
    return false;
  };

  const renderNavigationItem = (item: NavigationItem, level = 0) => {
    const isActive = isItemActive(item);
    const isExpanded = expandedItems.includes(item.name);
    const hasChildren = item.children && item.children.length > 0;

    return (
      <div key={item.name}>
        {hasChildren ? (
          <Button
            variant={isActive ? "default" : "ghost"}
            className={cn(
              "w-full justify-start gap-3 h-10",
              collapsed && "px-2",
              level > 0 && "ml-4",
              isActive && "bg-primary text-primary-foreground shadow-sm"
            )}
            onClick={() => !collapsed && toggleExpanded(item.name)}
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{item.name}</span>
                {isExpanded ? 
                  <ChevronDown className="h-4 w-4" /> : 
                  <ChevronRight className="h-4 w-4" />
                }
              </>
            )}
          </Button>
        ) : (
          <Button
            variant={isActive ? "default" : "ghost"}
            className={cn(
              "w-full justify-start gap-3 h-10",
              collapsed && "px-2",
              level > 0 && "ml-4",
              isActive && "bg-primary text-primary-foreground shadow-sm"
            )}
            asChild
          >
            <Link to={item.href}>
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          </Button>
        )}

        {hasChildren && isExpanded && !collapsed && (
          <div className="mt-1 space-y-1">
            {item.children?.map(child => renderNavigationItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn(
      "flex flex-col h-full bg-workspace-sidebar border-r border-border/50 transition-all duration-300",
      collapsed ? "w-16" : "w-64",
      className
    )}>
      {/* Header */}
      <div className={cn(
        "flex items-center border-b border-border/50 p-4",
        collapsed ? "justify-center" : "justify-between"
      )}>
        {!collapsed && <Logo size="md" />}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 w-8 p-0 flex-shrink-0",
            collapsed && "mx-auto"
          )}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <LayoutDashboard className="h-4 w-4" />
          ) : (
            <LayoutDashboard className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        <div className="space-y-1">
          {navigation.map((item) => renderNavigationItem(item))}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border/50">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 relative">
            <Bell className="h-4 w-4" />
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-primary rounded-full text-xs"></span>
          </Button>
          {!collapsed && (
            <>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <Settings className="h-4 w-4" />
              </Button>
              <div className="flex-1" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col text-right">
                  <span className="text-sm font-medium text-foreground">John Doe</span>
                  <span className="text-xs text-muted-foreground">john.doe@example.com</span>
                </div>
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                  <span className="text-xs font-medium text-white">JD</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}