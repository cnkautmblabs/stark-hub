export default {
  nav: {
    home: "Home",
    myItems: "My items",
    profile: "Profile",
    qualityBoard: "Quality Board",
    myMetrics: "My metrics",
    teamManagement: "Team management",
    projectManagement: "Project management",
    importWorkItems: "Import Work Items",
    settings: "Settings",
    theme: "Theme",
    faq: "FAQ",
    about: "About",
    expandMenu: "Expand menu",
    collapseMenu: "Collapse menu"
  },
  topbar: {
    accessLevelPrefix: "Access level",
    accessFallback: "Access",
    sandboxTitle: "Admin sandbox: view the app as another access level, without switching accounts. Applies to every screen.",
    viewAsAdmin: "View as: Admin (real)",
    viewAsDev: "View as: Dev",
    viewAsQa: "View as: QA",
    viewAsGestao: "View as: Management",
    viewAsGerente: "View as: Manager",
    language: "Language",
    signOut: "Sign out",
    signOutDemo: "Exit demo"
  },
  login: {
    title: "Stark Hub",
    subtitle: "Team governance, QA and productivity.",
    signInGoogle: "Sign in with Google",
    demoModeLabel: "Demo mode",
    demoModePlaceholder: "Demo mode",
    demoModeHint: "Explore with sample data, no account needed - view only, nothing is saved."
  },
  pages: {
    home: { title: "Home", subtitle: "Your summary for today on Stark Hub.", greeting: "Hi, {{name}}" },
    qaBoard: { title: "Quality Board", subtitle: "Work items in the QA pipeline, with filters and charts by status/country/Tested by." },
    myItems: { title: "My items", subtitleQa: "Cards Assigned in Azure, cards as Tested by and test history.", subtitleDev: "Work Items Assigned to the logged-in user" },
    governance: { title: "Team management", subtitle: "Hours, goals, cards without logged time and distribution by country." },
    managementDashboard: { title: "Executive dashboard", subtitle: "Grouped project metrics: deliveries, QA, dev and governance - multiple sprints." },
    collaborators: { title: "Profile", subtitleGestao: "Single identity registry, aliases, permissions, Slack, avatar and color for the whole team.", subtitleSelf: "Your identity, Slack, avatar and color info." },
    import: { title: "Import Work Items", subtitle: "Build the hierarchy manually or paste a CSV, review the preview and import." },
    settings: { title: "Settings", subtitle: "Connections, notifications and preferences." },
    faq: { title: "FAQ", subtitle: "Frequently asked questions about modules, data and access." },
    about: { title: "About", subtitle: "What Stark Hub is, how it's organized and who can see what." }
  },
  common: {
    refresh: "Refresh",
    loading: "Loading..."
  }
};
