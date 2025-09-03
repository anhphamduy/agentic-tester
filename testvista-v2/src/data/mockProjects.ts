import { Project } from "@/types/project";

export const mockProjects: Project[] = [
  // My Space (Special private workspace)
  {
    id: "my-space",
    name: "My Space",
    description: "Your private workspace with folders and test suites",
    type: "private",
    role: "owner",
    status: "active",
    testSuites: 6,
    testCases: 214,
    coverage: 83,
    lastActivity: "2 hours ago",
    memberCount: 1,
    isFavorite: true,
    tags: ["personal", "workspace"],
    owner: {
      name: "You",
      initials: "YU"
    },
    folders: [
      {
        id: "1",
        name: "Personal Projects",
        description: "Individual testing projects and experiments",
        suites: 2,
        lastActivity: "2 hours ago"
      },
      {
        id: "2",
        name: "Learning & Practice",
        description: "Educational testing projects",
        suites: 1,
        lastActivity: "1 day ago"
      },
      {
        id: "3",
        name: "Security Testing",
        description: "Security-focused test cases",
        suites: 1,
        lastActivity: "3 days ago"
      }
    ]
  },
  // Other private projects
  {
    id: "p1",
    name: "Project A",
    description: "Testing suite for core application features",
    type: "private",
    role: "owner",
    status: "active",
    testSuites: 8,
    testCases: 156,
    coverage: 87,
    lastActivity: "2 hours ago",
    memberCount: 1,
    isFavorite: true,
    tags: ["core", "features"],
    folders: [
      {
        id: "f1",
        name: "Core Features",
        description: "Main functionality testing",
        suites: 3,
        lastActivity: "2 hours ago"
      },
      {
        id: "f2",
        name: "User Interface",
        description: "Frontend component tests",
        suites: 3,
        lastActivity: "1 day ago"
      },
      {
        id: "f3",
        name: "Integration",
        description: "Service integration tests",
        suites: 2,
        lastActivity: "3 days ago"
      }
    ]
  },
  {
    id: "p2",
    name: "Project B",
    description: "User interface and authentication testing",
    type: "private",
    role: "owner",
    status: "completed",
    testSuites: 5,
    testCases: 89,
    coverage: 95,
    lastActivity: "1 day ago",
    memberCount: 1,
    tags: ["ui", "auth"],
    folders: [
      {
        id: "f4",
        name: "Authentication",
        description: "Login and security features",
        suites: 3,
        lastActivity: "1 day ago"
      },
      {
        id: "f5",
        name: "User Experience",
        description: "UI/UX testing and usability",
        suites: 2,
        lastActivity: "2 days ago"
      }
    ]
  },
  {
    id: "p3",
    name: "Project C",
    description: "API integration and security testing",
    type: "private",
    role: "owner",
    status: "draft",
    testSuites: 3,
    testCases: 34,
    coverage: 45,
    lastActivity: "1 week ago",
    memberCount: 1,
    tags: ["api", "security"],
    folders: [
      {
        id: "f6",
        name: "API Testing",
        description: "REST API and endpoint testing",
        suites: 2,
        lastActivity: "1 week ago"
      },
      {
        id: "f7",
        name: "Security",
        description: "Security testing and vulnerability assessment",
        suites: 1,
        lastActivity: "2 weeks ago"
      }
    ]
  },
  
  // Shared projects
  {
    id: "sp1",
    name: "Project D",
    description: "Large-scale collaborative testing project",
    type: "shared",
    role: "admin",
    status: "active",
    testSuites: 18,
    testCases: 445,
    coverage: 89,
    lastActivity: "1 hour ago",
    memberCount: 8,
    isFavorite: true,
    owner: {
      name: "Sarah Chen",
      initials: "SC"
    },
    members: [
      { name: "John Doe", initials: "JD", role: "collaborator" },
      { name: "Mike Johnson", initials: "MJ", role: "viewer" },
      { name: "Lisa Wang", initials: "LW", role: "collaborator" }
    ],
    tags: ["collaborative", "enterprise"],
    folders: [
      {
        id: "fd1",
        name: "Core System",
        description: "Main application testing",
        suites: 6,
        lastActivity: "1 hour ago"
      },
      {
        id: "fd2",
        name: "User Management",
        description: "User accounts and profiles",
        suites: 4,
        lastActivity: "2 hours ago"
      },
      {
        id: "fd3",
        name: "Enterprise Features",
        description: "Advanced enterprise functionality",
        suites: 5,
        lastActivity: "4 hours ago"
      },
      {
        id: "fd4",
        name: "Performance",
        description: "Load and stress testing",
        suites: 3,
        lastActivity: "1 day ago"
      }
    ]
  },
  {
    id: "sp2",
    name: "Project E",
    description: "Mobile and cross-platform testing suite",
    type: "shared",
    role: "collaborator",
    status: "active",
    testSuites: 12,
    testCases: 298,
    coverage: 92,
    lastActivity: "3 hours ago",
    memberCount: 5,
    owner: {
      name: "Alex Kumar",
      initials: "AK"
    },
    members: [
      { name: "Emma Davis", initials: "ED", role: "admin" },
      { name: "Tom Wilson", initials: "TW", role: "collaborator" }
    ],
    tags: ["mobile", "cross-platform"],
    folders: [
      {
        id: "fe1",
        name: "iOS Testing",
        description: "iOS specific functionality",
        suites: 4,
        lastActivity: "3 hours ago"
      },
      {
        id: "fe2",
        name: "Android Testing",
        description: "Android platform tests",
        suites: 5,
        lastActivity: "4 hours ago"
      },
      {
        id: "fe3",
        name: "Cross-Platform",
        description: "Shared functionality tests",
        suites: 3,
        lastActivity: "1 day ago"
      }
    ]
  },
  {
    id: "sp3",
    name: "Project F",
    description: "Backend services and database testing",
    type: "shared",
    role: "viewer",
    status: "completed",
    testSuites: 25,
    testCases: 567,
    coverage: 96,
    lastActivity: "2 days ago",
    memberCount: 12,
    owner: {
      name: "David Rodriguez",
      initials: "DR"
    },
    members: [
      { name: "Anna Lee", initials: "AL", role: "admin" },
      { name: "Chris Brown", initials: "CB", role: "collaborator" }
    ],
    tags: ["backend", "database"],
    folders: [
      {
        id: "ff1",
        name: "Database Testing",
        description: "Database operations and integrity tests",
        suites: 12,
        lastActivity: "2 days ago"
      },
      {
        id: "ff2",
        name: "API Services",
        description: "Backend API endpoint testing",
        suites: 8,
        lastActivity: "3 days ago"
      },
      {
        id: "ff3",
        name: "Performance",
        description: "Load and performance testing",
        suites: 5,
        lastActivity: "1 week ago"
      }
    ]
  },
  {
    id: "sp4",
    name: "Project G",
    description: "Component library and design system testing",
    type: "shared",
    role: "owner",
    status: "active",
    testSuites: 15,
    testCases: 234,
    coverage: 84,
    lastActivity: "5 hours ago",
    memberCount: 6,
    isFavorite: true,
    owner: {
      name: "You",
      initials: "YU"
    },
    members: [
      { name: "Maria Garcia", initials: "MG", role: "admin" },
      { name: "James Wilson", initials: "JW", role: "collaborator" },
      { name: "Sophie Chen", initials: "SC", role: "viewer" }
    ],
    tags: ["components", "design-system"],
    folders: [
      {
        id: "fg1",
        name: "UI Components",
        description: "Component library testing",
        suites: 8,
        lastActivity: "5 hours ago"
      },
      {
        id: "fg2",
        name: "Design Tokens",
        description: "Design system consistency tests",
        suites: 4,
        lastActivity: "1 day ago"
      },
      {
        id: "fg3",
        name: "Accessibility",
        description: "WCAG compliance testing",
        suites: 3,
        lastActivity: "2 days ago"
      }
    ]
  }
];

