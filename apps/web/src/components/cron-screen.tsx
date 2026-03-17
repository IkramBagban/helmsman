import * as React from "react"
import {
  Activity,
  Clock,
  ExternalLink,
  History,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Zap,
  Terminal,
  Cpu,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import schedulesData from "../../../api/data/schedules.json"

// --- Types ---

interface Schedule {
  readonly id: string
  readonly title: string
  readonly status: "active" | "paused" | "cancelled" | "degraded" | "completed" | string
  readonly platform: string
  readonly lastRunAtIso?: string
  readonly nextRunAtIso?: string
  readonly runsCompleted: number
  readonly actionType: string
  readonly patternDescription: string
  readonly sourceText: string
}

// --- Data Mapping ---

const REAL_SCHEDULES: readonly Schedule[] = schedulesData.schedules.map((s: any) => ({
  id: s.id,
  title: s.action.title || "Background Task",
  status: s.status,
  platform: s.platform,
  runsCompleted: s.runsCompleted || 0,
  actionType: s.action.type,
  patternDescription: s.pattern.type === "interval"
    ? `Every ${s.pattern.intervalSeconds ? s.pattern.intervalSeconds + 's' : (s.pattern.intervalMinutes + 'm')}`
    : s.pattern.type,
  sourceText: s.sourceText,
  nextRunAtIso: s.nextRunAtIso,
  lastRunAtIso: s.lastRunAtIso,
}))

export function CronScreen() {
  const [activeTab, setActiveTab] = React.useState("all")
  const [searchQuery, setSearchQuery] = React.useState("")

  const filteredSchedules = REAL_SCHEDULES.filter(s => {
    const matchesTab = activeTab === "all" || s.status === activeTab
    const matchesSearch = s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.sourceText.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesTab && matchesSearch
  })

  const activeCount = REAL_SCHEDULES.filter(s => s.status === "active").length
  const pausedCount = REAL_SCHEDULES.filter(s => s.status === "paused").length
  const cancelledCount = REAL_SCHEDULES.filter(s => s.status === "cancelled").length
  const totalRuns = REAL_SCHEDULES.reduce((acc, s) => acc + s.runsCompleted, 0)

  return (
    <div className="flex h-full flex-col bg-[#050508] text-zinc-100 selection:bg-cyan-500/30">
      {/* Dynamic Glassmorphism Background Elements */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-[0%] right-[10%] w-[600px] h-[500px] rounded-[100%] bg-cyan-600/10 blur-[140px] mix-blend-screen opacity-60 animate-in fade-in duration-1000" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[700px] h-[600px] rounded-[100%] bg-indigo-700/10 blur-[140px] mix-blend-screen opacity-60" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.15] mix-blend-overlay" />
      </div>

      <div className="relative z-10 flex h-full flex-col overflow-hidden">
        {/* Sleek App Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-white/5 bg-[#0a0a0c]/80 px-8 py-6 backdrop-blur-2xl">
          <div className="flex items-center gap-8">
            <div className="space-y-1.5 flex flex-col justify-center">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-white/10 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
                  <Cpu className="size-5 text-cyan-400" />
                </div>
                <h1 className="text-2xl font-black tracking-tight text-white/90">
                  Cron Engine
                </h1>
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-400/60 ml-12">Automated Operations</p>
            </div>

            <div className="h-12 w-px bg-white/10 mx-2" />

            <div className="flex items-center gap-8">
              <QuickStat label="Total Jobs" value={REAL_SCHEDULES.length.toString()} color="text-white" />
              <QuickStat label="Active" value={activeCount.toString()} color="text-emerald-400" />
              <QuickStat label="Paused" value={pausedCount.toString()} color="text-amber-400" />
              <QuickStat label="Total Executions" value={totalRuns.toLocaleString()} color="text-cyan-400" />
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="group flex h-10 items-center gap-3 rounded-xl bg-black/40 px-4 border border-white/10 hover:border-cyan-500/30 hover:bg-black/60 focus-within:border-cyan-500/50 focus-within:bg-black/60 transition-all duration-300 shadow-inner">
              <Search className="size-4 text-zinc-500 group-focus-within:text-cyan-400 transition-colors" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search jobs, commands..."
                className="bg-transparent text-sm font-medium outline-none placeholder:text-zinc-600 w-56 transition-all focus:w-72 text-zinc-200"
              />
            </div>
            <Button className="h-10 rounded-xl bg-gradient-to-b from-cyan-400 to-cyan-600 hover:from-cyan-300 hover:to-cyan-500 text-black font-extrabold shadow-[0_0_20px_rgba(6,182,212,0.25)] hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 border border-cyan-300/50">
              <Plus className="mr-2 size-4 stroke-[3px]" />
              Create Job
            </Button>
          </div>
        </header>

        {/* Dynamic Filters Bar */}
        <div className="flex shrink-0 items-center justify-between bg-black/30 px-8 py-3.5 border-b border-white/5 backdrop-blur-xl">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
            <TabsList className="bg-transparent p-0 h-auto gap-3">
              <TabTrigger value="all" label="All" count={REAL_SCHEDULES.length} />
              <TabTrigger value="active" label="Active" count={activeCount} activeColor="data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-500/30 data-[state=active]:bg-emerald-500/10" dotColor="bg-emerald-400" />
              <TabTrigger value="paused" label="Paused" count={pausedCount} activeColor="data-[state=active]:text-amber-400 data-[state=active]:border-amber-500/30 data-[state=active]:bg-amber-500/10" dotColor="bg-amber-400" />
              <TabTrigger value="cancelled" label="Cancelled" count={cancelledCount} activeColor="data-[state=active]:text-rose-400 data-[state=active]:border-rose-500/30 data-[state=active]:bg-rose-500/10" dotColor="bg-rose-400" />
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-3">
            <Select defaultValue="newest">
              <SelectTrigger className="h-9 w-[150px] border-white/10 bg-black/40 text-xs font-semibold text-zinc-300 rounded-xl hover:bg-white/5 transition-colors">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent className="bg-[#0f0f13] border-white/10 rounded-xl shadow-2xl backdrop-blur-2xl">
                <SelectItem value="newest" className="focus:bg-white/5 font-medium">Newest First</SelectItem>
                <SelectItem value="runs" className="focus:bg-white/5 font-medium">Most Executions</SelectItem>
                <SelectItem value="alphabetical" className="focus:bg-white/5 font-medium">Alphabetical A-Z</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-white/10 bg-black/40 text-zinc-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all duration-300 active:scale-90">
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Feed Area */}
        <main className="flex-1 overflow-y-auto p-8 custom-scrollbar relative z-0">
          <div className="max-w-[1400px] mx-auto space-y-4 pb-20">
            {filteredSchedules.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {filteredSchedules.map((schedule, idx) => (
                  <JobRow key={schedule.id} schedule={schedule} delay={idx * 0.05} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-40 text-center animate-in fade-in duration-700">
                <div className="size-24 rounded-[2rem] bg-gradient-to-br from-white/5 to-white/0 flex items-center justify-center mb-6 border border-white/10 shadow-2xl shadow-black/50">
                  <Terminal className="size-10 text-cyan-500/50" />
                </div>
                <h3 className="text-2xl font-bold bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent">No jobs matching criteria</h3>
                <p className="text-zinc-500 mt-3 max-w-sm text-sm font-medium leading-relaxed">Adjust your filters or try a different search phrase to find what you're looking for.</p>
                <Button className="mt-8 h-11 px-6 rounded-xl bg-white/5 text-white font-semibold hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all">
                  Clear Filters
                </Button>
              </div>
            )}
          </div>
        </main>

        {/* Status Bar Indicator */}
        <footer className="shrink-0 border-t border-white/5 bg-[#0a0a0c]/90 px-8 py-3 backdrop-blur-md relative z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="relative flex size-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full size-2 bg-emerald-500"></span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Scheduler Operational</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <p className="text-xs font-medium text-zinc-500 flex items-center gap-2">
                <History className="size-3.5 opacity-70" />
                Real-time connection established
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold text-zinc-600">
              <span className="hover:text-zinc-300 transition-colors cursor-pointer">API Specs</span>
              <div className="h-3 w-px bg-white/10" />
              <span className="hover:text-zinc-300 transition-colors cursor-pointer">Documentation</span>
              <div className="h-3 w-px bg-white/10" />
              <span className="flex items-center gap-1.5 text-cyan-500/70 hover:text-cyan-400 transition-colors">
                <ShieldCheck className="size-3.5" />
                Helmsman Core v2.4
              </span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

function QuickStat({ label, value, color }: { label: string, value: string, color: string }) {
  return (
    <div className="flex flex-col gap-1 p-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</span>
      <span className={cn("text-xl font-black tabular-nums tracking-tight", color)}>{value}</span>
    </div>
  )
}

function TabTrigger({ value, label, count, activeColor = "data-[state=active]:text-cyan-400 data-[state=active]:border-cyan-500/30 data-[state=active]:bg-cyan-500/10", dotColor }: { value: string, label: string, count: number, activeColor?: string, dotColor?: string }) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "px-4 py-2 rounded-xl text-xs font-bold text-zinc-500 border border-transparent transition-all hover:text-zinc-300 flex items-center gap-2",
        activeColor
      )}
    >
      {dotColor && <div className={cn("size-1.5 rounded-full opacity-70", dotColor)} />}
      {label}
      <span className="py-0.5 px-2 rounded-md bg-black/50 border border-white/5 text-[10px] font-black tabular-nums shadow-inner">{count}</span>
    </TabsTrigger>
  )
}

