import type Docker from "dockerode";
import { AppError } from "@helmsman/shared";
import type { EgressRule } from "../types.js";

export const createTaskNetwork = async (docker: Docker, taskId: string, egressRules: readonly EgressRule[]): Promise<string> => {
  if (egressRules.length === 0) {
    return "none";
  }

  if (process.env.HELMSMAN_ENFORCE_EGRESS_ALLOWLIST !== "true") {
    throw new AppError(
      "RUNTIME.NETWORK_CREATE_FAILED",
      "Egress allowlist requested but enforcement is not enabled. Refusing to run fail-open.",
      { taskId },
    );
  }

  const network = await docker.createNetwork({
    Name: `helmsman-net-${taskId}`,
    Driver: "bridge",
    Options: { "com.docker.network.bridge.enable_icc": "false" },
  });

  if (!network.id) {
    throw new AppError("RUNTIME.NETWORK_CREATE_FAILED", "Failed to create task network.", { taskId });
  }

  return network.id;
};

export const removeTaskNetwork = async (docker: Docker, taskId: string): Promise<void> => {
  try {
    await docker.getNetwork(`helmsman-net-${taskId}`).remove();
  } catch {
    return;
  }
};
