"use client";

import * as React from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ShellContext } from "./shell-context";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { TessRail } from "./tess-rail";

/** A thin draggable divider between two panels. */
function Handle() {
  return (
    <PanelResizeHandle className="group relative w-[7px] shrink-0 cursor-col-resize">
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-data-[resize-handle-state=hover]:bg-jade-line group-data-[resize-handle-state=drag]:bg-jade" />
    </PanelResizeHandle>
  );
}

export function AppShell({
  children,
  userName,
  userEmail,
  initialUnread,
}: {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  initialUnread: number;
}) {
  const leftRef = React.useRef<ImperativePanelHandle>(null);
  const rightRef = React.useRef<ImperativePanelHandle>(null);
  const [leftOpen, setLeftOpen] = React.useState(true);
  const [rightOpen, setRightOpen] = React.useState(false);

  const toggleLeft = React.useCallback(() => {
    const p = leftRef.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  }, []);
  const toggleRight = React.useCallback(() => {
    const p = rightRef.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  }, []);
  const openRight = React.useCallback(() => {
    rightRef.current?.expand();
  }, []);

  return (
    <ShellContext.Provider value={{ leftOpen, rightOpen, toggleLeft, toggleRight, openRight }}>
      <div className="flex h-screen min-h-0 flex-col">
        <TopBar userName={userName} userEmail={userEmail} initialUnread={initialUnread} />
        <PanelGroup direction="horizontal" autoSaveId="tp-shell-v1" className="min-h-0 flex-1">
          <Panel
            id="nav"
            order={1}
            ref={leftRef}
            collapsible
            collapsedSize={0}
            minSize={11}
            defaultSize={15}
            maxSize={26}
            onCollapse={() => setLeftOpen(false)}
            onExpand={() => setLeftOpen(true)}
            className="min-w-0"
          >
            <Sidebar />
          </Panel>
          <Handle />
          <Panel id="main" order={2} minSize={30} className="min-w-0">
            <main className="@container h-full min-w-0 overflow-y-auto p-pad">{children}</main>
          </Panel>
          <Handle />
          <Panel
            id="tess"
            order={3}
            ref={rightRef}
            collapsible
            collapsedSize={0}
            minSize={16}
            defaultSize={0}
            maxSize={46}
            onCollapse={() => setRightOpen(false)}
            onExpand={() => setRightOpen(true)}
            className="min-w-0"
          >
            <TessRail />
          </Panel>
        </PanelGroup>
      </div>
    </ShellContext.Provider>
  );
}
