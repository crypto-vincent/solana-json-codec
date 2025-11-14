import { program } from "commander";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  casingLosslessConvertToSnake,
  ErrorStackable,
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
    const accountIdl = programIdl.accounts.get(accountName);
    if (accountIdl === undefined) {
      throw new ErrorStackable(
        `Program doens't have any account named: ${accountName}`,
        new ErrorStackable("must match:", [...programIdl.accounts.keys()]),
      );
    }
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
    const eventIdl = programIdl.events.get(eventName);
    if (eventIdl === undefined) {
      throw new ErrorStackable(
        `Program doens't have any event named: ${eventName}`,
        new ErrorStackable("must match:", [...programIdl.events.keys()]),
      );
    }
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
    const instructionIdl = programIdl.instructions.get(
      casingLosslessConvertToSnake(instructionName),
    );
    if (instructionIdl === undefined) {
      throw new ErrorStackable(
        `Program doens't have any instruction named: ${instructionName}`,
        new ErrorStackable("must match:", [...programIdl.instructions.keys()]),
      );
    }
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
    const instructionIdl = programIdl.instructions.get(
      casingLosslessConvertToSnake(instructionName),
    );
    if (instructionIdl === undefined) {
      throw new ErrorStackable(
        `Program doens't have any instruction named: ${instructionName}`,
        new ErrorStackable("must match:", [...programIdl.instructions.keys()]),
      );
    }
    printTypeJsonCodec(instructionIdl.return.typeFull, options.format);
  });

async function printTypeJsonCodec(
  typeFullIdl: IdlTypeFull,
  format: string | undefined,
) {
  if (format === "expression") {
    return console.log(idlTypeFullJsonCodecExpression(typeFullIdl, new Set()));
  }
  if (format === undefined || format === "module") {
    return console.log(idlTypeFullJsonCodecModule(typeFullIdl, "jsonCodec"));
  }
  throw new Error(
    `Unsupported output format: ${format} (expected "module"/"expression")`,
  );
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
  return await solana.getOrLoadProgramIdl(
    pubkeyFromBase58(params.programAddress),
  );
}

export async function resolveUrlJson(urlOrPath: string): Promise<JsonValue> {
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
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  } catch (errorByUrl) {
    try {
      return JSON.parse(await fsp.readFile(path.resolve(urlOrPath), "utf8"));
    } catch (errorByPath) {
      throw new ErrorStackable(`Could not resolve URL: ${urlOrPath}`, [
        errorByUrl,
        errorByPath,
      ]);
    }
  }
}

try {
  await program.parseAsync();
} catch (error) {
  console.error(String(error));
}