// Recent activity across all projects
export const recentActivity = [
  {
    projectId: "sp1",
    projectName: "Project D",
    user: "John Doe",
    action: "completed test case 'Core Feature Validation'",
    timestamp: "1 hour ago"
  },
  {
    projectId: "p1",
    projectName: "Project A",
    user: "You",
    action: "updated test suite 'User Interface'",
    timestamp: "2 hours ago"
  },
  {
    projectId: "sp2",
    projectName: "Project E",
    user: "Emma Davis",
    action: "added new test case 'Mobile Navigation'",
    timestamp: "3 hours ago"
  },
  {
    projectId: "sp4",
    projectName: "Project G",
    user: "Maria Garcia",
    action: "reviewed and approved test results",
    timestamp: "4 hours ago"
  }
];

// Project recommendations based on activity and similarities
export const projectRecommendations = [
  {
    id: "rec1",
    type: "continue",
    title: "Continue working on Project A",
    description: "You have 3 pending test cases to review",
    projectId: "p1"
  },
  {
    id: "rec2",
    type: "collaborate",
    title: "Review shared project updates",
    description: "5 new updates in Project D",
    projectId: "sp1"
  },
  {
    id: "rec3",
    type: "similar",
    title: "Similar to your Project C",
    description: "Project F might interest you",
    projectId: "sp3"
  }
];