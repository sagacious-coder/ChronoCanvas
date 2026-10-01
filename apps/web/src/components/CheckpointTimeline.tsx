import React, { useState } from "react";

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
}

export const CheckpointTimeline: React.FC<CheckpointTimelineProps> = ({
  checkpoints,
  currentFrontier,
  onRestoreCheckpoint,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Separate Zone 1 (Initial Document State) and Zone 2 (Human & Agent Edits)
  const initialCheckpoint = checkpoints.find((c) => c.origin === "initial") || {
    id: "cp-initial-root",
    timestamp: Date.now(),
    frontier: "root-0",
    label: "Initial Document State",
    origin: "initial",
  };

  const editCheckpoints = checkpoints.filter((c) => c.origin !== "initial");
  const isInitialActive = currentFrontier === "root-0" || currentFrontier === initialCheckpoint.frontier;

  // Stacking: Show top 3 recent edits by default, hide rest behind collapsible toggle
  const visibleEdits = isExpanded ? editCheckpoints : editCheckpoints.slice(0, 3);
  const hiddenCount = editCheckpoints.length - 3;

  return (
    <div className="w-full bg-[#FAF8F5] border border-[#E6E2D8] rounded-2xl p-5 mb-5 shadow-apple-sm">
      {/* Section Header */}
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-[#EBE7DC]">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-[#EFEAD9] flex items-center justify-center text-[#656D76] font-semibold text-xs">
            ⌘
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#1F2328]">Dual-Zone Version Control</h2>
            <p className="text-[11px] text-[#656D76]">Loro CRDT Immutable Frontiers &bull; Sub-5ms Instant Rollbacks</p>
          </div>
        </div>

        <span className="text-xs font-mono text-[#656D76] bg-[#F4EFE6] px-2.5 py-1 rounded-md border border-[#E6E2D8]">
          Total Checkpoints: <strong className="text-[#1F2328]">{checkpoints.length}</strong>
        </span>
      </div>

      {/* ZONE 1: Pinned Initial Document State (Permanently Visible) */}
      <div className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8C959F] mb-1.5 px-0.5">
          Zone 1 &bull; Pinned Baseline State
        </div>
        <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-xl border transition-all ${
          isInitialActive 
            ? "bg-[#F7F4EB] border-[#D8D2C4] shadow-apple-sm" 
            : "bg-[#FFFFFF] border-[#E6E2D8] hover:border-[#D8D2C4]"
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#EFEAD9] border border-[#E2DC withhold] flex items-center justify-center text-sm">
              📄
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#1F2328]">Initial Document State</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#EFEAD9] text-[#4B515D] font-medium border border-[#E2DCCF]">
                  Baseline Anchor
                </span>
                {isInitialActive && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#137333]" />
                    Current Head
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#656D76] mt-0.5 font-mono">
                Clean state prior to any human or autonomous agent mutations (Frontier: root-0)
              </p>
            </div>
          </div>

          {!isInitialActive && (
            <button
              onClick={() => onRestoreCheckpoint(initialCheckpoint.frontier)}
              className="mt-2.5 sm:mt-0 px-3.5 py-1.5 rounded-lg bg-[#FAF8F5] hover:bg-[#E6F4EA] text-[#4B515D] hover:text-[#137333] border border-[#D8D2C4] hover:border-[#CEEAD6] text-xs font-medium transition cursor-pointer shadow-apple-sm"
            >
              Reset to Initial State
            </button>
          )}
        </div>
      </div>

      {/* ZONE 2: Streamlined Human & Agent Edits Timeline (Stacked Sequentially) */}
      <div>
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[#8C959F] mb-1.5 px-0.5">
          <span>Zone 2 &bull; Incremental Revisions Timeline</span>
          {hiddenCount > 0 && (
            <span className="text-[10px] lowercase text-[#656D76] font-normal">
              showing {visibleEdits.length} of {editCheckpoints.length}
            </span>
          )}
        </div>

        {editCheckpoints.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#FFFFFF] border border-dashed border-[#D8D2C4] text-center text-xs text-[#656D76]">
            No incremental edits recorded yet. Human keystrokes and agent writes will populate this sequential stream.
          </div>
        ) : (
          <div className="space-y-2">
            {visibleEdits.map((cp, idx) => {
              const isHead = cp.frontier === currentFrontier;

              return (
                <div
                  key={cp.id}
                  className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-xl border text-xs transition-all ${
                    isHead
                      ? "bg-[#FFFFFF] border-[#2563eb]/40 shadow-apple-sm"
                      : "bg-[#FFFFFF] border-[#E6E2D8] hover:border-[#D8D2C4]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-center text-[10px] font-mono text-[#8C959F]">
                      #{editCheckpoints.length - idx}
                    </span>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#1F2328]">{cp.label}</span>
                        {cp.origin === "agent" ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F3E8FF] text-[#7C3AED] border border-[#E9D5FF] font-medium">
                            Agent Stream
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE] font-medium">
                            Human Edit
                          </span>
                        )}
                        {isHead && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#137333]" />
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#656D76]">
                        <span>{new Date(cp.timestamp).toLocaleTimeString()}</span>
                        <span>&bull;</span>
                        <span className="font-mono truncate max-w-[220px]" title={cp.frontier}>
                          Frontier: {cp.frontier}
                        </span>
                      </div>
                    </div>
                  </div>

                  {!isHead && (
                    <button
                      onClick={() => onRestoreCheckpoint(cp.frontier)}
                      className="mt-2 sm:mt-0 px-3 py-1 rounded-lg bg-[#FAF8F5] hover:bg-[#E6F4EA] text-[#4B515D] hover:text-[#137333] border border-[#D8D2C4] hover:border-[#CEEAD6] text-xs font-medium transition cursor-pointer"
                    >
                      Revert to this State
                    </button>
                  )}
                </div>
              );
            })}

            {/* Collapsible Disclosure to completely eliminate vertical scroll fatigue */}
            {hiddenCount > 0 && (
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="px-4 py-1.5 rounded-full bg-[#F7F4EB] hover:bg-[#EFEAD9] text-[#656D76] hover:text-[#1F2328] text-xs font-medium border border-[#E6E2D8] transition cursor-pointer shadow-apple-sm"
                >
                  {isExpanded ? "Collapse Revisions ▲" : `View ${hiddenCount} Earlier Revisions ▼`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
