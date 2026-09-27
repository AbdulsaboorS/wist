#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import { PassportBundleSchema, type PassportBundle } from "@wist/api";

import { z } from "zod";

import { HandoffDraftInputSchema } from "./capture-input.js";
import { PassportApiClient } from "./client.js";
import { approveDraft, previewDraft, screenForSecrets, validateDraft } from "./draft.js";
import { startLocalDaemon } from "./daemon.js";
import { HandOffRunner } from "./hand-off/run.js";
import { LocalIdentityManager, MacOsKeychainIdentitySecretStore } from "./identity.js";
import { LocalPassportStore, MacOsKeychainConnectionSecretStore } from "./local-store.js";
import { LocalPassportWorkflow } from "./local-workflow.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredArgument(name: string): string {
  const value = argument(name);

  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

async function readJson(path: string): Promise<PassportBundle> {
  return PassportBundleSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function confirmApproval(): Promise<boolean> {
  if (process.argv.includes("--yes")) {
    return true;
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question("Publish exactly this preview? [y/N] ");
  prompt.close();

  return answer.trim().toLowerCase() === "y";
}

async function registeredIdentity(client: PassportApiClient, now: Date) {
  const identity = new LocalIdentityManager(new MacOsKeychainIdentitySecretStore());
  await client.registerIdentity(await identity.createRegistration(now));

  return identity;
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === undefined || command === "serve") {
    const store = LocalPassportStore.open(new MacOsKeychainConnectionSecretStore());

    const workflow = new LocalPassportWorkflow({
      store,
      identity: new LocalIdentityManager(new MacOsKeychainIdentitySecretStore()),
    });

    const daemon = await startLocalDaemon({ workflow, handOff: new HandOffRunner({ workflow }) });
    process.stdout.write(`Local Passport dashboard: ${daemon.dashboardUrl}\n`);

    if (command === undefined && process.platform === "darwin") {
      execFile("open", [daemon.dashboardUrl], (error) => {
        if (error !== null) process.stderr.write(`Could not open dashboard: ${error.message}\n`);
      });
    }

    const close = async () => {
      await daemon.close();
      store.close();
    };

    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());

    return;
  }

  if (command === "draft") {
    if (process.argv.includes("--schema")) {
      process.stdout.write(
        `${JSON.stringify(z.toJSONSchema(HandoffDraftInputSchema, { io: "input" }), null, 2)}\n`,
      );

      return;
    }

    const input = HandoffDraftInputSchema.parse(JSON.parse(await text(process.stdin)));
    const store = LocalPassportStore.open(new MacOsKeychainConnectionSecretStore());

    const workflow = new LocalPassportWorkflow({
      store,
      identity: new LocalIdentityManager(new MacOsKeychainIdentitySecretStore()),
    });

    try {
      const draft = await workflow.captureFromAgent(input, argument("--repo") ?? process.cwd());

      process.stdout.write(
        `Draft Handoff captured for ${draft.project.name}: ${draft.handoff.goal}\n` +
          "Review, approve, and share it in the dashboard: run `wist`.\n",
      );
    } finally {
      store.close();
    }

    return;
  }

  if (command === "skill") {
    const skill = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "wist");
    process.stdout.write(await readFile(join(skill, "SKILL.md"), "utf8"));

    return;
  }

  if (command === "capture") {
    const inputPath = requiredArgument("--input");
    const outputPath = requiredArgument("--output");
    const repositoryPath = argument("--repo") ?? process.cwd();
    const store = LocalPassportStore.open(new MacOsKeychainConnectionSecretStore());

    const workflow = new LocalPassportWorkflow({
      store,
      identity: new LocalIdentityManager(new MacOsKeychainIdentitySecretStore()),
    });

    const bundle = await workflow.capture(await readJson(inputPath), repositoryPath);
    store.close();
    await writeFile(outputPath, previewDraft(bundle), "utf8");
    process.stdout.write(`Captured draft to ${outputPath}\n`);

    return;
  }

  if (command === "validate") {
    await screenForSecrets(validateDraft(await readJson(requiredArgument("--input"))));
    process.stdout.write("Draft is valid and passed deterministic credential screening.\n");

    return;
  }

  if (command === "preview") {
    process.stdout.write(previewDraft(await readJson(requiredArgument("--input"))));

    return;
  }

  if (command === "assess") {
    const bundle = validateDraft(await readJson(requiredArgument("--input")));
    const client = new PassportApiClient(requiredArgument("--api"));
    const now = new Date();
    const identity = await registeredIdentity(client, now);
    const ownerToken = await identity.createOwnerToken({ projectId: bundle.project.id, now });
    process.stdout.write(`${JSON.stringify(await client.assess(bundle, ownerToken), null, 2)}\n`);

    return;
  }

  if (command === "approve") {
    const input = await readJson(requiredArgument("--input"));
    process.stdout.write(previewDraft(input));

    if (!(await confirmApproval())) {
      throw new Error("Approval cancelled.");
    }

    const approved = approveDraft(input, new Date().toISOString());
    const store = LocalPassportStore.open(new MacOsKeychainConnectionSecretStore());
    store.saveDraft(
      input,
      store.get(input.project.id)?.repositoryPath ?? argument("--repo") ?? process.cwd(),
    );
    store.approve(input.project.id, approved.handoff.approvedAt ?? new Date().toISOString());
    store.close();
    const outputPath = requiredArgument("--output");
    await writeFile(outputPath, previewDraft(approved), "utf8");
    process.stdout.write(`Approved Handoff written to ${outputPath}\n`);

    return;
  }

  if (command === "publish") {
    const bundle = validateDraft(await readJson(requiredArgument("--input")));
    const api = requiredArgument("--api");
    const store = LocalPassportStore.open(new MacOsKeychainConnectionSecretStore());
    store.saveApproved(
      bundle,
      store.get(bundle.project.id)?.repositoryPath ?? argument("--repo") ?? process.cwd(),
    );

    const workflow = new LocalPassportWorkflow({
      store,
      identity: new LocalIdentityManager(new MacOsKeychainIdentitySecretStore()),
    });

    const result = await workflow.publish(bundle.project.id, api);
    const connection = result.connection;

    if (connection === undefined) {
      throw new Error("Published Connection was not retained locally.");
    }

    const revealed = await store.reveal(connection.connectionId);
    store.close();
    process.stdout.write(`${JSON.stringify({ ...result, ...revealed }, null, 2)}\n`);

    return;
  }

  if (command === "retrieve") {
    const token = process.env.PASSPORT_READ_TOKEN;

    if (token === undefined) {
      throw new Error("PASSPORT_READ_TOKEN is required.");
    }

    const client = new PassportApiClient(requiredArgument("--api"));
    process.stdout.write(
      `${JSON.stringify(await client.getProject(requiredArgument("--project"), token), null, 2)}\n`,
    );

    return;
  }

  if (command === "revoke") {
    const api = requiredArgument("--api");
    const projectId = requiredArgument("--project");
    const store = LocalPassportStore.open(new MacOsKeychainConnectionSecretStore());

    const workflow = new LocalPassportWorkflow({
      store,
      identity: new LocalIdentityManager(new MacOsKeychainIdentitySecretStore()),
      client: () => new PassportApiClient(api),
    });

    if (store.get(projectId)?.shareId === undefined) {
      const client = new PassportApiClient(api);
      const now = new Date();
      const identity = await registeredIdentity(client, now);
      await client.revoke(
        projectId,
        await identity.createOwnerToken({ projectId, now }),
        argument("--reason") ?? "Revoked locally",
      );
    } else {
      await workflow.revoke(projectId, argument("--reason") ?? "Revoked locally");
    }

    store.close();
    process.stdout.write(`Revoked Project share ${projectId}\n`);

    return;
  }

  process.stdout.write(
    "Usage: wist <serve|draft|skill|capture|validate|preview|assess|approve|publish|retrieve|revoke> [options]\n",
  );
}

await main().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
