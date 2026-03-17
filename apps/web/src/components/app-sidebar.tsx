import { MessageSquare, Calendar, Anchor } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

interface AppSidebarProps {
  readonly screen: "chat" | "cron"
  readonly onScreenChange: (screen: "chat" | "cron") => void
}

const items = [
  {
    title: "Chat",
    screen: "chat" as const,
    icon: MessageSquare,
  },
  {
    title: "Cron Jobs",
    screen: "cron" as const,
    icon: Calendar,
  },
]

export function AppSidebar({ screen, onScreenChange }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" className="border-r border-white/5 bg-[#08080a] select-none">
      <SidebarHeader className="flex flex-row items-center gap-4 px-6 py-8">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-cyan-500 text-black shadow-[0_0_20px_rgba(6,182,212,0.3)]">
          <Anchor className="size-6" />
        </div>
        <div className="flex flex-col gap-0.5 leading-none">
          <span className="font-bold text-xl tracking-tighter text-white">Helmsman</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-500/70">Orchestrator</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-3">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 px-3 mb-4">Command Post</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={screen === item.screen}
                    tooltip={item.title}
                    onClick={() => onScreenChange(item.screen)}
                    className={cn(
                        "h-12 rounded-2xl px-4 transition-all duration-300",
                        screen === item.screen 
                            ? "bg-white/5 text-cyan-400 border border-white/5 shadow-inner" 
                            : "text-zinc-500 hover:text-white hover:bg-white/[0.02]"
                    )}
                  >
                    <span className="flex items-center gap-4">
                      <item.icon className={cn("size-5", screen === item.screen ? "text-cyan-400" : "text-zinc-600")} />
                      <span className="font-medium text-[15px]">{item.title}</span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail className="hover:bg-cyan-500/10" />
    </Sidebar>
  )
}
