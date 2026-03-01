/**
 * Helmsman Infrastructure Workflow — Mastra Workflow with suspend/resume.
 *
 * This workflow handles multi-step operations and operations requiring approval.
 * It uses Mastra's native suspend/resume for human-in-the-loop approval gates:
 *
 * Flow:
 * 1. Evaluate risk of the action/plan
 * 2. If significant/destructive → suspend for approval
 * 3. On resume with approval → execute the action(s)
 * 4. Return results
 *
 * For simple operations (read_only/low_risk), the workflow runs straight through.
 * For risky operations, it suspends and waits for the user to approve.
 */

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ActionInputSchema = z.object({
  command: z.string().describe("The CLI command to execute"),
  riskTier: z.string().describe("Risk tier: read_only, low_risk, significant, destructive"),
  userId: z.string().describe("The user who initiated the request"),
  chatId: z.string().describe("The chat where the request came from"),
  description: z.string().optional().describe("Human-readable description of what this does"),
});

const ApprovalResumeSchema = z.object({
  approved: z.boolean().describe("Whether the user approved the action"),
});

const ActionOutputSchema = z.object({
  success: z.boolean(),
  output: z.string(),
  error: z.string().optional(),
  wasApproved: z.boolean(),
});

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * Step 1: Risk Evaluation & Approval Gate
 *
 * If the action is significant or destructive, suspend for human approval.
 * Read-only and low-risk actions pass through immediately.
 */
export const approvalStep = createStep({
  id: "approval-gate",
  inputSchema: ActionInputSchema,
  outputSchema: z.object({
    command: z.string(),
    approved: z.boolean(),
    riskTier: z.string(),
  }),
  resumeSchema: ApprovalResumeSchema,
  suspendSchema: z.object({
    command: z.string(),
    riskTier: z.string(),
    description: z.string().optional(),
    message: z.string(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    const { command, riskTier, description } = inputData;

    // Read-only and low-risk operations pass through without approval
    if (riskTier === "read_only" || riskTier === "low_risk") {
      return { command, approved: true, riskTier };
    }

    // If we have resume data (user responded), check their decision
    if (resumeData) {
      return { command, approved: resumeData.approved, riskTier };
    }

    // Significant or destructive → suspend for approval
    const riskLabel = riskTier === "destructive" ? "DESTRUCTIVE" : "significant";
    const message = description
      ? `This ${riskLabel} action requires your approval:\n\n${description}\n\nCommand: ${command}`
      : `This ${riskLabel} action requires your approval:\n\nCommand: ${command}`;

    return await suspend({ command, riskTier, description, message });
  },
});

/**
 * Step 2: Execute the command
 *
 * If approved, execute via shell. If not approved, return a denial message.
 */
export const executeStep = createStep({
  id: "execute-action",
  inputSchema: z.object({
    command: z.string(),
    approved: z.boolean(),
    riskTier: z.string(),
  }),
  outputSchema: ActionOutputSchema,
  execute: async ({ inputData }) => {
    const { command, approved, riskTier: _riskTier } = inputData;

    if (!approved) {
      return {
        success: false,
        output: "",
        error: "Action was not approved by the user.",
        wasApproved: false,
      };
    }

    // Execute via shell using Bun.spawn (same mechanism as ShellExecuteTool)
    try {
      const args = command.split(/\s+/);
      const binary = args[0] ?? "";
      const binaryArgs = args.slice(1);

      const proc = Bun.spawn([binary, ...binaryArgs], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, AWS_PAGER: "" },
      });

      const timeoutMs = 30_000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error(`Command timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer === "object" && "unref" in timer) {
          timer.unref();
        }
      });

      const exitCode = await Promise.race([proc.exited, timeoutPromise]);
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        return {
          success: false,
          output: stdout,
          error: stderr || `Process exited with code ${exitCode}`,
          wasApproved: true,
        };
      }

      return {
        success: true,
        output: stdout || "(no output)",
        wasApproved: true,
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
        wasApproved: true,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Infrastructure action workflow.
 *
 * Flow: approvalStep → executeStep
 *
 * For read_only/low_risk: runs straight through.
 * For significant/destructive: suspends at approvalStep, waits for resume with approval.
 */
export const infraWorkflow = createWorkflow({
  id: "infra-action",
  inputSchema: ActionInputSchema,
  outputSchema: ActionOutputSchema,
})
  .then(approvalStep)
  .then(executeStep)
  .commit();

export type InfraWorkflowInput = z.infer<typeof ActionInputSchema>;
export type InfraWorkflowOutput = z.infer<typeof ActionOutputSchema>;
