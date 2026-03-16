import * as React from "react"
import { Send, User, Anchor, Terminal, Bot, Wifi, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useChat } from "@/hooks/use-chat"

export function ChatInterface() {
  const { messages, isConnected, isTyping, sendMessage } = useChat();
  const [input, setInput] = React.useState("")
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const handleSend = () => {
    if (!input.trim()) return
    sendMessage(input)
    setInput("")
  }

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    }
  }, [messages, isTyping])

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
              <Bot className="size-6 text-primary" />
            </div>
            <div className={cn(
              "absolute bottom-0 right-0 size-3 rounded-full border-2 border-background",
              isConnected ? "bg-green-500" : "bg-red-500"
            )} />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Helmsman Agent</h2>
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground">
                {isConnected ? "Ready for deployment" : "Disconnected from Bridge"}
              </p>
              {isConnected ? <Wifi className="size-3 text-green-500/50" /> : <WifiOff className="size-3 text-red-500/50" />}
            </div>
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
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center opacity-50">
              <Anchor className="size-12 mb-4 text-primary" />
              <h3 className="text-lg font-medium">No active signals</h3>
              <p className="text-sm max-w-xs">Start a conversation with the Helmsman to begin orchestrating your infrastructure.</p>
            </div>
          )}
          
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
                msg.sender === "user" ? "flex-row-reverse" : "flex-row"
              )}
            >
              <Avatar className={cn(
                  "size-9 border",
                  msg.sender === "user" ? "border-primary/20" : "border-border shadow-sm"
              )}>
                <AvatarFallback className={cn(
                    msg.sender === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {msg.sender === "user" ? <User className="size-5" /> : <Anchor className="size-5" />}
                </AvatarFallback>
              </Avatar>
              <div className={cn(
                  "flex flex-col gap-2 max-w-[85%]",
                  msg.sender === "user" ? "items-end" : "items-start"
              )}>
                <div
                  className={cn(
                    "px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm transition-all",
                    msg.sender === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-none shadow-primary/10"
                      : "bg-card border border-border text-foreground rounded-tl-none ring-1 ring-border/5"
                  )}
                >
                  {msg.text}
                </div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-1">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-4 animate-pulse">
              <Avatar className="size-9 border border-border">
                <AvatarFallback className="bg-muted text-muted-foreground">
                  <Anchor className="size-5" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-muted/30 px-4 py-3 rounded-2xl rounded-tl-none border border-border/50 text-xs text-muted-foreground italic">
                Agent is calculating trajectories...
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-background via-background/95 to-transparent pt-12">
        <div className="max-w-3xl mx-auto relative group">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={!isConnected}
            placeholder={isConnected ? "Type your command (e.g., 'deploy to staging' or 'check logs')..." : "Connecting to Helmsman Bridge..."}
            className="h-14 pl-6 pr-16 bg-card/50 backdrop-blur-md border-border hover:border-primary/50 focus:border-primary/50 focus:ring-primary/20 transition-all rounded-2xl shadow-xl disabled:opacity-50"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || !isConnected}
            size="icon"
            className="absolute right-2 top-2 size-10 rounded-xl transition-transform active:scale-95 disabled:scale-100 shadow-lg shadow-primary/20"
          >
            <Send className="size-5" />
          </Button>
        </div>
        <p className="text-[10px] text-center mt-3 text-muted-foreground uppercase tracking-widest font-medium opacity-60">
            Press <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/20 font-sans">Enter</kbd> to execute command
        </p>
      </div>
    </div>
  )
}
