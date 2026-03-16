import * as React from "react"
import { Send, User, Anchor, Terminal, Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

type Message = {
  id: string
  role: "user" | "agent"
  content: string
  timestamp: Date
}

export function ChatInterface() {
  const [messages, setMessages] = React.useState<Message[]>([
    {
      id: "1",
      role: "agent",
      content: "Awaiting orders, Captain. How can I assist with your infrastructure today?",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = React.useState("")
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const handleSend = () => {
    if (!input.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")

    // Mock agent response
    setTimeout(() => {
      const agentMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: "Understood. I'm analyzing the requested operation. Please stand by.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, agentMessage])
    }, 1000)
  }

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    }
  }, [messages])

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
              <Bot className="size-6 text-primary" />
            </div>
            <div className="absolute bottom-0 right-0 size-3 bg-green-500 rounded-full border-2 border-background" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Helmsman Agent</h2>
            <p className="text-xs text-muted-foreground">Ready for deployment</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2 h-8">
                <Terminal className="size-3.5" />
                <span>Logs</span>
            </Button>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-6 md:px-8" viewportRef={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-8 pb-32">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              )}
            >
              <Avatar className={cn(
                  "size-9 border",
                  msg.role === "user" ? "border-primary/20" : "border-border"
              )}>
                <AvatarFallback className={cn(
                    msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {msg.role === "user" ? <User className="size-5" /> : <Anchor className="size-5" />}
                </AvatarFallback>
              </Avatar>
              <div className={cn(
                  "flex flex-col gap-2 max-w-[85%]",
                  msg.role === "user" ? "items-end" : "items-start"
              )}>
                <div
                  className={cn(
                    "px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-none"
                      : "bg-card border border-border text-foreground rounded-tl-none ring-1 ring-border/5"
                  )}
                >
                  {msg.content}
                </div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-1">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-background via-background to-transparent pt-10">
        <div className="max-w-3xl mx-auto relative group">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type your command (e.g., 'deploy to staging' or 'check logs')..."
            className="h-14 pl-6 pr-16 bg-card/50 backdrop-blur-sm border-border hover:border-primary/50 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-2xl shadow-xl"
          />
          <Button
            onClick={handleSend}
            size="icon"
            className="absolute right-2 top-2 size-10 rounded-xl transition-transform active:scale-95"
          >
            <Send className="size-5" />
          </Button>
        </div>
        <p className="text-[10px] text-center mt-3 text-muted-foreground uppercase tracking-widest">
            Press <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-sans">Enter</kbd> to execute
        </p>
      </div>
    </div>
  )
}
