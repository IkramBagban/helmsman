import { spawn } from "bun";

export async function executeAWSCommand(command: string): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const args = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const cleanArgs = args.map(arg => arg.replace(/^"|"$/g, ""));
    
    if (cleanArgs[0] !== "aws") {
      throw new Error("Command must start with 'aws'");
    }

    const proc = spawn(cleanArgs, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return { success: false, output: stdout, error: stderr || `Process exited with code ${exitCode}` };
    }

    return { success: true, output: stdout };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: errorMsg };
  }
}
