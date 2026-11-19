import { redactText, sanitizeDetail, type LogDetail, type RedactOptions } from "./redact";

export interface LogSink {
  appendLine(value: string): void;
}

export interface LoggerOptions {
  /** Read the setting on every call so changes apply without reloading. */
  readonly diagnosticEnabled: () => boolean;
  readonly now?: () => Date;
  readonly homeDir?: () => string | undefined;
}

type Level = "info" | "warn" | "error" | "debug";

/**
 * Session-only output channel writer. Lifecycle and error codes are always
 * recorded; details are included only while `moeicons.enableDiagnosticOutput`
 * is enabled. The channel is never persisted by this class.
 */
export class MoeiconsLogger {
  constructor(private readonly sink: LogSink, private readonly options: LoggerOptions) {}

  private get redactOptions(): RedactOptions {
    const homeDir = this.options.homeDir?.();
    return homeDir === undefined ? {} : { homeDir };
  }

  private write(level: Level, event: string, detail?: LogDetail, forceDetail = false): void {
    const timestamp = (this.options.now?.() ?? new Date()).toISOString();
    const includeDetail = forceDetail || this.options.diagnosticEnabled();
    const detailText = includeDetail ? sanitizeDetail(detail, this.redactOptions) : undefined;
    const safeEvent = redactText(event, this.redactOptions).replace(/[\r\n\t]+/g, " ").slice(0, 160);
    this.sink.appendLine(`${timestamp} [${level}] ${safeEvent}${detailText === undefined ? "" : ` ${detailText}`}`);
  }

  lifecycle(event: string, detail?: LogDetail): void {
    this.write("info", event, detail);
  }

  warn(event: string, detail?: LogDetail): void {
    this.write("warn", event, detail);
  }

  /** Always records the plugin error code; details stay gated. */
  error(code: string, detail?: LogDetail): void {
    this.write("error", code, detail);
  }

  /** Short-lived detail for an explicitly enabled diagnostic session. */
  diagnostic(event: string, detail?: LogDetail): void {
    if (!this.options.diagnosticEnabled()) return;
    this.write("debug", event, detail, true);
  }
}
