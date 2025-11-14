import { program } from "commander";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ErrorStackable,
  idlProgramParse,
  IdlTypeFull,
  idlTypeFullJsonCodecExpression,
  idlTypeFullJsonCodecModule,
  pubkeyFromBase58,
  Solana,
} from "solana-kiss";

program
  .name("solana-json-codec")
  .showHelpAfterError()
  .description("Generate javascript JSON codecs for solana programs")
  .option(
    "-p, --program <PROGRAM_ADDRESS>",
    "The program address to generate the JSON codec for",
  )
  .option(
    "-r, --rpc <RPC_URL_OR_MONIKER>",
    "The RPC URL to use for fetching anchor IDLs",
  )
  .option(
    "-i, --idl <IDL_URL_OR_FILE>",
    "The URL or file to use to fetch the program's IDL from",
  );

program
  .command("account-state")
  .description("Generate the JSON codec for an account's state")
  .argument("<ACCOUNT_NAME>", "The name of the account")
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
      throw new Error(`Program doens't have any account named: ${accountName}`);
    }
    outputTypeJsonCodec(accountIdl.typeFull, options.format);
  });

program
  .command("instruction-payload")
  .description("Generate the JSON codec for an instruction's payload")
  .argument("<INSTRUCTION_NAME>", "The name of the instruction")
  .option("-f, --format <FORMAT>", "Choose output format")
  .action(async (instructionName, options, command) => {
    const rootOptions = command.parent.opts();
    const programIdl = await resolveProgramIdl({
      idlUrlOrPath: rootOptions.idl,
      solanaRpcUrl: rootOptions.rpc,
      programAddress: rootOptions.program,
    });
    const instructionIdl = programIdl.instructions.get(instructionName);
    if (instructionIdl === undefined) {
      throw new Error(
        `Program doens't have any instruction named: ${instructionName}`,
      );
    }
    outputTypeJsonCodec(
      IdlTypeFull.struct({ fields: instructionIdl.args.typeFullFields }),
      options.format,
    );
  });

program
  .command("instruction-return")
  .description("Generate the JSON codec for an instruction's returned value")
  .argument("<INSTRUCTION_NAME>", "The name of the instruction")
  .option("-f, --format <FORMAT>", "Choose output format")
  .action(async (instructionName, options, command) => {
    const rootOptions = command.parent.opts();
    const programIdl = await resolveProgramIdl({
      idlUrlOrPath: rootOptions.idl,
      solanaRpcUrl: rootOptions.rpc,
      programAddress: rootOptions.program,
    });
    const instructionIdl = programIdl.instructions.get(instructionName);
    if (instructionIdl === undefined) {
      throw new Error(
        `Program doens't have any instruction named: ${instructionName}`,
      );
    }
    outputTypeJsonCodec(instructionIdl.return.typeFull, options.format);
  });

async function outputTypeJsonCodec(
  typeFullIdl: IdlTypeFull,
  format: string | undefined,
) {
  if (format === "expression") {
    const codeExpression = idlTypeFullJsonCodecExpression(
      typeFullIdl,
      new Set(),
    );
    console.log(codeExpression);
    return;
  }
  if (format === undefined || format === "module") {
    const codeModule = idlTypeFullJsonCodecModule(typeFullIdl, "jsonCodec");
    console.log(codeModule);
    return;
  }
  throw new Error(
    `Unsupported output format: ${format} (expected "module"/"expression")`,
  );
}

async function resolveProgramIdl(params: {
  idlUrlOrPath: string | undefined;
  solanaRpcUrl: string | undefined;
  programAddress: string | undefined;
}) {
  if (params.idlUrlOrPath !== undefined) {
    const programJson = await resolveUrlJson(params.idlUrlOrPath);
    return idlProgramParse(programJson!);
  }
  const solana = new Solana(params.solanaRpcUrl ?? "mainnet");
  if (params.programAddress === undefined) {
    throw new Error("Program address or IDL URL is required");
  }
  return await solana.getOrLoadProgramIdl(
    pubkeyFromBase58(params.programAddress),
  );
}

export async function resolveUrlJson(urlOrPath: string) {
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
      const filePath = fileURLToPath(url);
      return JSON.parse(await fsp.readFile(filePath, "utf8"));
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

program.parse();
