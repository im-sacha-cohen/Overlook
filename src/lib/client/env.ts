import type { EnvType } from "../types";

export interface EnvColors {
  bg: string;
  fg: string;
  border: string;
  strong: string;
}

export const ENV_COLORS: Record<EnvType, EnvColors> = {
  local: { bg: "var(--env-local-bg)", fg: "var(--env-local-fg)", border: "var(--env-local-border)", strong: "var(--env-local-strong)" },
  dev: { bg: "var(--env-dev-bg)", fg: "var(--env-dev-fg)", border: "var(--env-dev-border)", strong: "var(--env-dev-strong)" },
  staging: { bg: "var(--env-staging-bg)", fg: "var(--env-staging-fg)", border: "var(--env-staging-border)", strong: "var(--env-staging-strong)" },
  prod: { bg: "var(--env-prod-bg)", fg: "var(--env-prod-fg)", border: "var(--env-prod-border)", strong: "var(--env-prod-strong)" },
  custom: { bg: "var(--env-custom-bg)", fg: "var(--env-custom-fg)", border: "var(--env-custom-border)", strong: "var(--env-custom-strong)" },
};

export const ENV_ORDER: EnvType[] = ["prod", "staging", "dev", "local", "custom"];
