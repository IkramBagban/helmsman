import type { SkillDefinition } from "./types.js";

export const MAX_DYNAMIC_SKILLS = 2;

export const SKILL_CATALOG: readonly SkillDefinition[] = [
  {
    id: "core-truthfulness",
    name: "core-truthfulness",
    description:
      "Always-on anti-hallucination and safety policy for truthful agent behavior.",
    skillPath: "core-truthfulness",
    keywords: [],
    alwaysOn: true,
    priority: 100,
  },
  {
    id: "aws-operations",
    name: "aws-operations",
    description:
      "AWS live-state investigation and change policy. Trigger for AWS, cloud cost, IAM, EC2, S3, EKS, Kubernetes requests.",
    skillPath: "aws-operations",
    keywords: [
      "aws",
      "ec2",
      "s3",
      "rds",
      "cloudfront",
      "cloudwatch",
      "iam",
      "route53",
      "billing",
      "cost",
      "eks",
      "kubernetes",
    ],
    priority: 90,
  },
  {
    id: "scheduling",
    name: "scheduling",
    description:
      "Scheduling and reminders behavior. Trigger for remind, cron, timer, recurring checks, and schedule lifecycle commands.",
    skillPath: "scheduling",
    keywords: [
      "schedule",
      "scheduling",
      "remind",
      "reminder",
      "cron",
      "timer",
      "every",
      "daily",
      "weekly",
      "monthly",
      "pause",
      "resume",
      "cancel",
    ],
    priority: 85,
  },
  {
    id: "dns",
    name: "dns",
    description:
      "DNS record and domain operations behavior. Trigger for DNS, zones, records, TTL, nameserver, Cloudflare, Namecheap.",
    skillPath: "cloudflare-knowledge",
    keywords: [
      "dns",
      "domain",
      "subdomain",
      "record",
      "zone",
      "ttl",
      "nameserver",
      "cloudflare",
      "namecheap",
      "txt",
      "mx",
      "cname",
      "a record",
      "aaaa",
    ],
    requires: {
      env: ["CLOUDFLARE_API_TOKEN"],
    },
    priority: 80,
  },
];
