import { AuditEvent } from "@helmsman/shared";

export interface AuditService {
  log(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void>;
  getEventsByCorrelationId(correlationId: string): Promise<AuditEvent[]>;
}

export class ConsoleAuditService implements AuditService {
  public async log(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void> {
    const auditEvent: AuditEvent = {
        ...event,
        id: crypto.randomUUID(),
        timestamp: new Date(),
    };
    console.log("[AUDIT]", JSON.stringify(auditEvent));
  }

  public async getEventsByCorrelationId(_correlationId: string): Promise<AuditEvent[]> {
    return [];
  }
}
