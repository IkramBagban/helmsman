import { Routes, Route, useLocation } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/app-sidebar"
import { NAV_ITEMS } from "@/nav"

export function App() {
  const location = useLocation()

  return (
    <ThemeProvider defaultTheme="dark" storageKey="helmsman-theme">
      <TooltipProvider>
        <SidebarProvider>
          <div className="flex min-h-svh w-full bg-[#050506] font-sans antialiased text-zinc-100">
            <AppSidebar />
            <SidebarInset className="bg-transparent overflow-hidden">
              <main className="flex h-svh flex-1 flex-col overflow-hidden relative">
                <div key={location.pathname} className="flex-1 h-full animate-in fade-in slide-in-from-right-2 duration-500 ease-out">
                  <Routes location={location}>
                    {NAV_ITEMS.map((item) => (
                      <Route key={item.href} path={item.href} element={<item.component />} />
                    ))}
                  </Routes>
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
