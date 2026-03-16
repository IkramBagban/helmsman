import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { type NormalizedMessage, type AgentResponse } from "@helmsman/shared";
import { type AgentService } from "../../services/agent-service.js";
import { type ScheduleMessageSender } from "@helmsman/scheduling";

export class WebTransport implements ScheduleMessageSender {
  private wss: WebSocketServer;
  private connections = new Map<string, WebSocket>();

  constructor(
    private readonly httpServer: HttpServer,
    private readonly agentService: AgentService
  ) {
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.initialize();
    
    // Register this transport as a sender in the agent service
    this.agentService.registerSender("web", this);
    this.agentService.registerSender("website", this); // Support both aliases
  }

  private initialize() {
    this.wss.on("connection", (ws: WebSocket) => {
      const connectionId = randomUUID();
      this.connections.set(connectionId, ws);
      console.log(`Web client connected via WS (id: ${connectionId})`);

      ws.on("message", async (data: string) => {
        try {
          const payload = JSON.parse(data.toString());
          const correlationId = randomUUID();

          // Support stable session IDs from client
          const chatId = payload.chatId || connectionId;
          const userId = payload.userId || "web-user";
          
          // Re-map connection to this stable chatId if provided
          if (payload.chatId) {
            this.connections.set(payload.chatId, ws);
          }

          // 1. Inbound Reception & Normalization
          const normalized: NormalizedMessage = {
            platform: "web",
            chatId, 
            userId,
            messageId: randomUUID(),
            text: payload.text,
            timestamp: new Date(),
            correlationId,
            metadata: {
              source: "ws"
            }
          };

          // 2. Processing (via AgentService)
          const response: AgentResponse = await this.agentService.handleMessage(normalized);

          // 3. Outbound Dispatch
          ws.send(JSON.stringify({ type: "response", payload: response }));
        } catch (error) {
          console.error("WS error processing message", error);
          ws.send(JSON.stringify({
            type: "response",
            payload: {
              text: "I encountered an error processing that command.",
              status: "error",
              correlationId: randomUUID()
            }
          }));
        }
      });

      ws.on("close", () => {
        this.connections.delete(connectionId);
        console.log(`Web client disconnected from WS (id: ${connectionId})`);
      });
    });
  }

  // --- ScheduleMessageSender implementation ---

  async sendTyping(chatId: string): Promise<void> {
    const ws = this.connections.get(chatId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "typing", payload: { isTyping: true } }));
    }
  }

  async sendResponse(chatId: string, text: string): Promise<void> {
    const ws = this.connections.get(chatId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: "response", 
        payload: { 
          text, 
          status: "success", 
          correlationId: randomUUID() 
        } 
      }));
    } else {
      // If client is gone, we might want to broadcast to all or log
      console.warn(`Attempted to send WS response to ${chatId} but client is not connected.`);
    }
  }
}
