import React, { useState } from 'react';
import {
  ScanLine,
  MessageSquare,
  Box,
  Dna,
  Activity,
  Layers,
  Sparkles,
  Cpu,
} from 'lucide-react';
import { SmartLens } from './components/SmartLens';
import { NextChat } from './components/NextChat';
import { ThreeSpatialLens } from './components/ThreeSpatialLens';
import { BioscienceWorkbench } from './components/BioscienceWorkbench';
import { EvalDashboard } from './components/EvalDashboard';
import { AuthModal } from './components/AuthModal';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'lens' | 'chat' | 'three' | 'science' | 'eval'>('lens');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* Top Navigation Header */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-3 sm:px-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg">
            N
          </div>
          <div>
            <h1 className="font-bold text-xs sm:text-sm tracking-tight text-white flex items-center gap-1.5">
              Next Chat AI &amp; Smart Lens
            </h1>
            <p className="text-[10px] text-slate-400 hidden md:block">
              Streaming Vision-Language &amp; Edge OCR System
            </p>
          </div>
        </div>

        {/* Center Tabs Navigation */}
        <nav className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-2xl border border-slate-800 shadow-inner">
          <button
            onClick={() => setActiveTab('lens')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'lens'
                ? 'bg-cyan-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>Smart Lens</span>
          </button>

          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'chat'
                ? 'bg-cyan-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Next Chat</span>
          </button>

          <button
            onClick={() => setActiveTab('three')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'three'
                ? 'bg-cyan-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">3D Spatial Lens</span>
            <span className="sm:hidden">3D</span>
          </button>

          <button
            onClick={() => setActiveTab('science')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'science'
                ? 'bg-teal-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Dna className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Bioscience</span>
          </button>

          <button
            onClick={() => setActiveTab('eval')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'eval'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>/eval</span>
          </button>
        </nav>

        {/* Right Auth / Profile Pill */}
        <div className="flex items-center gap-2">
          <AuthModal />
        </div>
      </header>

      {/* Main Viewport Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'lens' && <SmartLens />}
        {activeTab === 'chat' && <NextChat />}
        {activeTab === 'three' && <ThreeSpatialLens />}
        {activeTab === 'science' && <BioscienceWorkbench />}
        {activeTab === 'eval' && <EvalDashboard />}
      </main>
    </div>
  );
};

export default App;
