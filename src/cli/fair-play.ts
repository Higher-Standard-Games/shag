/**
 * fair-play — review reports and counters, and record the sanctions a person
 * decides on. Safe beside a running lobby: it writes `fairplay.db`, and the
 * lobby reads bans at each login and closes banned connections within a minute.
 *
 * Nothing here decides on its own. Every sanction needs a reason, which the
 * player is shown with how to appeal (src/lobby/FairPlayStore.ts has the
 * retention rules).
 */
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { adminFilePath, adminNames, MIN_ADMIN_PASSWORD, removeAdmin, setAdmin } from "../lobby/AdminCredentials";
import { FairPlayStore, MAX_ADDRESS_BAN_MS, type SanctionKind } from "../lobby/FairPlayStore";
import { PlayerStore } from "../lobby/PlayerStore";

const DAY_MS = 24 * 60 * 60_000;
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const usage = `Usage: npm run fair-play -- <command> --data-dir <dir> [options]

  reports                               open player reports, oldest first
  account <id|name>                     an account's sanctions, reports and per-match counters
  sanctions                             every sanction kept
  ban <id|name> --reason "<text>" [--days N]
                                        ban an account (no --days: until lifted)
  restrict <id|name> --reason "<text>" [--days N]
                                        keep an account out of public rooms and the queue
  lift <sanction id>                    end a sanction now
  close-report <report id>              mark a report reviewed
  ban-address <address> --reason "<text>" --days N
                                        refuse logins from an address (at most ${MAX_ADDRESS_BAN_MS / DAY_MS} days)
  lift-address <address>                end an address ban
  prune                                 apply the retention rules now
  add-admin <name>                      add an admin panel login, or set its password
                                        (asked for, or read from stdin; at least ${MIN_ADMIN_PASSWORD} characters)
  remove-admin <name>                   remove an admin panel login
  admins                                list the admin panel logins

  --by <name>   who decided (kept with the sanction; default $USER)

The reason is shown to the player. Decide only after reviewing the evidence:
the counters are signals, not verdicts. A key cannot be looked up (only its
hash is kept): find the account by its name, in any capitals.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [command, target] = args;
if (!command || args.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
const dataDir = value("--data-dir");
if (!dataDir || dataDir.startsWith("--")) fail("An explicit --data-dir is required");
const dir = path.resolve(dataDir);
if (!fs.existsSync(dir)) fail(`No data directory at ${dir}`);
const adminFile = adminFilePath(dir);

/** The new password, asked for without echo on a terminal, else the first line of stdin. */
function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return Promise.resolve(fs.readFileSync(0, "utf8").split(/\r?\n/)[0] ?? "");
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void };
    process.stdout.write("Password: ");
    output._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

if (command === "add-admin" || command === "remove-admin" || command === "admins") {
  try {
    if (command === "admins") {
      console.log(adminNames(adminFile).join("\n") || "No admins: the panel is off");
    } else if (!target) {
      fail("Give an admin name");
    } else if (command === "remove-admin") {
      if (!removeAdmin(adminFile, target)) fail(`No admin named ${target}`);
      console.log(`Removed ${target}; their session ends at their next request`);
    } else {
      setAdmin(adminFile, target, await readPassword());
      console.log(`${target} can sign in at /admin (${adminFile})`);
    }
  } catch (error) {
    fail((error as Error).message);
  }
  process.exit(0);
}

const store = FairPlayStore.open(dir);
const by = value("--by") ?? process.env.USER ?? "operator";
const days = value("--days");
const durationMs = days === undefined ? null : Number(days) * DAY_MS;
if (durationMs !== null && !(durationMs > 0)) fail("--days must be a positive number");
/** The account a command names, by id or by its name in any capitals. */
const accountId = () => {
  if (!target) fail("Give an account id or name");
  if (/^\d+$/.test(target)) return Number(target);
  const players = PlayerStore.open(dir);
  try {
    return players.findByName(target)?.id ?? fail(`No account named "${target}"`);
  } finally {
    players.close();
  }
};
const reason = () => value("--reason") ?? fail('Give --reason "<text>": the player is shown it');
const print = (data: unknown) => console.log(JSON.stringify(data, null, 2));

try {
  switch (command) {
    case "reports":
      print(store.openReports());
      break;
    case "account": {
      const id = accountId();
      print({
        accountId: id,
        sanctions: store.sanctions().filter((s) => s.accountId === id),
        reports: store.reportsAbout(id),
        matches: store.signalsFor(id),
      });
      break;
    }
    case "sanctions":
      print(store.sanctions());
      break;
    case "ban":
    case "restrict": {
      const kind: SanctionKind = command === "ban" ? "ban" : "ranked";
      print(store.addSanction(accountId(), kind, reason(), durationMs, by));
      break;
    }
    case "lift":
      if (!store.liftSanction(Number(target))) fail("No sanction in force with that id");
      console.log(`Lifted sanction ${target}`);
      break;
    case "close-report":
      if (!store.closeReport(Number(target))) fail("No report with that id");
      console.log(`Closed report ${target}`);
      break;
    case "ban-address":
      if (!target) fail("Give an address");
      if (durationMs === null) fail("An address ban needs --days");
      store.banAddress(target, reason(), durationMs);
      console.log(`Address banned for ${days} days (kept as a keyed hash)`);
      break;
    case "lift-address":
      if (!target || !store.liftAddressBan(target)) fail("No ban on that address");
      console.log("Address ban lifted");
      break;
    case "prune":
      console.log(`Deleted ${store.prune()} rows past retention`);
      break;
    default:
      fail(usage);
  }
} catch (error) {
  fail((error as Error).message);
} finally {
  store.close();
}
