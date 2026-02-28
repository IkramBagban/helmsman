# @helmsman/agent-core

Core agent service that accepts normalized chat messages and returns AI responses.

## Provider abstraction

Use `createLLMProvider` to select a provider (`openai` or `echo`).

```ts
import { createLLMProvider, HelmsmanAgentService } from "@helmsman/agent-core";
```
