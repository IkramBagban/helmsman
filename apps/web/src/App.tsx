import * as React from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/app-sidebar"
import { ChatInterface } from "@/components/chat-interface"
import { CronScreen } from "@/components/cron-screen"

export function App() {
  const [screen, setScreen] = React.useState<"chat" | "cron">("cron")

  return (
    <ThemeProvider defaultTheme="dark" storageKey="helmsman-theme">
      <TooltipProvider>
        <SidebarProvider>
          <div className="flex min-h-svh w-full bg-[#050506] font-sans antialiased text-zinc-100">
            <AppSidebar screen={screen} onScreenChange={setScreen} />
            <SidebarInset className="bg-transparent overflow-hidden">
              <main className="flex h-svh flex-1 flex-col overflow-hidden relative">
                <div key={screen} className="flex-1 h-full animate-in fade-in slide-in-from-right-2 duration-500 ease-out">
                  {screen === "chat" ? <ChatInterface /> : <CronScreen />}
                </div>
              </main>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
