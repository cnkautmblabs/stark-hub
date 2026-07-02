import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("starkHubSidebarCollapsed") === "1");

  function handleToggle() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem("starkHubSidebarCollapsed", next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="stark-app-shell">
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <div className="stark-main">
        <Topbar />
        <main className="stark-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
