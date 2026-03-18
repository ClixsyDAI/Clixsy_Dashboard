"use client";

import { useState } from "react";

interface Tab {
  id: string;
  label: string;
}

interface DashboardTabsProps {
  tabs: Tab[];
  children: React.ReactNode[];
}

export default function DashboardTabs({ tabs, children }: DashboardTabsProps) {
  const [activeTab, setActiveTab] = useState(tabs[0].id);

  const activeIndex = tabs.findIndex((t) => t.id === activeTab);

  return (
    <div className="mt-6">
      {/* Tab Bar */}
      <div className="flex gap-0 border-b" style={{ borderColor: "#222" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-5 py-2.5 text-xs font-semibold tracking-widest uppercase transition-all"
            style={{
              color: activeTab === tab.id ? "#0a0a0a" : "#888",
              backgroundColor: activeTab === tab.id ? "#C8A882" : "transparent",
              borderBottom: activeTab === tab.id ? "2px solid #C8A882" : "2px solid transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-6">{children[activeIndex]}</div>
    </div>
  );
}
