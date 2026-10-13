import React, { useState, useRef } from "react";
import { WorkspaceFile } from "../types/shared";
import { ThemeConfig } from "../styles/themes";
import { UploadIcon, DownloadIcon, FileIcon, PlusIcon, TrashIcon, CloseIcon } from "./Icons";

interface FileExplorerProps {
  files: WorkspaceFile[];
  activeFileId: string;
  onSelectFile: (fileId: string) => void;
  onCreateFile: (name: string, content?: string) => void;
  onDeleteFile: (fileId: string) => void;
  onUploadFiles: (files: File[]) => void;
  onDownloadFile: (file: WorkspaceFile) => void;
  activeTheme: ThemeConfig;
  isOpen: boolean;
  onToggleOpen: () => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  files,
  activeFileId,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onUploadFiles,
  onDownloadFile,
  activeTheme,
  isOpen,
  onToggleOpen,
}) => {
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>("");
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeFile = files.find((f) => f.id === activeFileId) || files[0];

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) {
      setIsCreating(false);
      return;
    }
    onCreateFile(newFileName.trim());
    setNewFileName("");
    setIsCreating(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUploadFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUploadFiles(Array.from(e.dataTransfer.files));
    }
  };

  const getFileBadge = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return { label: "TS", color: "#2563EB", bg: "#EFF6FF" };
      case "py":
        return { label: "PY", color: "#D97706", bg: "#FFFBEB" };
      case "js":
      case "jsx":
        return { label: "JS", color: "#CA8A04", bg: "#FEF9C3" };
      case "json":
        return { label: "JSON", color: "#059669", bg: "#ECFDF5" };
      case "md":
        return { label: "MD", color: "#4B5563", bg: "#F3F4F6" };
      case "css":
        return { label: "CSS", color: "#7C3AED", bg: "#F5F3FF" };
      default:
        return { label: "FILE", color: "#6B7280", bg: "#F9FAFB" };
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggleOpen}
        style={{
          backgroundColor: activeTheme.colors.cardBg,
          borderColor: activeTheme.colors.border,
          color: activeTheme.colors.text,
        }}
        className="hidden md:flex flex-col items-center justify-center p-2.5 rounded-xl border shadow-apple-sm hover:opacity-90 transition cursor-pointer self-start"
        title="Open File Explorer"
      >
        <FileIcon size={18} className="text-[#656D76]" />
        <span className="text-[10px] font-mono mt-1 text-[#656D76] font-medium">FILES</span>
      </button>
    );
  }

  return (
    <div
      style={{
        backgroundColor: activeTheme.colors.cardBg,
        borderColor: activeTheme.colors.border,
        color: activeTheme.colors.text,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className={`w-full md:w-60 rounded-2xl border shadow-apple-sm flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden ${
        isDraggingOver ? "ring-2 ring-[#2563EB] bg-[#EFF6FF]/20" : ""
      }`}
    >
      {/* Explorer Header */}
      <div
        style={{
          backgroundColor: activeTheme.colors.headerBg,
          borderColor: activeTheme.colors.border,
        }}
        className="flex items-center justify-between px-3.5 py-2.5 border-b text-xs"
      >
        <div className="flex items-center gap-2">
          <FileIcon size={15} style={{ color: activeTheme.colors.textMuted }} />
          <span className="font-semibold text-[11px] uppercase tracking-wider" style={{ color: activeTheme.colors.text }}>
            Workspace
          </span>
          <span
            style={{
              backgroundColor: activeTheme.colors.bg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.textMuted,
            }}
            className="text-[10px] px-1.5 py-0.2 rounded border font-mono font-medium"
          >
            {files.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* New File Trigger */}
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="text-xs w-6 h-6 rounded-lg border hover:opacity-80 transition cursor-pointer flex items-center justify-center"
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.text,
            }}
            title="Create new file"
          >
            <PlusIcon size={13} />
          </button>

          {/* Close Explorer button */}
          <button
            type="button"
            onClick={onToggleOpen}
            className="text-xs w-6 h-6 rounded-lg hover:opacity-60 transition cursor-pointer flex items-center justify-center"
            style={{ color: activeTheme.colors.textMuted }}
            title="Collapse explorer"
          >
            <CloseIcon size={13} />
          </button>
        </div>
      </div>

      {/* Modern Primary Upload Bar */}
      <div className="p-2 border-b" style={{ borderColor: activeTheme.colors.border }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl border font-medium text-xs transition cursor-pointer bg-[#2563EB] text-white hover:bg-[#1D4ED8] shadow-apple-sm"
          title="Upload file(s) from computer"
        >
          <UploadIcon size={14} />
          <span>Upload File</span>
        </button>
      </div>

      {/* Hidden Native File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
        accept=".ts,.tsx,.js,.jsx,.py,.json,.md,.txt,.html,.css"
      />

      {/* New File Creation Input Bar */}
      {isCreating && (
        <form onSubmit={handleCreateSubmit} className="p-2 border-b" style={{ borderColor: activeTheme.colors.border }}>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              autoFocus
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="e.g. algo.py or utils.ts"
              className="flex-1 px-2.5 py-1 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              style={{
                backgroundColor: activeTheme.colors.bg,
                borderColor: activeTheme.colors.border,
                color: activeTheme.colors.text,
              }}
            />
            <button
              type="submit"
              className="text-xs px-2 py-1 rounded-lg bg-[#2563EB] text-white font-medium cursor-pointer"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setNewFileName("");
              }}
              className="text-xs px-1.5 py-1 rounded-lg hover:opacity-60 cursor-pointer"
              style={{ color: activeTheme.colors.textMuted }}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        </form>
      )}

      {/* File List Items */}
      <div className="p-1.5 space-y-0.5 overflow-y-auto max-h-80">
        {files.map((file) => {
          const isActive = file.id === activeFileId;
          const badge = getFileBadge(file.name);

          return (
            <div
              key={file.id}
              onClick={() => onSelectFile(file.id)}
              style={{
                backgroundColor: isActive ? activeTheme.colors.headerBg : "transparent",
                borderColor: isActive ? activeTheme.colors.accent : "transparent",
              }}
              className={`group flex items-center justify-between px-2.5 py-1.5 rounded-xl border text-xs cursor-pointer transition-all ${
                isActive ? "font-semibold shadow-2xs" : "hover:bg-black/5"
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  style={{
                    backgroundColor: badge.bg,
                    color: badge.color,
                  }}
                  className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border border-black/5 flex-shrink-0"
                >
                  {badge.label}
                </span>
                <span className="truncate" style={{ color: activeTheme.colors.text }}>
                  {file.name}
                </span>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {files.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteFile(file.id);
                    }}
                    className="w-5 h-5 rounded hover:bg-black/10 flex items-center justify-center text-[10px] text-[#EF4444] transition cursor-pointer"
                    title={`Delete ${file.name}`}
                  >
                    <TrashIcon size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Explorer Drag & Drop Hint & Download Footer */}
      <div
        style={{
          backgroundColor: activeTheme.colors.headerBg,
          borderColor: activeTheme.colors.border,
        }}
        className="p-2.5 border-t flex flex-col gap-2 text-[11px]"
      >
        <div className="flex items-center justify-between">
          <span style={{ color: activeTheme.colors.textMuted }} className="truncate">
            Active: <strong>{activeFile.name}</strong>
          </span>
          <button
            type="button"
            onClick={() => onDownloadFile(activeFile)}
            className="text-[11px] px-2 py-0.5 rounded-lg border font-medium hover:opacity-80 transition cursor-pointer flex items-center gap-1.5"
            style={{
              backgroundColor: activeTheme.colors.cardBg,
              borderColor: activeTheme.colors.border,
              color: activeTheme.colors.text,
            }}
            title="Download active file to computer"
          >
            <DownloadIcon size={12} />
            <span>Export</span>
          </button>
        </div>

        <div className="p-2 rounded-lg border border-dashed text-center text-[10px]" style={{ borderColor: activeTheme.colors.border, color: activeTheme.colors.textMuted }}>
          Drag files here to upload instantly
        </div>
      </div>
    </div>
  );
};