function JobRow({ schedule, delay = 0 }: { schedule: Schedule, delay?: number }) {
  const isPaused = schedule.status === "paused"
  const isCancelled = schedule.status === "cancelled"
  const isActive = schedule.status === "active"

  return (
    <div
      className="group relative animate-in fade-in slide-in-from-bottom-4 fill-mode-both"
      style={{ animationDelay: `${delay}s`, animationDuration: '600ms' }}
    >
      {/* Hover Background Glow */}
      <div className={cn(
        "absolute -inset-px rounded-[24px] bg-gradient-to-r transition-all duration-500 opacity-0 group-hover:opacity-100 blur-sm mix-blend-screen",
        isActive ? "from-cyan-500/30 via-cyan-500/5 to-transparent" :
          isCancelled ? "from-rose-500/20 via-rose-500/5 to-transparent" :
            "from-zinc-500/20 via-zinc-500/5 to-transparent"
      )} />

      <div className="relative flex items-center gap-6 rounded-[22px] bg-[#0c0c0e]/95 backdrop-blur-sm border border-white/5 p-5 transition-all duration-300 group-hover:bg-[#121216] group-hover:border-white/10 group-hover:translate-y-[-2px] group-hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] z-10">

        {/* Status Icon */}
        <div className={cn(
          "size-14 rounded-[1.25rem] flex items-center justify-center shrink-0 shadow-inner overflow-hidden relative cursor-help transition-transform duration-300 group-hover:scale-105",
          isActive ? "bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 text-cyan-400 border border-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]" :
            isCancelled ? "bg-gradient-to-br from-rose-500/20 to-rose-500/5 text-rose-400 border border-rose-500/20" :
              "bg-gradient-to-br from-zinc-500/20 to-zinc-500/5 text-zinc-400 border border-white/5"
        )}>
          {/* Subtle pulse for active jobs inside icon */}
          {isActive && <div className="absolute inset-0 bg-cyan-400/20 animate-pulse pointer-events-none" />}

          {schedule.actionType === "agent_task" ? <Zap className="size-6 stroke-[1.5px]" /> :
            schedule.actionType === "reminder" ? <Clock className="size-6 stroke-[1.5px]" /> :
              <Activity className="size-6 stroke-[1.5px]" />}
        </div>

        {/* Info Area */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-1.5">
            <h3 className="text-base font-bold text-zinc-100 truncate max-w-[320px] tracking-tight group-hover:text-white transition-colors">{schedule.title}</h3>
            <Badge variant="outline" className={cn(
              "text-[9px] font-black uppercase tracking-widest h-5 px-2.5 rounded-full border shadow-sm backdrop-blur-md",
              isActive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 group-hover:shadow-[0_0_15px_rgba(52,211,153,0.3)]" :
                isCancelled ? "bg-rose-500/10 text-rose-400 border-rose-500/30 group-hover:shadow-[0_0_15px_rgba(244,63,94,0.3)]" :
                  "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
            )}>
              {schedule.status}
            </Badge>
            <div className="flex ml-auto items-center gap-4">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/40 border border-white/5 text-[10px] font-bold text-zinc-400 shadow-inner">
                <Terminal className="size-3 opacity-60" />
                <span className="capitalize">{schedule.platform}</span>
              </span>
              <span className="text-[10px] font-bold text-zinc-600 font-mono tracking-tighter w-24 truncate opacity-50 text-right">#{schedule.id.split('-')[0]}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <p className="text-zinc-400 truncate max-w-2xl font-medium leading-relaxed group-hover:text-zinc-300 transition-colors">"{schedule.sourceText}"</p>
          </div>
        </div>

        {/* Schedule Stats Grid */}
        <div className="hidden lg:grid grid-cols-2 gap-x-8 gap-y-1 w-64 shrink-0 pl-6 border-l border-white/10">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-0.5">Pattern</span>
            <span className="text-xs font-bold text-zinc-200">{schedule.patternDescription}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-0.5">Total Runs</span>
            <span className="text-xs font-bold text-zinc-200 tabular-nums">{schedule.runsCompleted}</span>
          </div>
          <div className="flex flex-col col-span-2 pt-1">
            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-0.5 flex items-center gap-1">
              <History className="size-2.5" />
              Last Execution
            </span>
            <span className="text-xs font-bold text-zinc-400 tabular-nums">
              {schedule.lastRunAtIso ? new Date(schedule.lastRunAtIso).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
              }) : "Never"}
            </span>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 pl-6 ml-2 border-l border-white/5 opacity-40 group-hover:opacity-100 transition-opacity duration-300">
          <Button variant="ghost" size="icon" className="size-10 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all border border-transparent hover:border-white/10 shadow-sm active:scale-90">
            {isPaused || isCancelled ? <Play className="size-4.5 text-emerald-400 fill-emerald-400/20" /> : <Pause className="size-4.5 hover:text-amber-400 hover:fill-amber-400/20" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-10 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all border border-transparent hover:border-white/10 shadow-sm active:scale-90 data-[state=open]:bg-white/10 data-[state=open]:text-white">
                <MoreHorizontal className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-[#0f0f13]/95 backdrop-blur-xl border-white/10 text-zinc-300 p-1.5 shadow-2xl rounded-xl">
              <DropdownMenuItem className="rounded-lg gap-3 py-2.5 cursor-pointer focus:bg-white/10 focus:text-white font-medium transition-colors">
                <Activity className="size-4 text-cyan-400" />
                View Execution Logs
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-lg gap-3 py-2.5 cursor-pointer focus:bg-white/10 focus:text-white font-medium transition-colors">
                <Settings className="size-4 text-zinc-400" />
                Edit Configuration
              </DropdownMenuItem>
              <div className="h-px bg-white/10 my-1.5" />
              <DropdownMenuItem className="rounded-lg gap-3 py-2.5 cursor-pointer text-rose-400 focus:bg-rose-500/15 focus:text-rose-300 font-medium transition-colors">
                <Zap className="size-4 text-rose-400" />
                Force Run Now
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
