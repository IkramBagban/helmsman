import type { TelegramUpdate } from "@helmsman/shared";

export type SupportedTelegramUpdate = TelegramUpdate & {
  readonly message: NonNullable<TelegramUpdate["message"]>;
};
