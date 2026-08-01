"use client";

import React, { useState } from "react";
import { ThemeProvider } from "../components/shared/ThemeProvider";
import { Sidebar } from "../components/shared/Sidebar";
import { Navbar } from "../components/shared/Navbar";
import { GlobalSearchModal } from "../components/shared/GlobalSearchModal";
import { BlogDetailModal, BlogItem } from "../components/shared/BlogDetailModal";
import { ManualTopicModal } from "../components/shared/ManualTopicModal";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [selectedBlog, setSelectedBlog] = useState<BlogItem | null>(null);
  const [blogModalOpen, setBlogModalOpen] = useState(false);
  const [manualTopicOpen, setManualTopicOpen] = useState(false);

  const handleOpenBlogDetail = (blog: BlogItem) => {
    setSelectedBlog(blog);
    setBlogModalOpen(true);
  };

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] flex text-[13px]">
        {/* Persistent Sidebar */}
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {/* Main Content Area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top Navbar */}
          <Navbar
            onOpenCmdk={() => setCmdkOpen(true)}
            onRunNow={() => {
              alert("Triggered manual blog generation run now!");
            }}
          />

          {/* Main Page Content */}
          <main className="flex-1 min-w-0 p-[18px]">
            {React.isValidElement(children)
              ? React.cloneElement(children as React.ReactElement<any>, {
                  onOpenBlogModal: handleOpenBlogDetail,
                  onOpenManualTopic: () => setManualTopicOpen(true),
                })
              : children}
          </main>
        </div>

        {/* Global Modals */}
        <GlobalSearchModal isOpen={cmdkOpen} onClose={() => setCmdkOpen(false)} />
        <BlogDetailModal
          blog={selectedBlog}
          isOpen={blogModalOpen}
          onClose={() => setBlogModalOpen(false)}
        />
        <ManualTopicModal
          isOpen={manualTopicOpen}
          onClose={() => setManualTopicOpen(false)}
          onSubmit={(topic) => {
            alert(`Topic added to research queue: ${topic.title}`);
          }}
        />
      </div>
    </ThemeProvider>
  );
}
