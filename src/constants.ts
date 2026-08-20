export const COMPONENT_SUFFIX = "Icon";

export const COMPLETION_TRIGGER_CHARACTERS = ["<"];

export const COMPLETION_LINE_PATTERN = /<([A-Za-z][A-Za-z0-9]*)?$/;

export const COMPLETION_LANGUAGE_IDS = [
  "typescriptreact",
  "javascriptreact",
  "vue",
] as const;

export const HIGHLIGHT_LANGUAGE_IDS = [
  "typescriptreact",
  "javascriptreact",
  "vue",
  "typescript",
  "javascript",
] as const;

export const KEYWORD_IDENTIFIERS = [
  "moe-icon",
  "moeicons",
  "MoeiconsProvider",
  "useMoeiconsTheme",
  "initIconPaths",
] as const;

export const IDENTIFIER_PATTERN = /[A-Za-z][A-Za-z0-9-]*/g;

export const LINKS = {
  website: "https://moeicons.com",
  repository: "https://github.com/moewolf-dev/moe-icons",
  pluginRepository: "https://github.com/moewolf-dev/moe-icons-plugins",
  documentation: "https://github.com/moewolf-dev/moe-icons#readme",
} as const;
