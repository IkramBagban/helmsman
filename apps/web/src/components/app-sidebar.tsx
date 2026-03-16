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

const items = [
  {
    title: "Chat",
    url: "#",
    icon: MessageSquare,
    isActive: true,
  },
  {
    title: "Cron Jobs",
    url: "#",
    icon: Calendar,
  },
]

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="flex flex-row items-center gap-2 px-4 py-4">
        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Anchor className="size-5" />
        </div>
        <div className="flex flex-col gap-0.5 leading-none">
          <span className="font-semibold text-lg tracking-tight">Helmsman</span>
          <span className="text-xs text-muted-foreground">DevOps Agent</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={item.isActive} tooltip={item.title}>
                    <a href={item.url} className="flex items-center gap-3">
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
