# tools-aws

AWS tool implementations exposed to the agent (EC2, S3, CloudWatch, Cost Explorer, IAM).

## Responsibility
Provides the agent with real AWS capabilities. Each tool maps to one or more AWS SDK calls.

## Key Files
```
src/
  tools.ts        ← All AWS tools registered with the agent
  classifier.ts   ← Classifies AWS intent to the right service/action
  executor.ts     ← Executes classified AWS actions via SDK
  index.ts        ← Exports
```

## Exports
- `awsTools` — array of AWS tools to register with the agent

## Env Vars
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_DEFAULT_REGION`

## Dependencies
`@helmsman/shared`, `@helmsman/tools`, AWS SDK v3 packages
