"use client";

import React, { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { ThemeProvider } from "../../components/shared/ThemeProvider";
import { ErrorBoundary } from "../../components/shared/ErrorBoundary";
import { Sidebar } from "../../components/shared/Sidebar";
import { Navbar } from "../../components/shared/Navbar";
import { GlobalSearchModal } from "../../components/shared/GlobalSearchModal";
import { BlogDetailModal, BlogItem } from "../../components/shared/BlogDetailModal";
import { RunPipelineModal } from "../../components/shared/RunPipelineModal";

const desktopQuery = "(min-width: 1200px)";
function subscribeDesktop(callback: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopQuery).matches, () => false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!navigationOpen) return;
    const dialog = drawerRef.current!;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    const media = window.matchMedia(desktopQuery);
    const closeOnDesktop = () => { if (media.matches) setNavigationOpen(false); };
    media.addEventListener("change", closeOnDesktop);
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      media.removeEventListener("change", closeOnDesktop);
      if (opener?.isConnected) opener.focus();
    };
  }, [navigationOpen]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [selectedBlog, setSelectedBlog] = useState<BlogItem | null>(null);
  const [blogModalOpen, setBlogModalOpen] = useState(false);
  const [runPipelineOpen, setRunPipelineOpen] = useState(false);
  const desktopSidebarCollapsed = !desktop || sidebarCollapsed;
  const desktopSidebarWidth = desktopSidebarCollapsed ? "md:w-[76px]" : "md:w-[252px]";

  const handleOpenBlogDetail = (blog: BlogItem) => {
    setSelectedBlog(blog);
    setBlogModalOpen(true);
  };

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] flex text-[13px]">
        {/* Persistent Sidebar */}
        <div className={`hidden md:block md:flex-none ${desktopSidebarWidth} transition-[width] duration-200 motion-reduce:transition-none`}>
          <div className="fixed inset-y-0 left-0 z-50">
            <Sidebar
              collapsed={desktopSidebarCollapsed}
              onToggleCollapse={() => desktop ? setSidebarCollapsed(!sidebarCollapsed) : setNavigationOpen(true)}
            />
          </div>
        </div>
        <dialog
          id="dashboard-navigation-drawer"
          ref={drawerRef}
          aria-label="Main navigation"
          className="navigation-drawer"
          onCancel={() => setNavigationOpen(false)}
          onClick={(event) => { if (event.target === event.currentTarget) setNavigationOpen(false); }}
        >
          {navigationOpen && <Sidebar drawer collapsed={false} onToggleCollapse={() => setNavigationOpen(false)} onNavigate={() => setNavigationOpen(false)} />}
        </dialog>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top Navbar */}
          <Navbar
            onOpenNavigation={() => setNavigationOpen(true)}
            navigationOpen={navigationOpen}
            onOpenCmdk={() => setCmdkOpen(true)}
            onOpenRunPipeline={() => setRunPipelineOpen(true)}
          />

          {/* Main Page Content */}
          <main className="flex-1 min-w-0 p-3 md:p-4 min-[1200px]:p-[18px]">
            <ErrorBoundary>
              {React.isValidElement(children)
                ? React.cloneElement(children as React.ReactElement<{
                  onOpenBlogModal?: (blog: BlogItem) => void;
                  onOpenRunPipeline?: () => void;
                }>, {
                  onOpenBlogModal: handleOpenBlogDetail,
                  onOpenRunPipeline: () => setRunPipelineOpen(true),
                })
                : children}
            </ErrorBoundary>
          </main>
        </div>

        {/* Global Modals */}
        <GlobalSearchModal isOpen={cmdkOpen} onClose={() => setCmdkOpen(false)} />
        <BlogDetailModal
          blog={selectedBlog}
          isOpen={blogModalOpen}
          onClose={() => setBlogModalOpen(false)}
        />
        {runPipelineOpen && <RunPipelineModal onClose={() => setRunPipelineOpen(false)} />}
      </div>
    </ThemeProvider>
  );
}
