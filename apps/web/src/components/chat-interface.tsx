import * as React from "react"
import { Send, User, Anchor, Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
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
    <div className="flex flex-col h-screen relative overflow-hidden bg-[#050506] text-zinc-100">
      {/* Background Glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[-5%] size-[500px] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] size-[500px] rounded-full bg-violet-500/10 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-8 py-6 border-b border-white/5 bg-black/20 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="size-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
              <Bot className="size-7 text-cyan-400" />
            </div>
            <div className={cn(
              "absolute -bottom-1 -right-1 size-4 rounded-full border-4 border-[#050506]",
              isConnected ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" : "bg-zinc-700"
            )} />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white">Helmsman Bridge</h2>
          </div>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 px-4 py-6 md:px-8 relative z-0" viewportRef={scrollRef}>
        <div className="max-w-4xl mx-auto space-y-10 pb-10">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center opacity-40">
              <Anchor className="size-16 mb-6 text-cyan-500/50" />
              <h3 className="text-xl font-medium text-white">Idle Command Deck</h3>
              <p className="text-sm text-zinc-400 max-w-sm mt-2 font-light">The Helmsman is on standby. Issue a directive to begin infrastructure orchestration.</p>
            </div>
          )}
          
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-5 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out",
                msg.sender === "user" ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                  "size-10 rounded-xl flex items-center justify-center shrink-0 shadow-2xl",
                  msg.sender === "user" 
                    ? "bg-zinc-800 border border-zinc-700 text-zinc-400" 
                    : "bg-cyan-500 text-black shadow-cyan-500/20"
              )}>
                {msg.sender === "user" ? <User className="size-5" /> : <Bot className="size-5" />}
              </div>
              <div className={cn(
                  "flex flex-col gap-2.5 max-w-[80%]",
                  msg.sender === "user" ? "items-end" : "items-start"
              )}>
                <div
                  className={cn(
                    "px-5 py-4 rounded-[24px] text-sm leading-relaxed transition-all tracking-tight",
                    msg.sender === "user"
                      ? "bg-zinc-900 border border-white/10 text-zinc-100 rounded-tr-none"
                      : "bg-[#131316] border border-cyan-500/20 text-zinc-100 rounded-tl-none shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl"
                  )}
                >
                  {msg.text}
                </div>
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-tighter">
                    {msg.sender === "user" ? "Direct Request" : "Agent Response"}
                  </span>
                  <span className="size-1 rounded-full bg-zinc-800" />
                  <span className="text-[10px] text-zinc-500 font-medium">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-5 animate-pulse">
              <div className="size-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                <Bot className="size-5 text-cyan-400" />
              </div>
              <div className="bg-cyan-500/[0.03] border border-cyan-500/10 px-5 py-3.5 rounded-3xl rounded-tl-none text-[13px] text-cyan-400/80 font-medium tracking-wide shadow-inner">
                Agent is typing...
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="shrink-0 relative z-10 px-6 pb-10 pt-6 bg-gradient-to-t from-[#050506] via-[#050506]/98 to-transparent">
        <div className="max-w-4xl mx-auto relative group">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={!isConnected}
            placeholder={isConnected ? "Speak to the helmsman..." : "Re-establishing bridge connection..."}
            className="h-16 pl-8 pr-20 bg-white/[0.03] backdrop-blur-3xl border-white/5 hover:border-cyan-500/30 focus:border-cyan-500/50 focus:ring-0 transition-all rounded-[24px] shadow-2xl text-[15px] placeholder:text-zinc-600 disabled:opacity-50"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || !isConnected}
            size="icon"
            className="absolute right-3 top-3 size-10 rounded-xl bg-cyan-500 text-black hover:bg-cyan-400 transition-all active:scale-90 shadow-lg shadow-cyan-500/20"
          >
            <Send className="size-5" />
          </Button>
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] whitespace-nowrap opacity-50 group-hover:opacity-100 transition-opacity">
            <span>Orchestration Layer v1.0</span>
            <span className="size-1 rounded-full bg-zinc-800" />
            <span>Encrypted Tunnel Active</span>
          </div>
        </div>
      </div>
    </div>
  )
}
