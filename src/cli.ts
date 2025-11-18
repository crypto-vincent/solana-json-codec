import { program } from "commander";
import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  casingLosslessConvertToCamel,
  casingLosslessConvertToSnake,
  ErrorStack,
  IdlProgram,
  idlProgramParse,
  IdlTypeFull,
  idlTypeFullJsonCodecExpression,
  idlTypeFullJsonCodecModule,
  JsonValue,
  pubkeyFromBase58,
  Solana,
  withErrorContext,
} from "solana-kiss";

program
  .name("solana-json-codec")
  .description("Generate javascript JSON codecs for solana programs")
  .option(
    "-p, --program <PROGRAM_ADDRESS>",
    "The program address to generate a JSON codec for",
  )
  .option(
    "-r, --rpc <RPC_URL_OR_MONIKER>",
    "The RPC URL to use for fetching onchain anchor IDLs",
  )
  .option(
    "-i, --idl <IDL_URL_OR_PATH>",
    "The URL or path to load the program's IDL from",
  );

program
  .command("account-state")
  .description("Generate a JSON codec for an account's state")
  .argument("[ACCOUNT_NAME]", "Name of the account", "?")
  .option("-f, --format <FORMAT>", "Choose output format")
  .action(async (accountName, options, command) => {
    const rootOptions = command.parent.opts();
    const programIdl = await resolveProgramIdl({
      idlUrlOrPath: rootOptions.idl,
      solanaRpcUrl: rootOptions.rpc,
      programAddress: rootOptions.program,
    });
    const accountIdl = mapGetOrFail(
      programIdl.accounts,
      accountName,
      "account",
    );
    printTypeJsonCodec(accountIdl.typeFull, options.format);
  });

program
  .command("event-payload")
  .description("Generate a JSON codec for an event's payload")
  .argument("[EVENT_NAME]", "Name of the event", "?")
  .option("-f, --format <FORMAT>", "Choose output format")
  .action(async (eventName, options, command) => {
    const rootOptions = command.parent.opts();
    const programIdl = await resolveProgramIdl({
      idlUrlOrPath: rootOptions.idl,
      solanaRpcUrl: rootOptions.rpc,
      programAddress: rootOptions.program,
    });
    const eventIdl = mapGetOrFail(programIdl.events, eventName, "event");
    printTypeJsonCodec(eventIdl.typeFull, options.format);
  });

program
  .command("instruction-payload")
  .description("Generate a JSON codec for an instruction's payload")
  .argument("[INSTRUCTION_NAME]", "Name of the instruction", "?")
  .option("-f, --format <FORMAT>", "Choose output format")
  .action(async (instructionName, options, command) => {
    const rootOptions = command.parent.opts();
    const programIdl = await resolveProgramIdl({
      idlUrlOrPath: rootOptions.idl,
      solanaRpcUrl: rootOptions.rpc,
      programAddress: rootOptions.program,
    });
    const instructionIdl = mapGetOrFail(
      programIdl.instructions,
      instructionName,
      "instruction",
    );
    printTypeJsonCodec(
      IdlTypeFull.struct({ fields: instructionIdl.args.typeFullFields }),
      options.format,
    );
  });

program
  .command("instruction-result")
  .description("Generate a JSON codec for an instruction's result")
  .argument("[INSTRUCTION_NAME]", "Name of the instruction", "?")
  .option("-f, --format <FORMAT>", "Choose output format")
  .action(async (instructionName, options, command) => {
    const rootOptions = command.parent.opts();
    const programIdl = await resolveProgramIdl({
      idlUrlOrPath: rootOptions.idl,
      solanaRpcUrl: rootOptions.rpc,
      programAddress: rootOptions.program,
    });
    const instructionIdl = mapGetOrFail(
      programIdl.instructions,
      instructionName,
      "instruction",
    );
    printTypeJsonCodec(instructionIdl.return.typeFull, options.format);
  });

async function printTypeJsonCodec(
  typeFullIdl: IdlTypeFull,
  format: string | undefined,
) {
  if (format === undefined || format === "module") {
    return console.log(idlTypeFullJsonCodecModule(typeFullIdl, "jsonCodec"));
  }
  if (format === "expression") {
    return console.log(idlTypeFullJsonCodecExpression(typeFullIdl, new Set()));
  }
  throwWithOptions(`Unsupported output format: ${format}`, [
    "module (default)",
    "expression",
  ]);
}

async function resolveProgramIdl(params: {
  idlUrlOrPath: string | undefined;
  solanaRpcUrl: string | undefined;
  programAddress: string | undefined;
}): Promise<IdlProgram> {
  if (params.idlUrlOrPath !== undefined) {
    const idlUrlOrPath = params.idlUrlOrPath;
    return idlProgramParse(
      await withErrorContext(
        `Resolving IDL from URL: ${idlUrlOrPath}`,
        async () => await resolveUrlJson(idlUrlOrPath),
      ),
    );
  }
  const solana = new Solana(params.solanaRpcUrl ?? "mainnet");
  if (params.programAddress === undefined) {
    throw new Error("Either --idl or --program must be specified");
  }
  const { programIdl } = await solana.getOrLoadProgramIdl(
    pubkeyFromBase58(params.programAddress),
  );
  return programIdl;
}

async function resolveUrlJson(urlOrPath: string): Promise<JsonValue> {
  try {
    let url = new URL(urlOrPath);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} while fetching ${url.toString()}`);
      }
      return await res.json();
    }
    if (url.protocol === "file:") {
      return JSON.parse(await fsp.readFile(fileURLToPath(url), "utf8"));
    }
    throwWithOptions(`Unsupported URL protocol: ${url.protocol}`, [
      "http",
      "https",
      "file",
    ]);
  } catch (errorByUrl) {
    try {
      return JSON.parse(await fsp.readFile(resolve(urlOrPath), "utf8"));
    } catch (errorByPath) {
      throw new ErrorStack(`Could not resolve URL: ${urlOrPath}`, [
        errorByUrl,
        errorByPath,
      ]);
    }
  }
}

function mapGetOrFail<Value>(
  map: Map<string, Value>,
  key: string,
  context: string,
): Value {
  const value = map.get(key);
  if (value !== undefined) {
    return value;
  }
  const keyCamel = casingLosslessConvertToCamel(key);
  const valueCamel = map.get(keyCamel);
  if (valueCamel !== undefined) {
    return valueCamel;
  }
  const keySnake = casingLosslessConvertToSnake(key);
  const valueSnake = map.get(keySnake);
  if (valueSnake !== undefined) {
    return valueSnake;
  }
  if (map.size === 0) {
    throw new Error(`Program has no known ${context}s defined`);
  }
  throw new ErrorStack(
    `Program doesn't have any ${context} named: ${key}`,
    [...map.keys()].map((k) => `Expected: ${k}`),
  );
}

function throwWithOptions(message: string, options: string[]): never {
  throw new ErrorStack(
    message,
    options.map((opt) => `Expected: ${opt}`),
  );
}

try {
  await program.parseAsync();
} catch (error) {
  console.error(String(error));
  process.exit(1);
}
