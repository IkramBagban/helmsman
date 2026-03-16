import { ThemeProvider } from "@/components/theme-provider"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/app-sidebar"
import { ChatInterface } from "@/components/chat-interface"

export function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="helmsman-theme">
      <TooltipProvider>
        <SidebarProvider>
          <div className="flex min-h-svh w-full bg-background">
            <AppSidebar />
            <SidebarInset>
              <main className="flex-1 flex flex-col h-svh overflow-hidden">
                <ChatInterface />
              </main>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
