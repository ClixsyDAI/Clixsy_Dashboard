"use client";

import { Children, useState } from "react";

export interface Tab {
  id: string;
  label: string;
  children?: Tab[]; // optional submenu
}

interface DashboardTabsProps {
  tabs: Tab[];
  /**
   * Children must be provided in the same depth-first order as the tabs
   * (parent tabs that have children contribute no panel of their own).
   */
  children: React.ReactNode[];
}

/** Flatten tabs depth-first; only leaf tabs (no children) get a panel index. */
function flattenLeaves(tabs: Tab[]): Tab[] {
  const out: Tab[] = [];
  for (const t of tabs) {
    if (t.children && t.children.length > 0) {
      out.push(...flattenLeaves(t.children));
    } else {
      out.push(t);
    }
  }
  return out;
}

export default function DashboardTabs({ tabs, children }: DashboardTabsProps) {
  // Children may contain `false`/`null` slots from conditional rendering
  // (e.g. {cond && <div/>}). Strip them so indices line up with the tab
  // leaves, which are themselves conditionally added to the tabs array.
  const panels = Children.toArray(children);
  const leaves = flattenLeaves(tabs);
  const [activeTab, setActiveTab] = useState(leaves[0]?.id);

  // Determine which top-level parent (if any) contains the active tab
  const activeParent = tabs.find((t) =>
    t.children?.some((c) => c.id === activeTab)
  );

  const activeIndex = leaves.findIndex((t) => t.id === activeTab);

  function isActiveTopLevel(t: Tab) {
    if (t.children && t.children.length > 0) {
      return t.children.some((c) => c.id === activeTab);
    }
    return t.id === activeTab;
  }

  return (
    <div className="mt-6">
      {/* Top-level tab bar */}
      <div className="flex gap-0 border-b" style={{ borderColor: "#222" }}>
        {tabs.map((tab) => {
          const active = isActiveTopLevel(tab);
          const hasChildren = !!tab.children?.length;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (hasChildren) {
                  setActiveTab(tab.children![0].id);
                } else {
                  setActiveTab(tab.id);
                }
              }}
              className="px-5 py-2.5 text-xs font-semibold tracking-widest uppercase transition-all"
              style={{
                color: active ? "#0a0a0a" : "#888",
                backgroundColor: active ? "#C8A882" : "transparent",
                borderBottom: active
                  ? "2px solid #C8A882"
                  : "2px solid transparent",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Submenu (only when active parent has children) */}
      {activeParent && (
        <div
          className="flex gap-0 border-b"
          style={{ borderColor: "#222", backgroundColor: "#0d0d0d" }}
        >
          {activeParent.children!.map((child) => {
            const active = child.id === activeTab;
            return (
              <button
                key={child.id}
                onClick={() => setActiveTab(child.id)}
                className="px-4 py-2 text-[11px] font-semibold tracking-widest uppercase transition-all"
                style={{
                  color: active ? "#C8A882" : "#666",
                  borderBottom: active
                    ? "2px solid #C8A882"
                    : "2px solid transparent",
                }}
              >
                {child.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab Content */}
      <div className="mt-6">{panels[activeIndex]}</div>
    </div>
  );
}
