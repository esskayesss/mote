import { LogLayer } from "loglayer";
import { redactionPlugin } from "@loglayer/plugin-redaction";
import { getSimplePrettyTerminal } from "@loglayer/transport-simple-pretty-terminal";
import { serializeError } from "serialize-error";
import chalk from "chalk";

type LogMetadata = Record<string, unknown>;
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
type WrappedLogger = {
  trace: (message: string, metadata?: LogMetadata) => void;
  debug: (message: string, metadata?: LogMetadata) => void;
  info: (message: string, metadata?: LogMetadata) => void;
  warn: (message: string, metadata?: LogMetadata) => void;
  error: (message: string, metadata?: LogMetadata) => void;
  fatal: (message: string, metadata?: LogMetadata) => void;
  withMetadata: (metadata?: LogMetadata) => WrappedLogger;
  withContext: (context?: LogMetadata) => WrappedLogger;
  child: (context?: LogMetadata) => WrappedLogger;
};

const splitErrorMetadata = (metadata?: LogMetadata) => {
  if (!metadata) {
    return { error: undefined, metadata: undefined as LogMetadata | undefined };
  }

  const { error, ...rest } = metadata;
  return {
    error,
    metadata: Object.keys(rest).length > 0 ? rest : undefined
  };
};

const theme = {
  colors: {
    trace: chalk.gray,
    fatal: chalk.redBright.bold
  },
  dataKeyColor: chalk.blueBright,
  dataValueColor: chalk.white
} as const;

export const getLogger = (
  appName: string,
  runtime: "node" | "browser" = "node",
  redactions: { censor: string; keys: string[] }[] = []
) => {
  const redactionPlugins = redactions.map(({ censor, keys }) =>
    redactionPlugin({
      paths: keys,
      censor
    })
  );

  const baseLogger = new LogLayer({
    errorSerializer: serializeError,
    transport: [
      getSimplePrettyTerminal({
        runtime,
        viewMode: "expanded",
        theme,
        enabled: true,
        timestampFormat: `' ${chalk.yellow(appName)}:' yy-MM-dd HH:mm:ss `
      })
    ],
    plugins: [...redactionPlugins]
  });

  const wrapLogger = (target: LogLayer, context?: LogMetadata, baseMetadata?: LogMetadata): WrappedLogger => {
    const logWithMetadata = (level: LogLevel, message: string, metadata?: LogMetadata) => {
      const mergedMetadata = {
        ...(context ?? {}),
        ...(baseMetadata ?? {}),
        ...(metadata ?? {})
      };
      const { error, metadata: safeMetadata } = splitErrorMetadata(
        Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined
      );

      let builder:
        | ReturnType<typeof target.withMetadata>
        | ReturnType<typeof target.withError>
        | LogLayer = target;

      if (safeMetadata) {
        builder = target.withMetadata(safeMetadata);
      }

      if (error !== undefined) {
        builder = "withError" in builder ? builder.withError(error) : target.withError(error);
      }

      builder[level](message);
    };

    return {
      trace: (message: string, metadata?: LogMetadata) => logWithMetadata("trace", message, metadata),
      debug: (message: string, metadata?: LogMetadata) => logWithMetadata("debug", message, metadata),
      info: (message: string, metadata?: LogMetadata) => logWithMetadata("info", message, metadata),
      warn: (message: string, metadata?: LogMetadata) => logWithMetadata("warn", message, metadata),
      error: (message: string, metadata?: LogMetadata) => logWithMetadata("error", message, metadata),
      fatal: (message: string, metadata?: LogMetadata) => logWithMetadata("fatal", message, metadata),
      withMetadata: (nextMetadata?: LogMetadata) =>
        wrapLogger(target, context, {
          ...(baseMetadata ?? {}),
          ...(nextMetadata ?? {})
        }),
      withContext: (nextContext?: LogMetadata) =>
        wrapLogger(target, {
          ...(context ?? {}),
          ...(nextContext ?? {})
        }, baseMetadata),
      child: (nextContext?: LogMetadata) =>
        wrapLogger(target.child(), {
          ...(context ?? {}),
          ...(nextContext ?? {})
        }, baseMetadata)
    };
  };

  return wrapLogger(baseLogger);
};

export type AppLogger = ReturnType<typeof getLogger>;
