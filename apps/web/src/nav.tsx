import { MessageSquare, Calendar } from "lucide-react"
import { ChatInterface } from "@/components/chat-interface"
import { CronScreen } from "@/components/cron-screen"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  readonly title: string
  readonly href: string
  readonly icon: LucideIcon
  readonly component: React.ComponentType
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    title: "Chat",
    href: "/",
    icon: MessageSquare,
    component: ChatInterface,
  },
  {
    title: "Cron Jobs",
    href: "/cron",
    icon: Calendar,
    component: CronScreen,
  },
] as const
