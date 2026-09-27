import { useState, useCallback } from 'react';
import { CodeEditor } from './components/CodeEditor';
import { Code2, Sparkles, Users, Cpu, ShieldCheck } from 'lucide-react';

const INITIAL_CODE = `# ChronoCanvas: Real-Time Human-Agent Pair Programming
# Stage 0 / Day 1: Frontend Workspace Initialized

def calculate_fibonacci(n: int) -> int:
    """Calculate the nth Fibonacci number efficiently."""
    if n <= 0:
        return 0
    elif n == 1:
        return 1
    
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

if __name__ == "__main__":
    for i in range(10):
        print(f"F({i}) = {calculate_fibonacci(i)}")
`;

export default function App() {
  const [code, setCode] = useState<string>(INITIAL_CODE);
  const [language, setLanguage] = useState<'python' | 'javascript'>('python');

  // Stable callback avoids triggering unnecessary re-renders in children
  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode);
  }, []);

  const handleSimulateAgent = () => {
    const snippet = `\n# [Agent Activity]: Added optimized matrix-exponentiation variant\ndef fib_matrix(n: int) -> int:\n    pass\n`;
    setCode((prev) => prev + snippet);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Code2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-sm tracking-wide text-white">ChronoCanvas</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-700 text-indigo-300 font-mono">
                ZA • Day 1
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Zero-Lock Concurrent Co-Editing Canvas</p>
          </div>
        </div>

        {/* Status Badges */}
        <div className="flex items-center space-x-3 text-xs">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-emerald-950/60 border border-emerald-800/80 text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>CRDT Ready (Loro-Bound)</span>
          </div>

          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
            <Users className="w-3.5 h-3.5 text-sky-400" />
            <span>ZA Active (Human)</span>
          </div>

          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
            <Cpu className="w-3.5 h-3.5 text-violet-400" />
            <span>Agent Worker (Standby)</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'python' | 'javascript')}
            className="text-xs bg-slate-800 border border-slate-700 rounded-md px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
          </select>

          <button
            onClick={handleSimulateAgent}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-sm active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Simulate Agent Edit</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main className="flex-1 flex overflow-hidden p-3 gap-3 min-h-0">
        {/* Left Side: CodeMirror 6 Editor */}
        <div className="flex-1 h-full min-h-0">
          <CodeEditor
            value={code}
            language={language}
            onChange={handleCodeChange}
          />
        </div>

        {/* Right Side: Execution & State Checkpoint Sidebar */}
        <aside className="w-80 h-full border border-slate-800 rounded-lg bg-slate-900/40 p-4 flex flex-col justify-between shrink-0 text-xs min-h-0">
          <div>
            <h2 className="font-semibold text-slate-200 text-xs uppercase tracking-wider mb-3">
              Stage 0 Architecture Status
            </h2>

            <div className="space-y-3">
              <div className="p-3 rounded-md bg-slate-800/60 border border-slate-700/50">
                <div className="flex justify-between items-center mb-1 text-slate-300 font-medium">
                  <span>/apps/web</span>
                  <span className="text-emerald-400 text-[11px]">Initialized</span>
                </div>
                <p className="text-[11px] text-slate-400">React 18 + Vite + Tailwind CSS + CodeMirror 6</p>
              </div>

              <div className="p-3 rounded-md bg-slate-800/60 border border-slate-700/50">
                <div className="flex justify-between items-center mb-1 text-slate-300 font-medium">
                  <span>/packages/shared-types</span>
                  <span className="text-sky-400 text-[11px]">Contracts Ready</span>
                </div>
                <p className="text-[11px] text-slate-400">WebSocket Binary Deltas & CRDT Frontier types</p>
              </div>

              <div className="p-3 rounded-md bg-slate-800/60 border border-slate-700/50">
                <div className="flex justify-between items-center mb-1 text-slate-300 font-medium">
                  <span>Next Milestone (Day 2)</span>
                  <span className="text-amber-400 text-[11px]">Stage 1</span>
                </div>
                <p className="text-[11px] text-slate-400">Bind CodeMirror 6 with loro-dev/loro-codemirror</p>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 text-slate-500 text-[11px] flex justify-between items-center">
            <span>ChronoCanvas Monorepo</span>
            <span className="font-mono">pnpm workspace</span>
          </div>
        </aside>
      </main>
    </div>
  );
}
