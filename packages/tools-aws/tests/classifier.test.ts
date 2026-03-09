import { describe, it, expect } from "bun:test";
import { classifyAWSCommand } from "../src/classifier.js";

describe("classifyAWSCommand", () => {
  // Read-only
  it("classifies describe as read", () =>
    expect(classifyAWSCommand("aws ec2 describe-instances")).toBe("read"));
  it("classifies list as read", () =>
    expect(classifyAWSCommand("aws s3api list-buckets")).toBe("read"));
  it("classifies get as read", () =>
    expect(classifyAWSCommand("aws iam get-role --role-name MyRole")).toBe("read"));

  // Operator
  it("classifies create as operator", () =>
    expect(classifyAWSCommand("aws ec2 run-instances --image-id ami-123")).toBe("operator"));
  it("classifies start as operator", () =>
    expect(classifyAWSCommand("aws ec2 start-instances --instance-ids i-abc")).toBe("operator"));

  // Commander
  it("classifies delete as commander", () =>
    expect(classifyAWSCommand("aws s3api delete-bucket --bucket my-bucket")).toBe("commander"));
  it("classifies terminate as commander", () =>
    expect(classifyAWSCommand("aws ec2 terminate-instances --instance-ids i-abc")).toBe("commander"));
  it("classifies s3 rb as commander", () =>
    expect(classifyAWSCommand("aws s3 rb s3://my-bucket --force")).toBe("commander"));
  it("classifies s3 rm as commander", () =>
    expect(classifyAWSCommand("aws s3 rm s3://my-bucket --recursive")).toBe("commander"));

  // Unknown
  it("rejects non-aws commands", () =>
    expect(classifyAWSCommand("gcloud compute instances list")).toBe("unknown"));
  it("rejects empty string", () =>
    expect(classifyAWSCommand("")).toBe("unknown"));
});
