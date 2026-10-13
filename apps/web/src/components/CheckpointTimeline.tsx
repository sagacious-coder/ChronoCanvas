import React, { useState } from "react";
import { ThemeConfig, getTheme } from "../styles/themes";
import { LayersIcon, ClockIcon, CheckIcon } from "./Icons";

export interface DocumentCheckpoint {
  id: string;
  timestamp: number;
  frontier: string;
  label: string;
  origin: "human" | "agent" | "initial";
  description?: string;
  isCurrent?: boolean;
}

interface CheckpointTimelineProps {
  checkpoints: DocumentCheckpoint[];
  currentFrontier: string;
  onRestoreCheckpoint: (frontier: string) => void;
  activeTheme?: ThemeConfig;
}

export const CheckpointTimeline: React.FC<CheckpointTimelineProps> = ({
  checkpoints,
  currentFrontier,
  onRestoreCheckpoint,
  activeTheme: passedTheme,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const activeTheme = passedTheme || getTheme("daylight");

  const initialCheckpoint = checkpoints.find((c) => c.origin === "initial") || {
    id: "cp-initial-root",
    timestamp: Date.now(),
    frontier: "root-0",
    label: "Initial Document State",
    origin: "initial" as const,
  };

  const editCheckpoints = checkpoints.filter((c) => c.origin !== "initial");
  const isInitialActive = currentFrontier === "root-0" || currentFrontier === initialCheckpoint.frontier;

  const visibleEdits = isExpanded ? editCheckpoints : editCheckpoints.slice(0, 3);
  const hiddenCount = editCheckpoints.length - 3;

  return (
    <div
      style={{
        backgroundColor: activeTheme.colors.cardBg,
        borderColor: activeTheme.colors.border,
        color: activeTheme.colors.text,
      }}
      className="w-full border rounded-2xl p-4 mb-4 shadow-apple-sm transition-colors duration-200"
    >
      {/* Section Header */}
      <div
        style={{ borderColor: activeTheme.colors.border }}
        className="flex items-center justify-between pb-3 mb-3 border-b"
      >
        <div className="flex items-center gap-2">
          <div
            style={{
              backgroundColor: activeTheme.colors.headerBg,
              color: activeTheme.colors.textMuted,
            }}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-semibold"
          >
            <LayersIcon size={13} />
          </div>
          <div>
            <h2 className="text-xs font-semibold" style={{ color: activeTheme.colors.text }}>
              Dual-Zone Version Control
            </h2>
          </div>
        </div>

        <span
          style={{
            backgroundColor: activeTheme.colors.bg,
            borderColor: activeTheme.colors.border,
            color: activeTheme.colors.textMuted,
          }}
          className="text-[11px] font-mono px-2.5 py-0.5 rounded-lg border"
        >
          Checkpoints: <strong style={{ color: activeTheme.colors.text }}>{checkpoints.length}</strong>
        </span>
      </div>

      {/* ZONE 1: Pinned Initial Document State */}
      <div className="mb-3">
        <div style={{ color: activeTheme.colors.textMuted }} className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 px-0.5">
          Zone 1 &bull; Pinned Baseline Anchor
        </div>
        <div
          style={{
            backgroundColor: isInitialActive ? activeTheme.colors.headerBg : activeTheme.colors.bg,
            borderColor: isInitialActive ? activeTheme.colors.borderHover : activeTheme.colors.border,
          }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-xl border transition-all shadow-apple-sm"
        >
          <div className="flex items-center gap-2.5">
            <div
              style={{
                backgroundColor: activeTheme.colors.cardBg,
                borderColor: activeTheme.colors.border,
                color: activeTheme.colors.textMuted,
              }}
              className="w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-mono"
            >
              #0
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold" style={{ color: activeTheme.colors.text }}>
                  Initial Document State
                </span>
                <span
                  style={{
                    backgroundColor: activeTheme.colors.cardBg,
                    borderColor: activeTheme.colors.border,
                    color: activeTheme.colors.textMuted,
                  }}
                  className="text-[9px] px-2 py-0.2 rounded-full font-medium border"
                >
                  Baseline
                </span>
                {isInitialActive && (
                  <span className="text-[9px] px-2 py-0.2 rounded-full bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] font-medium flex items-center gap-1">
                    <CheckIcon size={10} className="text-[#137333]" />
                    Current
                  </span>
                )}
              </div>
              <p className="text-[10px] font-mono mt-0.5" style={{ color: activeTheme.colors.textMuted }}>
                Frontier: root-0 &bull; Pre-mutation anchor
              </p>
            </div>
          </div>

          {!isInitialActive && (
            <button
              onClick={() => onRestoreCheckpoint(initialCheckpoint.frontier)}
              style={{
                backgroundColor: activeTheme.colors.cardBg,
                borderColor: activeTheme.colors.border,
                color: activeTheme.colors.text,
              }}
              className="mt-2 sm:mt-0 px-3 py-1 rounded-lg border text-xs font-medium transition cursor-pointer shadow-apple-sm hover:opacity-90"
            >
              Reset to Initial State
            </button>
          )}
        </div>
      </div>

      {/* ZONE 2: Streamlined Human & Agent Edits Timeline */}
      <div>
        <div style={{ color: activeTheme.colors.textMuted }} className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider mb-1.5 px-0.5">
          <span>Zone 2 &bull; Incremental Revisions</span>
          {hiddenCount > 0 && <span>showing {visibleEdits.length} of {editCheckpoints.length}</span>}
        </div>

        {editCheckpoints.length === 0 ? (
          <div
            style={{
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="p-3 rounded-xl border border-dashed text-center text-xs font-mono"
          >
            No revisions recorded yet. Keystrokes and agent writes will populate this stream.
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleEdits.map((cp, idx) => {
              const isHead = cp.frontier === currentFrontier;
              return (
                <div
                  key={cp.id}
                  style={{
                    backgroundColor: isHead ? activeTheme.colors.headerBg : activeTheme.colors.bg,
                    borderColor: isHead ? activeTheme.colors.accent : activeTheme.colors.border,
                  }}
                  className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-2.5 rounded-xl border transition-all ${
                    isHead ? "shadow-apple-sm" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs font-semibold" style={{ color: activeTheme.colors.textMuted }}>
                      #{editCheckpoints.length - idx}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium" style={{ color: activeTheme.colors.text }}>
                          {cp.label}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded border font-medium ${
                            cp.origin === "agent" 
                              ? "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]" 
                              : "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]"
                          }`}
                        >
                          {cp.origin === "agent" ? "Agent" : "Human"}
                        </span>
                        {isHead && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] font-medium flex items-center gap-1">
                            <CheckIcon size={10} className="text-[#137333]" />
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono flex items-center gap-1.5 mt-0.5" style={{ color: activeTheme.colors.textMuted }}>
                        <ClockIcon size={11} style={{ color: activeTheme.colors.textMuted }} />
                        <span>{new Date(cp.timestamp).toLocaleTimeString()}</span>
                        <span>&bull;</span>
                        <span className="truncate max-w-[180px]">{cp.frontier}</span>
                      </div>
                    </div>
                  </div>

                  {!isHead && (
                    <button
                      onClick={() => onRestoreCheckpoint(cp.frontier)}
                      style={{
                        backgroundColor: activeTheme.colors.cardBg,
                        borderColor: activeTheme.colors.border,
                        color: activeTheme.colors.text,
                      }}
                      className="mt-1.5 sm:mt-0 px-2.5 py-1 rounded-lg border text-xs font-medium transition cursor-pointer shadow-apple-sm hover:opacity-90"
                    >
                      Revert
                    </button>
                  )}
                </div>
              );
            })}

            {hiddenCount > 0 && (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  style={{
                    backgroundColor: activeTheme.colors.headerBg,
                    borderColor: activeTheme.colors.border,
                    color: activeTheme.colors.textMuted,
                  }}
                  className="px-3 py-1 rounded-full text-xs font-medium border transition cursor-pointer hover:opacity-90"
                >
                  {isExpanded ? "Collapse ▲" : `View ${hiddenCount} Earlier Revisions ▼`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
