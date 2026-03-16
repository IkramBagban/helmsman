import { useState, useEffect, useCallback, useRef } from "react";
import { type AgentResponse } from "@helmsman/shared";

export interface Message {
  id: string;
  text: string;
  sender: "user" | "agent";
  timestamp: Date;
  status?: "pending" | "success" | "error";
  error?: string;
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    // Use environment variable for WebSocket URL or fallback to localhost
    const wsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:3500";
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      console.log("⚓ Connected to Helmsman Bridge");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "response") {
          const response: AgentResponse = data.payload;
          setIsTyping(false);
          const agentMessage: Message = {
            id: response.correlationId || crypto.randomUUID(),
            text: response.text,
            sender: "agent",
            timestamp: new Date(),
            status: response.status === "error" ? "error" : "success"
          };
          setMessages((prev) => [...prev, agentMessage]);
        }
      } catch (err) {
        console.error("Failed to parse agent signal", err);
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
      console.log("📡 Bridge signal lost. Reconnecting...");
      // Auto-reconnect after 3s
      setTimeout(connect, 3000);
    };

    socket.onerror = (err) => {
      console.error("Bridge connection error:", err);
      socket.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((text: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.error("Cannot transmit: Bridge not ready");
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      text,
      sender: "user",
      timestamp: new Date(),
      status: "pending"
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    socketRef.current.send(JSON.stringify({
      text,
      chatId: "web-client-alpha", // Placeholder for actual session management
      userId: "captain-major"
    }));
  }, []);

  return {
    messages,
    isConnected,
    isTyping,
    sendMessage
  };
}
